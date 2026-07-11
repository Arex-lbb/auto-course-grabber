const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { saveAuth, loadAuth, clearAuth, saveCredentials, loadCredentials, clearCredentials } = require(path.join(__dirname, '..', 'src', 'main', 'auth-store.js'));
const { resolveCurrentTermId } = require(path.join(__dirname, '..', 'src', 'main', 'term-resolver.js'));
const { applyCourse, selectCourse, listMySelections, cancelApplication, checkTokenHeartbeat, getCourseCapacity, listMyApplications, listPreferredCourses, searchCourses, updateChooseScore, getLoginCaptcha, loginByPassword, checkChooseTime } = require(path.join(__dirname, '..', 'src', 'main', 'course-api.js'));
const { createClient } = require(path.join(__dirname, '..', 'src', 'main', 'request-client.js'));
const { checkTokenStatus, startTokenHeartbeat, stopTokenHeartbeat } = require(path.join(__dirname, '..', 'src', 'main', 'token-monitor.js'));

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860,
    minWidth: 960, minHeight: 640,
    title: '西南交大自动抢课系统',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  const distDir = path.join(app.getAppPath(), 'dist');
  const server = require('http').createServer((req, res) => {
    const urlPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    // 去掉开头的 /，防止 path.join 误解析为绝对路径；同时过滤 ../
    const safe = path.normalize(urlPath).replace(/^[\\/]+/, '').replace(/(^|[/\\])\.\.([/\\]|$)/g, '');
    const fp = path.join(distDir, safe);
    if (!fp.startsWith(distDir) || !fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(fp);
    const mime = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'text/html';
    res.writeHead(200, { 'Content-Type': mime });
    try { res.end(fs.readFileSync(fp)); } catch { res.writeHead(500); res.end('500'); }
  });
  server.listen(9999, '127.0.0.1', () => mainWindow.loadURL('http://127.0.0.1:9999'));
  mainWindow.on('closed', () => server.close());
}

async function ensureAuth() {
  const a = await loadAuth();
  if (!a) throw new Error('未配置认证参数,请先在"认证"页面输入 token');
  return a;
}

// ==================== 认证 IPC ====================

ipcMain.handle('auth:save', async (_e, token) => saveAuth(token));
ipcMain.handle('auth:load', async () => loadAuth());
ipcMain.handle('auth:clear', async () => clearAuth());

ipcMain.handle('auth:checkTokenStatus', async () => {
  return checkTokenStatus();
});

ipcMain.handle('auth:getCaptcha', async () => {
  return getLoginCaptcha();
});

ipcMain.handle('auth:login', async (_e, params) => {
  const result = await loginByPassword(params);
  if (result.success && result.token) {
    const auth = await saveAuth(result.token);
    if (params.remember) {
      await saveCredentials(params.username, params.password);
    } else {
      await clearCredentials();
    }
    return { ...result, auth };
  }
  return result;
});

ipcMain.handle('auth:loadCredentials', async () => {
  return loadCredentials();
});

ipcMain.handle('auth:clearCredentials', async () => {
  return clearCredentials();
});

// ==================== 课程 IPC ====================

ipcMain.handle('course:resolveTerm', async () => {
  const a = await ensureAuth();
  return resolveCurrentTermId(a.token);
});

ipcMain.handle('course:search', async (_e, params) => {
  const a = await ensureAuth();
  const result = await searchCourses(a.token, params);
  if (result.data.length > 0) {
    try {
      const teachIds = result.data.map(c => String(c.teachId));
      const caps = await getCourseCapacity(a.token, teachIds);
      const capMap = new Map(caps.map(c => [String(c.teachId), c]));
      result.data = result.data.map(c => ({ ...c, ...(capMap.get(String(c.teachId)) || {}) }));
    } catch (_) { /* capacity fetch best-effort */ }
  }
  return result;
});

ipcMain.handle('course:listPreferred', async () => {
  const a = await ensureAuth();
  return listPreferredCourses(a.token);
});

ipcMain.handle('course:apply', async (_e, params) => {
  const a = await ensureAuth();
  return applyCourse(a.token, params.teachId, params);
});

ipcMain.handle('course:select', async (_e, params) => {
  const a = await ensureAuth();
  const result = await selectCourse(a.token, params.teachId);
  console.log('[course:select] raw:', JSON.stringify(result.raw));
  return result;
});

ipcMain.handle('course:checkChooseTime', async (_e, params) => {
  const a = await ensureAuth();
  return checkChooseTime(a.token, params.teachId);
});

ipcMain.handle('course:listMySelections', async (_e, pageOpts) => {
  const a = await ensureAuth();
  return listMySelections(a.token, pageOpts || {});
});

ipcMain.handle('course:listMyApplications', async (_e, pageOpts) => {
  const a = await ensureAuth();
  const pageSize = (pageOpts && pageOpts.pageSize) || 100;
  let pageNum = (pageOpts && pageOpts.pageNum) || 1;
  let allData = [];
  let total = 0;
  const MAX_PAGES = 20;
  while (pageNum <= MAX_PAGES) {
    const page = await listMyApplications(a.token, { pageNum, pageSize });
    allData = allData.concat(page.data);
    total = page.total;
    if (allData.length >= total || page.data.length < pageSize) break;
    pageNum++;
  }
  return { total, data: allData };
});

ipcMain.handle('course:cancelApplication', async (_e, applyId) => {
  const a = await ensureAuth();
  return cancelApplication(a.token, applyId);
});

ipcMain.handle('course:getCapacity', async (_e, teachIds) => {
  const a = await ensureAuth();
  return getCourseCapacity(a.token, teachIds);
});

ipcMain.handle('course:updateChooseScore', async (_e, params) => {
  const a = await ensureAuth();
  return updateChooseScore(a.token, params.applyId, params.termId, params.chooseScore);
});

// ==================== 服务端时间同步 ====================

ipcMain.handle('course:syncServerTime', async () => {
  const a = await ensureAuth();
  const client = createClient(a.token);
  let totalOffset = 0, samples = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      const resp = await client.get('/course-choose-overview/getParameters', { timeout: 5000, validateStatus: () => true });
      const t1 = Date.now();
      const serverDate = resp.headers['date'];
      if (serverDate) {
        const serverTime = new Date(serverDate).getTime();
        const rtt = t1 - t0;
        const offset = serverTime - (t0 + rtt / 2);
        totalOffset += offset; samples++;
      }
    } catch (_) {}
  }
  const avgOffset = samples > 0 ? Math.round(totalOffset / samples) : 0;
  return { offset: avgOffset, samples, serverTime: Date.now() + avgOffset };
});

// ==================== App 生命周期 ====================

app.whenReady().then(() => {
  createWindow();
  startTokenHeartbeat((reason) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:tokenExpired', reason);
    }
  });
});

app.on('window-all-closed', () => {
  stopTokenHeartbeat();
  if (process.platform !== 'darwin') app.quit();
});
