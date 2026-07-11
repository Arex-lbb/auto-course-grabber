import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { saveAuth, loadAuth, clearAuth } from './auth-store';
import { resolveCurrentTermId } from './term-resolver';
import { applyCourse, cancelApplication, checkTokenHeartbeat, getCourseCapacity, listMyApplications, listPreferredCourses, searchCourses } from './course-api';
import type { CourseSearchParams } from '../shared/types';

let mainWindow: any = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 840,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) {
    mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  }
}

ipcMain.handle('auth:save', (_e: any, token: string) => saveAuth(token));
ipcMain.handle('auth:load', () => loadAuth());
ipcMain.handle('auth:clear', () => clearAuth());
ipcMain.handle('auth:checkTokenStatus', async () => {
  const auth = await loadAuth();
  if (!auth) return { state: 'unknown' };
  try {
    const payload = JSON.parse(Buffer.from(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')) as { exp?: number };
    if (payload.exp && Date.now() >= payload.exp * 1000) return { state: 'expired', reason: 'token 已过期(超过 JWT 有效期)' };
    const heartbeat = await checkTokenHeartbeat(auth.token);
    return heartbeat.valid ? { state: 'valid', expiresAt: payload.exp ? payload.exp * 1000 : null } : { state: 'expired', reason: heartbeat.message };
  } catch (err) {
    return { state: 'unknown', reason: `网络异常: ${String((err as Error).message || err)}` };
  }
});

ipcMain.handle('course:resolveTerm', async () => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return resolveCurrentTermId(auth.token);
});

ipcMain.handle('course:search', async (_e: any, params: CourseSearchParams) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return searchCourses(auth.token, params);
});
ipcMain.handle('course:listPreferred', async () => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return listPreferredCourses(auth.token);
});
ipcMain.handle('course:apply', async (_e: any, params: { teachId: string; chooseScore?: number; ignoreTimeConflict?: boolean }) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return applyCourse(auth.token, params.teachId, params);
});
ipcMain.handle('course:listMyApplications', async () => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return listMyApplications(auth.token);
});
ipcMain.handle('course:cancelApplication', async (_e: any, applyId: string) => {
  const auth = await loadAuth();
  if (!auth) throw new Error('未配置认证参数,请先输入 token');
  return cancelApplication(auth.token, applyId);
});
ipcMain.handle('course:getCapacity', async (_e: any, teachIds: string[]) => {
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
