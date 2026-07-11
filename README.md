# 西南交大自动抢课系统（重写版）

> Electron + React + TypeScript 桌面应用 — 西南交通大学教务系统自动抢课工具

## 功能概览

| 模块 | 说明 |
|------|------|
| 身份认证 | 学号密码登录 / Token 手动粘贴 / 记住密码 / JWT 解析 |
| 优选班课程 | 一键拉取 + 容量展示 + 立即选课/加入队列 |
| 普通课程查询 | 关键词搜索 + 自动关联容量数据 + 学期配置 |
| 选课申请管理 | 全量分页加载 + 翻页 + 取消申请 |
| 抢课任务（容量监控） | 容量轮询 → 检测名额 → 并发抢课 → 重试退避 |
| 抢课任务（分组多班择一） | 同课多班按优先级回退，抢到任意一班即停 |
| 抢课任务（实时模式） | 服务端时间校准 → 精准卡点开火 → 多轮并发 |
| 可视化课表 | 已选课程 + 抢课任务合并展示 |
| 教师评分查询 | 搜索教师 → 评分/评价详情 |
| 运行日志 | 实时滚动 + 分级着色 |

## 技术栈

- **框架**: Electron 43 + React 18 + TypeScript 5.9
- **构建**: Vite 7
- **加密**: SM2 国密 (sm-crypto)
- **网络**: Axios (Keep-Alive 连接池 + 自动重试)
- **安全**: Electron safeStorage 加密存储 + contextIsolation

## 架构

```
Electron Shell
├── main.js          — IPC 处理器 + 内嵌 HTTP Server (:9999)
├── preload.js       — 安全桥接 (contextBridge)
└── Renderer (React)
    ├── App.tsx      — 根组件 + 8 个功能面板
    ├── core/        — 3 种抢课引擎
    ├── main/        — API 客户端 (12 个端点)
    └── components/  — 课表 / Toast
```

## 构建与运行

```bash
# 安装依赖
npm install

# 开发模式（Vite 热更新）
npm run dev

# 构建前端
npm run build

# Electron 运行
npm run electron

# 打包分发
npm run pack          # → release/win32-x64/
```

分发时压缩 `release/win32-x64/` 为 zip，解压后双击 `launcher.exe`（或运行 `启动自动抢课工具.bat`）。

## 项目结构

```
├── electron/          # Electron 主进程
│   ├── main.js        # 窗口管理 + IPC 处理 + 内嵌服务器
│   ├── preload.js     # 预加载脚本 (安全桥接)
│   └── main-window.js # 窗口工具
├── src/
│   ├── main.tsx       # React 入口
│   ├── App.tsx        # 根组件 (全部业务逻辑)
│   ├── App.css        # 暗色主题 (GitHub 风格)
│   ├── core/          # 抢课引擎
│   │   ├── grab-engine.ts    # 容量监控 / 分组多班择一
│   │   ├── realtime-grab.ts  # 实时卡点抢课
│   │   └── retry-policy.ts   # 重试策略
│   ├── main/          # 后端 API 层 (Node.js 主进程)
│   │   ├── request-client.js # HTTP 客户端
│   │   ├── course-api.js     # 教务 API (12 端点)
│   │   ├── auth-store.js     # Token/凭据存储
│   │   ├── sm2.js            # SM2 国密加密
│   │   ├── jwt.js            # JWT 解析
│   │   ├── term-resolver.js  # 学期 ID
│   │   └── token-monitor.js  # Token 心跳保活
│   ├── shared/        # 类型 & 常量
│   ├── components/    # 课表 / Toast 组件
│   ├── lib/           # 工具函数
│   └── preload/       # Preload 类型定义
├── scripts/           # 打包脚本
├── docs/              # 技术文档
├── launcher.c         # Windows 启动器源码 (C)
├── index.html         # Vite 入口 HTML
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 安全

- Token/凭据使用操作系统级加密存储 (Electron safeStorage)
- 所有教务 API 请求参数经 SM2 国密加密
- 渲染进程上下文隔离 (`contextIsolation: true`)
- 支持手动粘贴 Token 免密登录

## License

Private — 仅供个人学习使用。
