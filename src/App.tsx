import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { AuthConfig, CourseItem, TaskItem, ApplicationItem, GrabConfig } from './shared/types';
import { DEFAULT_RETRY_INTERVAL_MS, DEFAULT_MAX_RETRIES } from './shared/constants';
import { runTaskQueue, runGroupedTaskQueue } from './core/grab-engine';
import { runRealtimeGrab } from './core/realtime-grab';
import Toast, { type ToastMessage } from './components/Toast';
import { TimetableView, type TimetableCourse } from './components/Timetable';
import { parseCourseSchedule, formatCourseClassTime } from './lib/courseDisplay';
import './App.css';

declare global { interface Window { electronAPI: any; } }

type Nav = 'auth' | 'preferred' | 'search' | 'apps' | 'tasks' | 'timetable' | 'ratings' | 'logs';

const NAV: { id: Nav; label: string; icon: string }[] = [
  { id: 'auth', label: '认证', icon: '🔑' },
  { id: 'preferred', label: '优选班', icon: '⭐' },
  { id: 'search', label: '查课', icon: '🔍' },
  { id: 'apps', label: '申请', icon: '📋' },
  { id: 'tasks', label: '抢课', icon: '⚡' },
  { id: 'timetable', label: '课表', icon: '🗓' },
  { id: 'ratings', label: '教师评分', icon: '📊' },
  { id: 'logs', label: '日志', icon: '📜' },
];

function decodeJwt(token: string): { exp?: number; sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch { return null; }
}

// ==================== localStorage 持久化 ====================

const TASK_STORAGE_KEY = 'swjtu-grab-tasks:v1';
type TaskPreset = Pick<TaskItem, 'teachId' | 'courseCode' | 'courseName' | 'creditHour' | 'staffName' | 'courseType' | 'scheduleTime' | 'priority' | 'studentNumber' | 'fullNumber'>;

function loadSavedTasks(): TaskItem[] {
  try {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t: any) => t && typeof t.teachId === 'string')
      .map((t: any) => ({
        teachId: t.teachId,
        courseCode: t.courseCode || '',
        courseName: t.courseName || t.teachId,
        creditHour: t.creditHour,
        staffName: t.staffName,
        courseType: t.courseType || '',
        scheduleTime: t.scheduleTime || '',
        priority: Number.isFinite(t.priority) ? t.priority : 0,
        status: 'idle' as const,
        attempts: 0,
        backoffMs: DEFAULT_RETRY_INTERVAL_MS,
        lastMessage: '',
        studentNumber: t.studentNumber ?? null,
        fullNumber: t.fullNumber ?? null,
      }));
  } catch { return []; }
}

function saveTaskPresets(tasks: TaskItem[]) {
  try {
    const presets: TaskPreset[] = tasks.map(t => ({
      teachId: t.teachId, courseCode: t.courseCode, courseName: t.courseName,
      creditHour: t.creditHour, staffName: t.staffName, courseType: t.courseType,
      scheduleTime: t.scheduleTime, priority: t.priority,
      studentNumber: t.studentNumber, fullNumber: t.fullNumber,
    }));
    if (presets.length === 0) localStorage.removeItem(TASK_STORAGE_KEY);
    else localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(presets));
  } catch { /* quota exceeded, ignore */ }
}

// ==================== App ====================

