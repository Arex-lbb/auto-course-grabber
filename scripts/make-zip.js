const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release', 'win32-x64');
const zipPath = path.join(root, 'release', 'win32-x64.zip');

if (!fs.existsSync(releaseDir)) throw new Error(`missing release dir: ${releaseDir}`);
fs.rmSync(zipPath, { force: true });

function run(cmd, args, options) {
  execFileSync(cmd, args, { stdio: 'inherit', ...options });
}

function tryRun(cmd, args, options) {
  try {
    run(cmd, args, options);
    return true;
  } catch {
    return false;
  }
}

const isWin = process.platform === 'win32';
if (isWin) {
  if (!tryRun('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${releaseDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`], {})) {
    throw new Error('PowerShell Compress-Archive failed');
  }
} else {
  if (!tryRun('7z', ['a', '-tzip', zipPath, '.'], { cwd: releaseDir })) {
    if (!tryRun('zip', ['-r', zipPath, '.'], { cwd: releaseDir })) {
      throw new Error('Neither 7z nor zip is available');
    }
  }
}

console.log(zipPath);
