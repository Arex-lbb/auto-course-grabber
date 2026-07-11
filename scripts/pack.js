// pack.js - 统一打包脚本
// 用法: node scripts/pack.js
// 产出: release/win32-x64/ — 绿色免安装目录，双击 launcher.exe 启动

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'release', 'win32-x64');

// 1. 构建
console.log('[1/4] Vite build...');
execSync('npx vite build', { cwd: root, stdio: 'inherit' });

// 2. 修正 index.html (去 module type, 去 crossorigin)
console.log('[2/4] Fix index.html...');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf-8');
const scriptMatch = html.match(/<script[^>]*src="[^"]*"[^>]*><\/script>/);
if (scriptMatch) {
  html = html.replace(scriptMatch[0], '');
  html = html.replace('<div id="root"></div>', '<div id="root"></div>\n    ' + scriptMatch[0]);
}
html = html.replace(/src="\/assets\//g, 'src="./assets/');
html = html.replace(/href="\/assets\//g, 'href="./assets/');
html = html.replace(/type="module"/g, '');
html = html.replace(/ crossorigin="[^"]*"/g, '');
html = html.replace(/ crossorigin/g, '');
fs.writeFileSync(path.join(dist, 'index.html'), html);

// 3. 复制文件到 release
console.log('[3/4] Copy files...');
const skipNames = new Set(['.bin']);
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) { copyRecursive(fs.realpathSync(src), dest); return; }
  if (stat.isDirectory()) {
    if (skipNames.has(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyRecursive(path.join(src, entry), path.join(dest, entry));
  } else { fs.copyFileSync(src, dest); }
}

// Clean target (but keep launcher.exe and node_modules to avoid re-download)
const keepFiles = new Set(['launcher.exe', 'node_modules']);
if (fs.existsSync(out)) {
  for (const entry of fs.readdirSync(out)) {
    if (keepFiles.has(entry)) continue;
    const p = path.join(out, entry);
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
}
fs.mkdirSync(out, { recursive: true });

copyRecursive(dist, path.join(out, 'dist'));
copyRecursive(path.join(root, 'electron'), path.join(out, 'electron'));
copyRecursive(path.join(root, 'src'), path.join(out, 'src'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(out, 'package.json'));

// 确保 launcher.exe 存在
const launcherSrc = path.join(root, 'launcher.exe');
const launcherDst = path.join(out, 'launcher.exe');
if (fs.existsSync(launcherSrc)) {
  fs.copyFileSync(launcherSrc, launcherDst);
}

// 4. 写 README 和启动 bat（备用）
console.log('[4/4] Write launchers...');
fs.writeFileSync(path.join(out, '启动自动抢课工具.bat'),
  '@echo off\r\nsetlocal\r\nset "DIR=%~dp0"\r\n"%DIR%node_modules\\electron\\dist\\electron.exe" "%DIR%"\r\n');

fs.writeFileSync(path.join(out, 'README.txt'), [
  '西南交大自动抢课系统 - 绿色便携版',
  '=====================================',
  '',
  '【启动方式】双击 launcher.exe',
  '',
  '【如果报错 Unable to launch Electron runtime】',
  '  请检查 node_modules\\electron\\dist\\electron.exe 是否存在',
  '  如果不存在: 在此目录打开命令行, 运行 npm install electron',
  '  如果存在但报错: 安装 VC++ Redistributable',
  '  https://aka.ms/vs/17/release/vc_redist.x64.exe',
  '',
  '备用启动: 双击 启动自动抢课工具.bat',
  '',
  '【使用说明】',
  '  1. 身份认证页面输入教务系统 ytoken',
  '  2. 进入优选班课程自动加载列表',
  '  3. 选课或加入抢课队列',
  '  4. 设置参数后开始抢课',
  '',
  '【注意】Token 使用系统级加密存储，不会明文保存',
].join('\r\n'));

console.log('DONE: ' + out);
