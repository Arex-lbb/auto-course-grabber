import { decodeJwtPayload } from './jwt';
import { checkTokenHeartbeat, keepAliveByStudentInfo } from './course-api';
import { loadAuth } from './auth-store';

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 分钟——检测 token 是否过期
const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟——请求学生信息保活

export type TokenStatus =
  | { state: 'unknown' }
  | { state: 'valid'; expiresAt: number | null }
  | { state: 'expired'; reason: string };

let timer: ReturnType<typeof setInterval> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 检查一次 token 状态：先本地 JWT exp 判断，再发轻量心跳请求确认。
 * 两层判断的原因：教务系统可能在 exp 到期前主动使 token 失效（如异地登录）。
 */
export async function checkTokenStatus(): Promise<TokenStatus> {
  const auth = await loadAuth();
  if (!auth) return { state: 'unknown' };

  try {
    const payload = decodeJwtPayload(auth.token);
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return { state: 'expired', reason: 'token 已过期(超过 JWT 有效期)' };
    }

    const heartbeat = await checkTokenHeartbeat(auth.token);
    if (!heartbeat.valid) {
      return { state: 'expired', reason: heartbeat.message };
    }

    return { state: 'valid', expiresAt: payload.exp ? payload.exp * 1000 : null };
  } catch (err) {
    return { state: 'unknown', reason: `网络异常: ${String((err as Error)?.message || err)}` };
  }
}

/**
 * 启动定时心跳 + 会话保活。
 * @param onExpired token 过期回调（用于推送到渲染进程）
 */
export function startTokenHeartbeat(onExpired: (reason: string) => void): void {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    const status = await checkTokenStatus();
    if (status.state === 'expired') onExpired(status.reason);
  }, HEARTBEAT_INTERVAL_MS);

  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => {
    (async () => {
      try {
        const auth = await loadAuth();
        if (!auth) return;
        const alive = await keepAliveByStudentInfo(auth.token);
        if (!alive) onExpired?.('会话已失效,请重新登录');
      } catch { /* 保活异常静默，下次重试 */ }
    })();
  }, KEEPALIVE_INTERVAL_MS);
}

export function stopTokenHeartbeat(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}
