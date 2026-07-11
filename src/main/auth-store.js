const { promises: fs } = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

function getAuthFilePath() {
  return path.join(app.getPath('userData'), 'auth.enc');
}

function getCredsFilePath() {
  return path.join(app.getPath('userData'), 'creds.enc');
}

// ==================== Token ====================

async function saveAuth(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new Error('token 不能为空');
  const config = { token: trimmed, updatedAt: new Date().toISOString() };
  const payload = JSON.stringify(config);
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(getAuthFilePath(), safeStorage.encryptString(payload));
  } else {
    await fs.writeFile(getAuthFilePath(), payload, 'utf-8');
  }
  return config;
}

async function loadAuth() {
  try {
    const raw = await fs.readFile(getAuthFilePath());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8');
    return JSON.parse(text);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
}

async function clearAuth() {
  try {
    await fs.unlink(getAuthFilePath());
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}

// ==================== 凭据（记住密码） ====================

async function saveCredentials(username, password) {
  const payload = JSON.stringify({ username, password });
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(getCredsFilePath(), safeStorage.encryptString(payload));
  } else {
    await fs.writeFile(getCredsFilePath(), payload, 'utf-8');
  }
}

async function loadCredentials() {
  try {
    const raw = await fs.readFile(getCredsFilePath());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null;
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
}

async function clearCredentials() {
  try {
    await fs.unlink(getCredsFilePath());
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}

module.exports = { saveAuth, loadAuth, clearAuth, saveCredentials, loadCredentials, clearCredentials };