export default function App() {
  const api = useMemo(() => window.electronAPI, []);
  const [nav, setNav] = useState<Nav>('auth');
  const [auth, setAuth] = useState<AuthConfig | null>(null);
  const [tokenState, setTokenState] = useState<'unknown' | 'valid' | 'expired'>('unknown');
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>(['应用已启动']);
  const [tasks, setTasks] = useState<TaskItem[]>(loadSavedTasks);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  // Cached data
  const [preferredCourses, setPreferredCourses] = useState<any[] | null>(null);
  const [applications, setApplications] = useState<{ data: ApplicationItem[]; total: number; page: number } | null>(null);

  // 任务变更自动落盘
  useEffect(() => { saveTaskPresets(tasks); }, [tasks]);

  // 订阅 token 过期推送
  useEffect(() => {
    const unsub = api.auth.onTokenExpired?.((reason: string) => {
      pushToast('error', `登录状态已失效: ${reason}，请重新登录`);
      setTokenState('expired');
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // Load auth on mount
  useEffect(() => {
    api.auth.load().then((a: AuthConfig | null) => {
      if (a) { setAuth(a); parseTokenExpiry(a.token); checkState(a.token); setNav('preferred'); }
    }).catch(() => {});
  }, []);

  function pushToast(type: ToastMessage['type'], text: string) {
    toastIdRef.current += 1;
    setToasts(prev => [...prev, { id: toastIdRef.current, type, text }]);
  }
  function dismissToast(id: number) { setToasts(prev => prev.filter(t => t.id !== id)); }

  function parseTokenExpiry(token: string) {
    const jwt = decodeJwt(token);
    setTokenExpiry(jwt?.exp ?? null);
  }

  const pushLog = useCallback((text: string, level = '') => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [`${ts}  ${level} ${text}`, ...prev].slice(0, 1000));
  }, []);

  async function checkState(token?: string) {
    try { const r = await api.auth.checkTokenStatus(); setTokenState(r.state); }
    catch { setTokenState('unknown'); }
  }

  async function doSaveToken(input: string) {
    if (!input.trim()) return;
    const cfg = await api.auth.save(input);
    setAuth(cfg); parseTokenExpiry(cfg.token); checkState(cfg.token);
    pushLog('✅ Token 已保存');
    pushToast('success', 'Token 已保存');
    try { const r = await api.course.resolveTerm(); pushLog(`学期: ${r.termId}${r.label ? ` (${r.label})` : ''}`); } catch {}
    setNav('preferred');
  }

  async function doClearToken() {
    await api.auth.clear(); setAuth(null); setTokenState('unknown'); setTokenExpiry(null);
    setPreferredCourses(null); setApplications(null);
    pushLog('Token 已清除');
  }

  return (
    <>
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <TopBar auth={auth} tokenState={tokenState} tokenExpiry={tokenExpiry} />
      <div className="app-body">
        <NavRail nav={nav} setNav={setNav} />
        <div className="main">
          {nav === 'auth'    && <AuthView     api={api} auth={auth} tokenState={tokenState} tokenExpiry={tokenExpiry} onSave={doSaveToken} onClear={doClearToken} onCheck={checkState} pushLog={pushLog} pushToast={pushToast} parseTokenExpiry={parseTokenExpiry} />}
          {nav === 'preferred' && <PreferredView api={api} pushLog={pushLog} cached={preferredCourses} setCached={setPreferredCourses} tasks={tasks} setTasks={setTasks} />}
          {nav === 'search'  && <SearchView    api={api} pushLog={pushLog} tasks={tasks} setTasks={setTasks} />}
          {nav === 'apps'    && <AppsView      api={api} pushLog={pushLog} cached={applications} setCached={setApplications} />}
          {nav === 'tasks'   && <TasksView     api={api} pushLog={pushLog} pushToast={pushToast} tasks={tasks} setTasks={setTasks} />}
          {nav === 'timetable' && <TimetablePage api={api} pushLog={pushLog} tasks={tasks} setTasks={setTasks} />}
          {nav === 'ratings' && <RatingsView />}
          {nav === 'logs'    && <LogsView      logs={logs} />}
        </div>
      </div>
      <div className="footer-bar">仅供学习交流使用，严禁用于商业用途，请于24小时内删除</div>
    </>
  );
}

/* ── Top Bar ── */
function TopBar({ auth, tokenState, tokenExpiry }: { auth: AuthConfig | null; tokenState: string; tokenExpiry: number | null }) {
  const expText = tokenExpiry
    ? (Date.now() >= tokenExpiry * 1000 ? '已过期' : `${formatDuration(tokenExpiry * 1000 - Date.now())}后过期`)
    : '';
  return (
    <div className="topbar">
      <div className="topbar-left">
        <span className="topbar-logo">◆</span> 西南交大自动抢课系统
      </div>
      <div className="topbar-right">
        <span className={`topbar-tag ${auth ? (tokenState === 'valid' ? 'ok' : 'err') : 'off'}`}>
          {auth ? (tokenState === 'valid' ? 'Token 有效' : tokenState === 'expired' ? 'Token 过期' : '未知') : '未认证'}
        </span>
        {tokenExpiry && <span style={{ fontSize: 12, color: Date.now() >= tokenExpiry * 1000 ? 'var(--red)' : 'var(--fg2)' }}>{expText}</span>}
        {auth && <span style={{ fontSize: 12, color: 'var(--fg2)' }}>
          {auth.updatedAt ? new Date(auth.updatedAt).toLocaleString('zh-CN') : ''}
        </span>}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0分钟';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${mins}分钟`;
  return `${Math.max(1, mins)}分钟`;
}

/* ── Nav Rail ── */
function NavRail({ nav, setNav }: { nav: Nav; setNav: (n: Nav) => void }) {
  return (
    <div className="nav-rail">
      {NAV.map(item => (
        <button key={item.id} className={`nav-icon${nav === item.id ? ' active' : ''}`}
          onClick={() => setNav(item.id)} title={item.label}>
          {item.icon}
        </button>
      ))}
      <div className="spacer" />
    </div>
  );
}

/* ═══════════════════════ AUTH ═══════════════════════ */
function AuthView({ api, auth, tokenState, tokenExpiry, onSave, onClear, onCheck, pushLog, pushToast, parseTokenExpiry }: any) {
  const [input, setInput] = useState('');
  const [showFull, setShowFull] = useState(false);
  // 登录表单
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<any>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (!auth) {
      api.auth.loadCredentials().then((c: any) => {
        if (c) { setUsername(c.username); setPassword(c.password); setRemember(true); }
      }).catch(() => {});
      refreshCaptcha();
      setShowLogin(true);
    }
  }, [auth]);

  async function refreshCaptcha() {
    setCaptchaLoading(true);
    try { const c = await api.auth.getCaptcha(); setCaptcha(c); setCaptchaCode(''); }
    catch { setCaptcha(null); }
    finally { setCaptchaLoading(false); }
  }

  async function handleLogin() {
    if (!username.trim() || !password) { pushToast('error', '请输入学号和密码'); return; }
    setLoggingIn(true);
    try {
      const result = await api.auth.login({
        username: username.trim(), password,
        code: captchaCode.trim() || undefined,
        uuid: captcha?.uuid, salt: captcha?.salt, remember,
      });
      if (result.success && result.auth) {
        setAuth2(result.auth);
        pushLog('✅ 登录成功');
        pushToast('success', '登录成功');
        setPassword(''); setCaptchaCode('');
      } else {
        pushToast('error', result.message || '登录失败');
        refreshCaptcha();
      }
    } catch (e: any) {
      pushToast('error', `登录失败: ${e.message}`);
      refreshCaptcha();
    } finally { setLoggingIn(false); }
  }

  function setAuth2(cfg: AuthConfig) {
    onSave(cfg.token);
  }

  const expText = tokenExpiry
    ? new Date(tokenExpiry * 1000).toLocaleString('zh-CN')
    : '无法解析';
  const isExpired = tokenExpiry && Date.now() >= tokenExpiry * 1000;

  return (
    <>
      <div className="main-header"><div><div className="main-title">身份认证</div><div className="main-subtitle">配置教务系统 Token 以启用全部功能</div></div></div>
      <div className="card">
        {!auth && showLogin && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>学号密码登录（自动获取 Token）</div>
            <div className="input-row">
              <input className="input" style={{ flex: 1 }} placeholder="学号" autoComplete="username"
                value={username} onChange={e => setUsername(e.target.value)} />
              <input className="input" style={{ flex: 1 }} type="password" placeholder="密码" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
            <div className="input-row" style={{ marginTop: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="验证码"
                value={captchaCode} onChange={e => setCaptchaCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              {captcha?.img ? (
                <img src={captcha.img.startsWith('data:') ? captcha.img : `data:image/png;base64,${captcha.img}`}
                  alt="验证码" title="点击刷新"
                  onClick={refreshCaptcha}
                  style={{ height: 38, minWidth: 96, objectFit: 'cover', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }} />
              ) : (
                <button className="btn btn-sm" onClick={refreshCaptcha} disabled={captchaLoading} style={{ marginTop: 0, whiteSpace: 'nowrap' }}>
                  {captchaLoading ? '加载中...' : '获取验证码'}
                </button>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0', fontSize: 12, color: 'var(--fg2)' }}>
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              记住密码（本机加密保存）
            </label>
            <button className="btn btn-pri" onClick={handleLogin} disabled={loggingIn} style={{ width: '100%' }}>
              {loggingIn ? '登录中...' : '登录'}
            </button>
            <div style={{ margin: '12px 0 4px', borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 12, color: 'var(--fg2)' }}>
              或手动粘贴 token：
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="input" value={input} onChange={(e: any) => setInput(e.target.value)}
            placeholder="粘贴 ytoken…" onKeyDown={(e: any) => e.key === 'Enter' && onSave(input)} />
          <button className="btn btn-pri" onClick={() => onSave(input)} disabled={!input.trim()}>保存</button>
        </div>
        {auth && <div className="btn-group" style={{ marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => { onCheck(); pushLog('检查 Token 状态…'); }}>检查状态</button>
          <button className="btn btn-sm" onClick={() => setShowFull(!showFull)}>{showFull ? '隐藏' : '显示'}完整 Token</button>
          <button className="btn btn-sm btn-dng" onClick={onClear}>清除</button>
        </div>}
        {auth && <div className="card card-sm" style={{ background: 'var(--bg)' }}>
          <div className="sidebar-stat"><span>状态</span><b><span className={`tag ${tokenState === 'valid' ? 'tag-ok' : 'tag-err'}`}>{tokenState === 'valid' ? '有效' : tokenState === 'expired' ? '已过期' : '未知'}</span></b></div>
          <div className="sidebar-stat"><span>有效期至</span><b style={{ color: isExpired ? 'var(--red)' : 'var(--fg)' }}>{expText}</b></div>
          {tokenExpiry && !isExpired && <div className="sidebar-stat"><span>剩余</span><b>{formatDuration(tokenExpiry * 1000 - Date.now())}</b></div>}
          <div className="sidebar-stat"><span>更新时间</span><b>{auth.updatedAt}</b></div>
          {showFull && <div style={{ marginTop: 8, wordBreak: 'break-all', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg2)', background: 'var(--bg2)', padding: 8, borderRadius: 4, maxHeight: 120, overflow: 'auto' }}>{auth.token}</div>}
        </div>}
      </div>
    </>
  );
}

/* ═══════════════════════ PREFERRED ═══════════════════════ */
function PreferredView({ api, pushLog, cached, setCached, tasks, setTasks }: any) {
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (cached === null) refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const data = await api.course.listPreferred();
      if (data.length > 0) {
        const teachIds = data.map((c: any) => String(c.teachId));
        const caps = await api.course.getCapacity(teachIds);
        const capMap = new Map((caps as any[]).map((c: any) => [String(c.teachId), c]));
        setCached(data.map((c: any) => ({ ...c, ...(capMap.get(String(c.teachId)) || {}) })));
      } else { setCached(data); }
      pushLog(`✅ 优选班: ${data.length} 门`);
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }

  async function apply(teachId: string) {
    try {
      const r = await api.course.apply({ teachId, ignoreTimeConflict: false });
      pushLog(r.success ? `✅ 选课 ${teachId} 成功` : `❌ ${r.message}`);
      if (r.success) refresh();
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
  }

  function addTask(c: any) {
    setTasks((prev: TaskItem[]) => {
      if (prev.some(t => String(t.teachId) === String(c.teachId))) return prev;
      pushLog(`➕ 加入队列: ${c.courseName}`);
      return [...prev, {
        teachId: c.teachId, courseCode: c.courseCode || '',
        courseName: c.courseName, creditHour: c.creditHour,
        staffName: c.staffName, courseType: c.courseType || '',
        scheduleTime: c.scheduleTime || c.classTimePlace || '',
        priority: 0,
        status: 'idle' as const, attempts: 0, backoffMs: DEFAULT_RETRY_INTERVAL_MS,
        lastMessage: '', studentNumber: c.studentNumber ?? null, fullNumber: c.fullNumber ?? null,
      }];
    });
  }

  const inTask = (id: string) => tasks.some((t: TaskItem) => String(t.teachId) === String(id));

  return (
    <>
      <div className="main-header"><div><div className="main-title">优选班课程</div><div className="main-subtitle">一键拉取全部可选优选班，支持立即选课或加入抢课队列</div></div>
        <button className={`btn ${loading ? '' : 'btn-pri'}`} onClick={refresh} disabled={loading}>
          {loading && <span className="spin" />}{loading ? '加载中' : '刷新列表'}
        </button>
      </div>
      {!loading && (!cached || cached.length === 0) ? (
        <div className="empty"><div className="empty-icon">📭</div><div className="empty-text">{cached === null ? '加载中…' : '点击「刷新列表」加载课程'}</div></div>
      ) : (
        <div style={{ overflowX: 'auto' }}><table>
          <thead><tr><th>编号</th><th>课程名称</th><th>学分</th><th>教师</th><th>院系</th><th>容量</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {(cached || []).map((c: any) => (
              <tr key={c.teachId}>
                <td><code>{c.teachId}</code></td>
                <td>{c.courseName}</td><td>{c.creditHour ?? '-'}</td><td>{c.staffName ?? '-'}</td>
                <td style={{ fontSize: 12 }}>{c.collegeAbbrev ?? '-'}</td>
                <td><CapacityBar cur={c.studentNumber} max={c.fullNumber} /></td>
                <td><StatusTag course={c} inTask={inTask(c.teachId)} /></td>
                <td>
                  <div className="btn-group">
                    <button className="btn btn-xs btn-suc" onClick={() => apply(c.teachId)} disabled={c.hasSelected}>选课</button>
                    <button className="btn btn-xs" onClick={() => addTask(c)} disabled={c.hasSelected || inTask(c.teachId)}>抢课</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}

/* ═══════════════════════ SEARCH ═══════════════════════ */
function SearchView({ api, pushLog, tasks, setTasks }: any) {
  const [kw, setKw] = useState('');
  const [tid, setTid] = useState('124');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.course.resolveTerm().then((r: any) => setTid(r.termId)).catch(() => {}); }, []);

  async function search() {
    if (!kw.trim()) return;
    setLoading(true);
    try {
      const r = await api.course.search({ keywords: kw, termId: tid, pageNum: 1, pageSize: 50 });
      setResults(r.data || []);
      pushLog(`✅ 搜索"${kw}": ${r.data?.length || 0} 条`);
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }

  async function apply(teachId: string) {
    try {
      const r = await api.course.apply({ teachId, ignoreTimeConflict: false });
      pushLog(r.success ? `✅ 选课 ${teachId} 成功` : `❌ ${r.message}`);
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
  }

  function addTask(c: any) {
    setTasks((prev: TaskItem[]) => {
      if (prev.some(t => String(t.teachId) === String(c.teachId))) return prev;
      pushLog(`➕ 加入队列: ${c.courseName}`);
      return [...prev, {
        teachId: c.teachId, courseCode: c.courseCode || '',
        courseName: c.courseName, creditHour: c.creditHour,
        staffName: c.staffName, courseType: c.courseType || '',
        scheduleTime: c.scheduleTime || c.classTimePlace || '',
        priority: 0,
        status: 'idle' as const, attempts: 0, backoffMs: DEFAULT_RETRY_INTERVAL_MS,
        lastMessage: '', studentNumber: c.studentNumber ?? null, fullNumber: c.fullNumber ?? null,
      }];
    });
  }

  const inTask = (id: string) => tasks.some((t: TaskItem) => String(t.teachId) === String(id));

  return (
    <>
      <div className="main-header"><div><div className="main-title">普通课程查询</div><div className="main-subtitle">按名称 / 代码 / 教师搜索课程</div></div></div>
      <div className="card">
        <div className="input-row">
          <input className="input" value={kw} onChange={(e: any) => setKw(e.target.value)}
            placeholder="课程名称、代码或教师姓名…" onKeyDown={(e: any) => e.key === 'Enter' && search()} />
          <input className="input" style={{ width: 80 }} value={tid} onChange={(e: any) => setTid(e.target.value)} placeholder="学期" />
          <button className={`btn btn-pri`} onClick={search} disabled={loading || !kw.trim()}>
            {loading && <span className="spin" />}搜索
          </button>
        </div>
      </div>
      {!loading && results.length === 0 ? (
        <div className="empty"><div className="empty-icon">🔎</div><div className="empty-text">输入关键字搜索课程</div></div>
      ) : (
        <div style={{ overflowX: 'auto' }}><table>
          <thead><tr><th>编号</th><th>课程名称</th><th>学分</th><th>教师</th><th>容量</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {results.map((c: any) => (
              <tr key={c.teachId}>
                <td><code>{c.teachId}</code></td>
                <td>{c.courseName}</td><td>{c.creditHour ?? '-'}</td><td>{c.staffName ?? '-'}</td>
                <td><CapacityBar cur={c.studentNumber} max={c.fullNumber} /></td>
                <td><StatusTag course={c} inTask={inTask(c.teachId)} /></td>
                <td><div className="btn-group">
                  <button className="btn btn-xs btn-suc" onClick={() => apply(c.teachId)} disabled={c.hasSelected}>选课</button>
                  <button className="btn btn-xs" onClick={() => addTask(c)} disabled={c.hasSelected || inTask(c.teachId)}>抢课</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}

/* ═══════════════════════ APPLICATIONS ═══════════════════════ */
function AppsView({ api, pushLog, cached, setCached }: any) {
  const [loading, setLoading] = useState(false);
  const PAGE = 20;

  useEffect(() => { if (!cached) refresh(1); }, []);

  async function refresh(p = 1) {
    setLoading(true);
    try {
      const r = await api.course.listMyApplications({ pageNum: p, pageSize: PAGE });
      setCached({ data: r.data || [], total: r.total || 0, page: p });
      pushLog(`✅ 申请: ${r.data?.length || 0} 条 / 共 ${r.total || 0}`);
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }

  async function cancel(applyId: string) {
    try {
      const r = await api.course.cancelApplication(applyId);
      pushLog(r.success ? `✅ 已取消 ${applyId}` : `❌ ${r.message}`);
      if (r.success) refresh(cached?.page || 1);
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
  }

  const apps = cached?.data || [];
  const total = cached?.total || 0;
  const page = cached?.page || 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <div className="main-header"><div><div className="main-title">选课申请管理</div><div className="main-subtitle">查看全部已提交申请，支持取消和翻页</div></div>
        <button className={`btn ${loading ? '' : 'btn-pri'}`} onClick={() => refresh(1)} disabled={loading}>
          {loading && <span className="spin" />}{loading ? '加载中' : '刷新'}
        </button>
      </div>
      {!loading && apps.length === 0 ? (
        <div className="empty"><div className="empty-icon">📋</div><div className="empty-text">{cached ? '暂无选课申请' : '加载中…'}</div></div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}><table>
            <thead><tr><th>申请ID</th><th>编号</th><th>课程名称</th><th>学分</th><th>教师</th><th>性质</th><th>时间</th><th>选中</th><th>志愿分</th><th>操作</th></tr></thead>
            <tbody>
              {apps.map((a: any, i: number) => (
                <tr key={a.applyId || a.id || i}>
                  <td><code>{a.applyId ?? a.id}</code></td>
                  <td><code>{a.teachId}</code></td>
                  <td>{a.courseName}</td><td>{a.creditHour ?? '-'}</td><td>{a.staffName ?? a.teacherName ?? a.teacher ?? a.courseTeacherName ?? '-'}</td>
                  <td style={{ fontSize: 12 }}>{a.courseType ?? '-'}</td>
                  <td style={{ fontSize: 12 }}>{a.applyTime ?? '-'}</td>
                  <td>{a.isChoosed === 1 ? <span className="tag tag-ok">已选中</span> : a.isChoosed === 0 ? <span className="tag tag-dim">待处理</span> : <span className="tag tag-warn">?</span>}</td>
                  <td>{a.chooseScore ?? 0}</td>
                  <td><button className="btn btn-xs btn-dng" onClick={() => cancel(a.applyId ?? a.id)}>取消</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {pages > 1 && <div className="pager">
            <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => refresh(page - 1)}>← 上一页</button>
            <span>{page} / {pages}（共 {total} 条）</span>
            <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => refresh(page + 1)}>下一页 →</button>
          </div>}
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--fg3)' }}>
            isChoosed: 0=待处理/未最终选中，1=已选中
          </div>
        </>
      )}
    </>
  );
}

/* ═══════════════════════ TASKS ═══════════════════════ */
function TasksView({ api, pushLog, pushToast, tasks, setTasks }: any) {
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState<GrabConfig>({
    concurrency: 2, maxRetries: DEFAULT_MAX_RETRIES, retryIntervalMs: DEFAULT_RETRY_INTERVAL_MS,
    monitorIntervalMs: 1000, forceBypassCapacity: false, ignoreTimeConflict: false,
  });
  const [useRealtime, setUseRealtime] = useState(false);
  const [targetTime, setTargetTime] = useState('12:00:00');
  const [fireAheadMs, setFireAheadMs] = useState(200);
  const [useGrouped, setUseGrouped] = useState(true); // 默认启用同课多班择一
  const cancelRef = useRef(false);
  const tasksRef = useRef<TaskItem[]>(tasks);
  tasksRef.current = tasks; // 始终指向最新 tasks，避免闭包陈旧值
  const [addTid, setAddTid] = useState('');
  const [addName, setAddName] = useState('');
  const [addCode, setAddCode] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  function doAddTask() {
    const tid = addTid.trim();
    if (!tid) return;
    const name = addName.trim() || tid;
    if (tasks.some((t: any) => String(t.teachId) === String(tid))) { pushLog('⚠️ 已在队列中'); return; }
    pushLog(`➕ 手动添加: ${name}`);
    setTasks((prev: any) => [...prev, {
      teachId: tid, courseCode: addCode.trim() || tid, courseName: name,
      status: 'idle' as const, attempts: 0, backoffMs: config.retryIntervalMs,
      lastMessage: '', studentNumber: null, fullNumber: null, priority: 0,
    }]);
    setAddTid(''); setAddName(''); setAddCode(''); setShowAddForm(false);
  }

  function removeTask(tid: string) { setTasks((prev: TaskItem[]) => prev.filter(t => String(t.teachId) !== String(tid))); }

  function updateTask(tid: string, patch: Partial<TaskItem>) {
    setTasks((prev: TaskItem[]) => prev.map(t => String(t.teachId) === String(tid) ? { ...t, ...patch } : t));
  }

  async function refreshCap() {
    const tids = tasks.map(t => t.teachId);
    if (!tids.length) return;
    try {
      const caps = await api.course.getCapacity(tids);
      const m = new Map((caps as any[]).map((c: any) => [String(c.teachId), c]));
      setTasks((prev: TaskItem[]) => prev.map(t => { const c = m.get(String(t.teachId)); return c ? { ...t, studentNumber: c.studentNumber, fullNumber: c.fullNumber } : t; }));
      pushLog('✅ 容量已刷新');
    } catch (e: any) { pushLog(`❌ ${e.message}`); }
  }

  async function start() {
    if (!tasks.length) return;
    cancelRef.current = false; setRunning(true);
    const snapshot = tasks.map(t => ({ ...t, status: 'idle' as const, attempts: 0, lastMessage: '' }));
    setTasks(snapshot);

    if (useRealtime) {
      pushLog(`🎯 实时模式: 时间${targetTime}, 提前${fireAheadMs}ms, ${snapshot.length}门×${config.concurrency}并发`);
      await runRealtimeGrab(snapshot, {
        getCapacity: api.course.getCapacity,
        apply: (teachId: string) => api.course.select({ teachId }),
        syncServerTime: api.course.syncServerTime,
        probeServerOpen: async () => {
          // 用队列中第一门课检测选课是否已开放
          const first = snapshot[0];
          if (!first) return false;
          try {
            const r = await api.course.checkChooseTime({ teachId: first.teachId });
            return r.open;
          } catch { return false; }
        },
      }, {
        targetTime, concurrency: config.concurrency, fireAheadMs,
        maxRounds: config.maxRetries, roundIntervalMs: config.retryIntervalMs,
        ignoreTimeConflict: config.ignoreTimeConflict,
        serverPollIntervalMs: 3000,
        onUpdateTask: updateTask, onLog: (msg: string) => pushLog(msg),
        cancelled: () => cancelRef.current,
      });
    } else if (useGrouped) {
      pushLog(`🚀 分组模式: ${snapshot.length} 门, 并发${config.concurrency}, 同课多班择一`);
      await runGroupedTaskQueue(snapshot, {
        getCapacity: api.course.getCapacity,
        apply: (teachId: string) => api.course.select({ teachId }),
      }, {
        ...config, cancelled: () => cancelRef.current,
        onUpdateTask: updateTask, onLog: (msg: string) => pushLog(msg),
      });
    } else {
      pushLog(`🚀 普通模式: ${snapshot.length} 门, 并发${config.concurrency}, 最大${config.maxRetries}轮`);
      await runTaskQueue(snapshot, {
        getCapacity: api.course.getCapacity,
        apply: (teachId: string) => api.course.select({ teachId }),
      }, {
        ...config, cancelled: () => cancelRef.current,
        onUpdateTask: updateTask, onLog: (msg: string) => pushLog(msg),
      });
    }

    setRunning(false);
    const results = tasksRef.current.filter((t: TaskItem) => t.status === 'success').length;
    if (results > 0) pushToast('success', `抢课完成: ${results} 门成功`);
  }

  function stop() { cancelRef.current = true; pushLog('⏹ 请求停止…'); }

  // 同门课分组统计
  const courseGroups = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    tasks.forEach(t => {
      const key = t.courseCode || t.teachId;
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    });
    return map;
  }, [tasks]);

  return (
    <>
      <div className="main-header"><div><div className="main-title">抢课任务</div><div className="main-subtitle">管理抢课队列，配置策略参数</div></div>
        <div className="btn-group">
          {!running ? <button className="btn btn-suc" onClick={start} disabled={!tasks.length}>🚀 开始抢课</button>
                   : <button className="btn btn-dng" onClick={stop}>⏹ 停止</button>}
          <button className="btn" onClick={() => setShowAddForm(!showAddForm)} disabled={running}>
            {showAddForm ? '取消' : '手动添加'}
          </button>
          <button className="btn" onClick={refreshCap} disabled={running || !tasks.length}>刷新容量</button>
          <button className="btn" onClick={() => { setTasks((prev: TaskItem[]) => prev.filter(t => t.status !== 'success' && t.status !== 'failed')); pushLog('已清除完成项'); }} disabled={running}>清除完成</button>
          <button className="btn btn-dng" onClick={() => { setTasks([]); pushLog('已清空'); }} disabled={running}>清空</button>
        </div>
      </div>
      <div className="card card-sm" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        <CfgField label="并发数" v={config.concurrency} set={(v: number) => setConfig({ ...config, concurrency: Math.max(1, v) })} />
        <CfgField label="最大轮数" v={config.maxRetries} set={(v: number) => setConfig({ ...config, maxRetries: Math.max(1, v) })} />
        <CfgField label="重发间隔ms" v={config.retryIntervalMs} set={(v: number) => setConfig({ ...config, retryIntervalMs: Math.max(200, v) })} step={100} />
        <CfgField label="监控间隔ms" v={config.monitorIntervalMs} set={(v: number) => setConfig({ ...config, monitorIntervalMs: Math.max(500, v) })} step={100} />
        <label className="cfg-toggle"><input type="checkbox" checked={config.forceBypassCapacity} onChange={e => setConfig({ ...config, forceBypassCapacity: e.target.checked })} disabled={running} />绕过容量</label>
        <label className="cfg-toggle"><input type="checkbox" checked={config.ignoreTimeConflict} onChange={e => setConfig({ ...config, ignoreTimeConflict: e.target.checked })} disabled={running} />忽略时间冲突</label>
        <label className="cfg-toggle"><input type="checkbox" checked={useGrouped} onChange={e => setUseGrouped(e.target.checked)} disabled={running} />🔗 同课多班择一</label>
        <label className="cfg-toggle"><input type="checkbox" checked={useRealtime} onChange={e => setUseRealtime(e.target.checked)} disabled={running} />⚡ 实时抢课模式</label>
        {useRealtime && <>
          <CfgField label="开抢时间" v={targetTime} set={(v: any) => setTargetTime(v)} />
          <CfgField label="提前量(ms)" v={fireAheadMs} set={(v: number) => setFireAheadMs(Math.max(0, v))} step={50} />
        </>}
      </div>
      {showAddForm && <div className="card card-sm" style={{ marginBottom: 16 }}>
        <div className="input-row">
        <input className="input" value={addTid} onChange={(e: any) => setAddTid(e.target.value)}
          placeholder="选课编号 (teachId)" onKeyDown={(e: any) => e.key === 'Enter' && doAddTask()} />
        <input className="input" value={addName} onChange={(e: any) => setAddName(e.target.value)}
          placeholder="课程名称（可选）" onKeyDown={(e: any) => e.key === 'Enter' && doAddTask()} />
        <input className="input" value={addCode} onChange={(e: any) => setAddCode(e.target.value)}
          placeholder="课程代码（同课分组用）" style={{ width: 140 }} onKeyDown={(e: any) => e.key === 'Enter' && doAddTask()} />
        <button className="btn btn-pri" onClick={doAddTask} disabled={!addTid.trim()}>确认添加</button>
        </div>
      </div>}
      {tasks.length === 0 && !showAddForm ? (
        <div className="empty"><div className="empty-icon">⚡</div><div className="empty-text">从课程列表「加入抢课」或点「手动添加」创建任务</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((t: TaskItem) => {
            const groupSize = courseGroups.get(t.courseCode || t.teachId)?.length || 1;
            return (
            <div key={t.teachId} className="card card-sm">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <b style={{ fontSize: 14 }}>{t.courseName}</b>
                  <code style={{ marginLeft: 8 }}>{t.teachId}</code>
                  {t.staffName && <span style={{ marginLeft: 8, color: 'var(--fg2)' }}>{t.staffName}</span>}
                  {groupSize > 1 && (
                    <span title="同课多班择一" style={{ marginLeft: 6, fontSize: 11, color: '#9254de', border: '1px solid #d3adf7', borderRadius: 8, padding: '0 6px', whiteSpace: 'nowrap' }}>
                      同课·择一
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {groupSize > 1 && !running && (
                    <input type="number" title="同门课内优先级，数字越大越先抢"
                      style={{ width: 52, padding: '2px 4px', fontSize: 11, background: 'var(--bg2)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 4 }}
                      value={t.priority ?? 0}
                      onChange={e => {
                        const n = Number(e.target.value);
                        updateTask(t.teachId, { priority: Number.isFinite(n) ? n : 0 });
                      }} />
                  )}
                  <span className={`tag ${t.status === 'success' ? 'tag-ok' : t.status === 'failed' ? 'tag-err' : t.status === 'submitting' ? 'tag-warn' : t.status === 'monitoring' ? 'tag-info' : t.status === 'backoff' ? 'tag-warn' : 'tag-dim'}`}>
                    {t.status === 'idle' ? '等待' : t.status === 'monitoring' ? '监控中' : t.status === 'submitting' ? '提交中' : t.status === 'backoff' ? '冷却' : t.status === 'success' ? '成功' : t.status === 'failed' ? '失败' : t.status === 'cancelled' ? '已跳过' : t.status}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--fg2)' }}>第 {t.attempts} 轮</span>
                  <CapacityBar cur={t.studentNumber} max={t.fullNumber} />
                  {!running && <button className="btn btn-xs btn-ghost" onClick={() => removeTask(t.teachId)}>移除</button>}
                </div>
              </div>
              {t.lastMessage && <div style={{ fontSize: 12, color: 'var(--fg2)', marginTop: 4 }}>{t.lastMessage}</div>}
              {running && <div className="progress"><div className={`progress-bar${t.status === 'success' ? ' ok' : t.status === 'failed' ? ' err' : ''}`} style={{ width: `${Math.min(100, (t.attempts / config.maxRetries) * 100)}%` }} /></div>}
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function CfgField({ label, v, set, step }: { label: string; v: number | string; set: (v: any) => void; step?: number }) {
  const isString = typeof v === 'string';
  return (
    <div className="cfg-field">
      <span className="cfg-label">{label}</span>
      <input className="input" type={isString ? 'text' : 'number'} value={v} min={isString ? undefined : 1} step={step ?? 1}
        onChange={e => set(isString ? e.target.value : (parseInt(e.target.value) || 0))} />
    </div>
  );
}

/* ═══════════════════════ RATINGS ═══════════════════════ */

const RATINGS_API = 'https://cancir.xyz/api';

function RatingsView() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ teachers: number; courses: number; reviews: number } | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch(RATINGS_API + '/stats').then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  async function search() {
    const kw = keyword.trim();
    if (!kw) return;
    setLoading(true); setDetail(null);
    try {
      const params = new URLSearchParams({ q_p: kw, limit: '50' });
      const r = await fetch(RATINGS_API + '/teachers?' + params);
      const data = await r.json();
      setResults(data.items || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  async function showDetail(prof: string) {
    setDetailLoading(true);
    try {
      const r = await fetch(RATINGS_API + '/detail/' + encodeURIComponent(prof));
      setDetail(await r.json());
    } catch { setDetail(null); }
    finally { setDetailLoading(false); }
  }

  function scoreColor(v: number) {
    if (v >= 10) return 'var(--green)';
    if (v >= 5) return 'var(--yellow)';
    return 'var(--red)';
  }
  function scoreBg(v: number) {
    if (v >= 10) return 'rgba(63,185,80,.1)';
    if (v >= 5) return 'rgba(210,153,34,.1)';
    return 'rgba(248,81,73,.1)';
  }

  return (
    <>
      <div className="main-header"><div><div className="main-title">教师评分查询</div><div className="main-subtitle">数据来源 cancir.xyz（Echo 教师评分），由同学维护</div></div></div>

      {stats && (
        <div className="card card-sm" style={{ display: 'flex', gap: 32, marginBottom: 16 }}>
          <div><span style={{ color: 'var(--fg2)', fontSize: 11 }}>教师总数</span><br /><b style={{ fontSize: 18 }}>{stats.teachers}</b></div>
          <div><span style={{ color: 'var(--fg2)', fontSize: 11 }}>开设课程</span><br /><b style={{ fontSize: 18 }}>{stats.courses}</b></div>
          <div><span style={{ color: 'var(--fg2)', fontSize: 11 }}>累积评价</span><br /><b style={{ fontSize: 18 }}>{stats.reviews}</b></div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 11, color: 'var(--fg3)' }}>评分满分 15.0</span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="input-row">
          <input className="input" value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder="输入教师姓名搜索…" onKeyDown={e => e.key === 'Enter' && search()} />
          <button className="btn btn-pri" onClick={search} disabled={loading || !keyword.trim()}>
            {loading ? '搜索中…' : '搜索'}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>教师</th><th>院系</th><th>评分</th><th>评价数</th><th>课程</th></tr></thead>
            <tbody>
              {results.map((t: any) => (
                <tr key={t.prof} style={{ cursor: 'pointer' }} onClick={() => showDetail(t.prof)}>
                  <td><b>{t.prof}</b><span style={{ marginLeft: 6, fontSize: 11, color: 'var(--fg3)' }}>{t.position}</span></td>
                  <td style={{ fontSize: 12 }}>{t.dept}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                      background: scoreBg(t.rating), color: scoreColor(t.rating),
                    }}>{t.rating.toFixed(1)}</span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--fg2)' }}>{t.reviewCount} 条</td>
                  <td style={{ fontSize: 12, color: 'var(--fg2)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(t.courses || []).join('、')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && keyword && results.length === 0 && (
        <div className="empty"><div className="empty-icon">🔍</div><div className="empty-text">未找到匹配的教师</div></div>
      )}

      {detailLoading && <div className="empty"><span className="spin" /> 加载详情…</div>}

      {detail && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <b style={{ fontSize: 16 }}>{detail.prof}</b>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg2)' }}>{detail.dept} · {detail.position}</span>
            </div>
            <span style={{
              padding: '4px 14px', borderRadius: 12, fontSize: 16, fontWeight: 700,
              background: scoreBg(detail.scores?.overall ?? 0), color: scoreColor(detail.scores?.overall ?? 0),
            }}>{(detail.scores?.overall ?? 0).toFixed(1)}</span>
          </div>

          {detail.scores && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                ['教学质量', detail.scores.quality],
                ['给分情况', detail.scores.grading],
                ['课业负担', detail.scores.load],
              ].map(([label, v]) => (
                <div key={label as string} className="card card-sm" style={{ textAlign: 'center', padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--fg3)', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(v as number) }}>{(v as number).toFixed(1)}</div>
                  <div className="cap" style={{ marginTop: 4, minWidth: 0 }}>
                    <div className="cap-bar"><div className="cap-fill ok" style={{ width: ((v as number) / 5 * 100) + '%' }} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {detail.comments && detail.comments.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--fg2)', marginBottom: 10 }}>
                最近评价（共 {detail.reviewCount} 条）
              </div>
              {detail.comments.map((c: any, i: number) => (
                <div key={i} className="card card-sm" style={{ marginBottom: 6, borderLeft: '3px solid ' + scoreColor(c.overall) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--fg2)' }}>{c.course}</span>
                    <span style={{ fontSize: 11, color: 'var(--fg3)' }}>{c.updatedAt}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--fg)' }}>{c.comment}</div>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setDetail(null)}>收起详情</button>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ LOGS ═══════════════════════ */
function LogsView({ logs }: { logs: string[] }) {
  return (
    <>
      <div className="main-header"><div><div className="main-title">运行日志</div><div className="main-subtitle">{logs.length} 条记录</div></div></div>
      <div className="log">
        {logs.map((line, i) => {
          let cls = 'log-line';
          if (line.includes('❌')) cls += ' e';
          else if (line.includes('✅')) cls += ' s';
          else if (line.includes('⚠️') || line.includes('⏹')) cls += ' w';
          return <div key={i} className={cls}>{line}</div>;
        })}
      </div>
    </>
  );
}

/* ═══════════════════════ SHARED ═══════════════════════ */
function CapacityBar({ cur, max }: { cur: number | null | undefined; max: number | null | undefined }) {
  const c = cur ?? 0; const m = max ?? 0;
  const pct = m > 0 ? Math.min(100, (c / m) * 100) : 0;
  const fillClass = m === 0 ? '' : pct >= 100 ? 'full' : pct > 80 ? 'low' : 'ok';
  return (
    <div className="cap">
      <div className="cap-bar"><div className={`cap-fill ${fillClass}`} style={{ width: `${pct}%` }} /></div>
      <span className="cap-txt">{cur ?? '?'}/{max ?? '?'}</span>
    </div>
  );
}

function StatusTag({ course, inTask }: { course: any; inTask: boolean }) {
  if (course.hasSelected) return <span className="tag tag-ok">已选</span>;
  if (course.hasApplied) return <span className="tag tag-info">已申请</span>;
  if (inTask) return <span className="tag tag-warn">队列中</span>;
  return <span className="tag tag-dim">可选</span>;
}

/* ═══════════════════════ TIMETABLE ═══════════════════════ */
function TimetablePage({ api, pushLog, tasks, setTasks }: any) {
  const [loading, setLoading] = useState(false);
  const [apps, setApps] = useState<any[]>([]);
  const [preferred, setPreferred] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const [selR, appsR, prefR] = await Promise.all([
        api.course.listMySelections().catch(() => ({ data: [] as any[] })),
        api.course.listMyApplications().catch((e: any) => { throw new Error('获取申请列表失败: ' + (e?.message || e)); }),
        api.course.listPreferred().catch(() => [] as any[]),
      ]);
      if (!mountedRef.current) return;
      // 合并实时选课结果 + 已选中的申请，按 teachId 去重
      // isChoosed: 0=待处理，1=已选中，2=未选中（只保留确定选中的）
      const selIds = new Set((selR.data || []).map((s: any) => String(s.teachId)));
      const chosenApps = (appsR.data || []).filter((a: any) => a.isChoosed === 1 && !selIds.has(String(a.teachId)));
      setApps([...(selR.data || []), ...chosenApps]);
      setPreferred(prefR || []);
      setLoaded(true);
      const total = (selR.data?.length || 0) + chosenApps.length;
      pushLog(`课表: ${total} 门已选/申请 + ${tasks.length} 门抢课任务`);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || String(e));
      pushLog(`❌ ${e?.message || e}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  const courses = useMemo<TimetableCourse[]>(() => {
    try {
      const prefMap = new Map<string, any>();
      for (const p of preferred) prefMap.set(String(p.teachId), p);
      const appliedIds = new Set(apps.map((a: any) => String(a.teachId)));

      const appCourses: TimetableCourse[] = apps.map((a: any) => {
        const pref = prefMap.get(String(a.teachId));
        // 优先用 course 自身的时间字段（my-courses 返回的更完整），其次用 preferred 列表的
        const src = formatCourseClassTime(a) !== '-' ? a : (pref ?? a);
        return {
          id: `app-${a.applyId || a.id || Math.random()}`,
          courseName: String(a.courseName || ''), courseType: String(a.courseType || ''),
          teacher: String(a.staffName || a.teacherName || '-'),
          teachId: String(a.teachId || ''),
          classTimeText: formatCourseClassTime(src),
          segments: parseCourseSchedule(src),
          variant: 'application' as const,
        };
      });

      const grabCourses: TimetableCourse[] = tasks
        .filter((t: TaskItem) => !appliedIds.has(String(t.teachId)))
        .map((t: TaskItem) => {
          const pref = prefMap.get(String(t.teachId));
          const src = { scheduleTime: t.scheduleTime || pref?.scheduleTime || '' };
          const st = t.status === 'running' ? '抢课中' : t.status === 'success' ? '已成功' : t.status === 'failed' ? '失败' : '待抢';
          const sc = t.status === 'running' ? '#58a6ff' : t.status === 'success' ? '#3fb950' : t.status === 'failed' ? '#f85149' : '#d29922';
          return {
            id: `grab-${t.teachId}`,
            courseName: String(t.courseName || ''), courseType: String(t.courseType || pref?.courseType || ''),
            teacher: String(t.staffName || '-'),
            teachId: String(t.teachId),
            classTimeText: formatCourseClassTime(src),
            segments: parseCourseSchedule(src),
            variant: 'grabTask' as const,
            statusText: st, statusColor: sc,
            onRemove: () => setTasks((prev: TaskItem[]) => prev.filter(x => x.teachId !== t.teachId)),
          };
        });

      return [...appCourses, ...grabCourses];
    } catch { return []; }
  }, [apps, preferred, tasks]);

  return (
    <>
      <div className="main-header"><div><div className="main-title">预选课表</div><div className="main-subtitle">「我的选课申请」+ 抢课任务的可视化课表，纵向 1-12 节</div></div>
        <button className={`btn ${loading ? '' : 'btn-pri'}`} onClick={refresh} disabled={loading}>
          {loading && <span className="spin" />}{loading ? '加载中' : '刷新课表'}
        </button>
      </div>
      {error && <div className="card card-sm" style={{ color: '#f85149', marginBottom: 16 }}>⚠️ {error}</div>}
      {!loaded && !loading && !error ? (
        <div className="empty"><div className="empty-icon">🗓</div><div className="empty-text">点击「刷新课表」加载数据</div></div>
      ) : loaded && courses.length === 0 && !loading ? (
        <div className="empty"><div className="empty-icon">🗓</div><div className="empty-text">暂无选课申请与抢课任务</div></div>
      ) : (
        courses.length > 0 && <TimetableView courses={courses} itemLabel="门申请" />
      )}
    </>
  );
}
