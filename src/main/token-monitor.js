"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTokenStatus = checkTokenStatus;
exports.startTokenHeartbeat = startTokenHeartbeat;
exports.stopTokenHeartbeat = stopTokenHeartbeat;
const jwt_1 = require('./jwt');
const course_api_1 = require('./course-api');
const auth_store_1 = require('./auth-store');
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
let timer = null;
let keepAliveTimer = null;
async function checkTokenStatus() {
    const auth = await auth_store_1.loadAuth();
    if (!auth) return { state: 'unknown' };
    try {
        const payload = jwt_1.decodeJwtPayload(auth.token);
        if (payload.exp && Date.now() >= payload.exp * 1000) {
            return { state: 'expired', reason: 'token 已过期(超过 JWT 有效期)' };
        }
        const heartbeat = await course_api_1.checkTokenHeartbeat(auth.token);
        if (!heartbeat.valid) {
            return { state: 'expired', reason: heartbeat.message };
        }
        return { state: 'valid', expiresAt: payload.exp ? payload.exp * 1000 : null };
    }
    catch (err) {
        return { state: 'unknown', reason: `网络异常: ${String(err?.message || err)}` };
    }
}
function startTokenHeartbeat(onExpired) {
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
        const status = await checkTokenStatus();
        if (status.state === 'expired') onExpired(status.reason);
    }, HEARTBEAT_INTERVAL_MS);
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      (async () => {
        try {
          const auth = await auth_store_1.loadAuth();
          if (!auth) return;
          const alive = await course_api_1.keepAliveByStudentInfo(auth.token);
          if (!alive) onExpired('会话已失效,请重新登录');
        } catch { /* 保活异常静默，下次重试 */ }
      })();
    }, KEEPALIVE_INTERVAL_MS);
}
function stopTokenHeartbeat() {
    if (timer) { clearInterval(timer); timer = null; }
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}
