import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { app, safeStorage } from 'electron';
import type { AuthConfig, SavedCredentials } from '../shared/types';

function getAuthFilePath() {
  return path.join(app.getPath('userData'), 'auth.enc');
}

function getCredsFilePath() {
  return path.join(app.getPath('userData'), 'creds.enc');
}

// ==================== Token ====================

export async function saveAuth(token: string): Promise<AuthConfig> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('token 不能为空');
  const config: AuthConfig = { token: trimmed, updatedAt: new Date().toISOString() };
  const payload = JSON.stringify(config);
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(getAuthFilePath(), safeStorage.encryptString(payload));
  } else {
    await fs.writeFile(getAuthFilePath(), payload, 'utf-8');
  }
  return config;
}

export async function loadAuth(): Promise<AuthConfig | null> {
  try {
    const raw = await fs.readFile(getAuthFilePath());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8');
    return JSON.parse(text) as AuthConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export async function clearAuth(): Promise<void> {
  try {
    await fs.unlink(getAuthFilePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// ==================== 凭据（记住密码） ====================

export async function saveCredentials(username: string, password: string): Promise<void> {
  const payload = JSON.stringify({ username, password });
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(getCredsFilePath(), safeStorage.encryptString(payload));
  } else {
    await fs.writeFile(getCredsFilePath(), payload, 'utf-8');
  }
}

export async function loadCredentials(): Promise<SavedCredentials | null> {
  try {
    const raw = await fs.readFile(getCredsFilePath());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null;
    return parsed as SavedCredentials;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await fs.unlink(getCredsFilePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
