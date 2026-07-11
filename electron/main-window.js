const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { saveAuth, loadAuth, clearAuth } = require('../src/main/auth-store');
const { resolveCurrentTermId } = require('../src/main/term-resolver');
const { applyCourse, cancelApplication, checkTokenHeartbeat, getCourseCapacity, listMyApplications, listPreferredCourses, searchCourses } = require('../src/main/course-api');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) {
    mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }
}

ipcMain.handle('auth:save', async (_e, token) => saveAuth(token));
ipcMain.handle('auth:load', async () => loadAuth());
ipcMain.handle('auth:clear', async () => clearAuth());
ipcMain.handle('auth:checkTokenStatus', async () => {
  const auth = await loadAuth();
  if (!auth) return { state: 'unknown' };
  try {
    const payload = JSON.parse(Buffer.from(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
    if (payload.exp && Date.now() >= payload.exp * 1000) return { state: 'expired', reason: 'token 已过期(超过 JWT 有效期)' };
    const heartbeat = await checkTokenHeartbeat(auth.token);
    return heartbeat.valid ? { state: 'valid', expiresAt: payload.exp ? payload.exp * 1000 : null } : { state: 'expired', reason: heartbeat.message };
  } catch (err) {
    return { state: 'unknown', reason: `网络异常: ${String(err && err.message || err)}` };
  }
});

ipcMain.handle('course:resolveTerm', async () => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return resolveCurrentTermId(auth.token);
});

ipcMain.handle('course:search', async (_e, params) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return searchCourses(auth.token, params);
});

ipcMain.handle('course:listPreferred', async () => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return listPreferredCourses(auth.token);
});

ipcMain.handle('course:apply', async (_e, params) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return applyCourse(auth.token, params.teachId, params);
});

ipcMain.handle('course:listMyApplications', async () => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return listMyApplications(auth.token);
});

ipcMain.handle('course:cancelApplication', async (_e, applyId) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return cancelApplication(auth.token, applyId);
});

ipcMain.handle('course:getCapacity', async (_e, teachIds) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return getCourseCapacity(auth.token, teachIds);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
