# Fromlan Pi Hub

> 一个 Electron 桌面客户端，让你在图形界面中快速创建 [pi](https://pi.dev) 进程进行多标签并行对话。

每个对话标签对应一个独立的 `pi --mode rpc` 子进程，通过 JSONL 协议通信，进程隔离、互不影响。API 密钥复用 pi 已有的配置，客户端本身不管理密钥。

---

## 功能特性

- **多标签并行会话**：像聊天软件一样开多个对话，每个标签是一个独立的 pi 子进程
- **快速创建会话**：新建时从 pi 动态拉取可用模型（`get_available_models`），下拉选择 provider / model / 工作目录
- **流式富文本渲染**：助手回复实时逐字显示，支持 Markdown（代码高亮、表格）
- **思考与工具可视化**：thinking 过程、工具调用及其结果以可折叠卡片展示
- **会话控制**：中止（abort）、关闭标签（kill）、状态实时指示（启动中 / 空闲 / 运行中 / 压缩中 / 已退出）
- **复用 pi 配置**：API 密钥由 pi 的 `AuthStorage` 从 `~/.pi/agent/auth.json` 读取，UI 不碰密钥
- **双主题设计系统**：OKLCH 色彩、深色默认 / 浅色可切换，内嵌 Inter + Geist Mono 字体（离线可用）

---

## 前置要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 18 | 运行与构建 |
| [pi](https://pi.dev) | ≥ 0.80.6 | 必须已安装且可通过 `where pi` / `which pi` 找到 |
| 有效的 API 密钥 | — | 用 `pi` 命令配置至少一个 provider（写入 `~/.pi/agent/auth.json`） |

> **重要**：客户端不内置 pi，也不管理密钥。请先确保命令行里 `pi` 能正常对话，客户端才能工作。

---

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（热重载，自动打开窗口与 DevTools）
npm run dev

# 生产构建（产出 dist/）
npm run build

# 打包为 Windows 便携版 .exe（产出 release/）
npm run dist

# 类型检查
npm run typecheck
```

启动后点击标签栏的 `＋` 新建会话，选择模型即可开始对话。

---

## 技术栈

- **渲染进程**：React 19 + TypeScript + [zustand](https://github.com/pmndrs/zustand) 状态管理
- **富文本**：react-markdown + remark-gfm + rehype-highlight
- **桌面框架**：Electron 33 + [electron-vite](https://electron-vite.org)（开发/构建）
- **打包**：electron-builder（便携版 .exe）
- **进程通信**：pi RPC 模式（stdin/stdout JSONL）

---

## 架构

```
┌─────────────────────────────────────────────────┐
│  渲染进程 (React + zustand)                        │
│  App · TabBar · NewSessionDialog · MessageList    │
│  · Composer · store(applyEvent 增量拼接流式)        │
└───────────────┬─────────────────────────────────┘
                │ contextBridge (preload)
                │ sessionAPI / appAPI
┌───────────────┴─────────────────────────────────┐
│  主进程 (Electron main)                           │
│  ipcMain.handle  +  事件 broadcast                │
│  ┌─────────────────────────────────────────┐     │
│  │ SessionManager  多会话 + 状态机 + snapshot │     │
│  │   ┌───────────────────────────────────┐   │     │
│  │   │ PiRpcClient  (每会话一个)          │   │     │
│  │   │  spawn pi --mode rpc              │   │     │
│  │   │  JSONL 分帧 · request/response    │   │     │
│  │   └──────────────┬────────────────────┘   │     │
│  └──────────────────┼─────────────────────────┘     │
└─────────────────────┼───────────────────────────┘
                      │ stdin/stdout (JSONL)
              ┌───────┴────────┐  ┌────────────────┐
              │ pi --mode rpc  │  │ pi --mode rpc  │  …
              │  (会话 1)       │  │  (会话 2)       │
              └────────────────┘  └────────────────┘
```

**数据流**：
1. 用户在 `Composer` 发消息 → `sessionAPI.prompt` → 主进程 `SessionManager.prompt` → `PiRpcClient` 写入子进程 stdin
2. pi 子进程流式输出 JSONL 事件 → `PiRpcClient` 分帧解析 → `SessionManager` 更新状态并转发 → 主进程 `broadcast` → 渲染进程 `store.applyEvent` 增量拼接 → UI 实时刷新

---

## 目录结构

```
Fromlan-Pi-Hub/
├── DESIGN.md                    # 外观设计文档（色彩/字体/组件规范）
├── README.md
├── package.json
├── electron.vite.config.ts      # main/preload/renderer 三段构建配置
├── tsconfig.{json,node,web}.json
└── src/
    ├── shared/
    │   └── types.ts             # IPC 通道常量 + 共享类型（单一事实源）
    ├── main/
    │   ├── index.ts             # app 生命周期、窗口、IPC 注册、事件广播
    │   ├── pi-rpc-client.ts     # 单个 pi 子进程封装：spawn、JSONL 分帧、request/response
    │   └── session-manager.ts   # 多会话管理、状态机、模型拉取
    ├── preload/
    │   └── index.ts             # contextBridge 安全暴露 sessionAPI / appAPI
    └── renderer/
        ├── App.tsx              # 布局 + IPC 事件订阅
        ├── store.ts             # zustand：sessions / messagesBySession / applyEvent
        ├── styles.css           # 设计系统 tokens + @font-face
        ├── fonts/               # 本地内嵌字体（Inter + Geist Mono）
        └── components/          # TabBar / NewSessionDialog / MessageList / MessageItem / Composer / StatusBadge
```

---

## 关键实现说明（Windows）

- **pi 路径解析**：`where pi` 优先选 `.exe`（`shell:false`，杜绝命令注入），否则退回 `.cmd/.bat`（`shell:true`），兜底裸 `pi`
- **JSONL 分帧**：严格按 `\n` 切分并剥离 `\r`，64MB 缓冲上限防止故障子进程刷屏导致 OOM
- **进程回收**：关闭标签或关窗时优雅关闭子进程（stdin EOF + 5s 兜底 kill），退出时 reject 所有挂起的请求
- **密钥不注入**：环境变量设 `NO_COLOR=1 FORCE_COLOR=0`，但不注入 API key，交由 pi 自己的 `auth.json`（优先级更高）

---

## 常见问题

**新建会话时提示"未找到可用模型"**
说明 pi 未配置有效密钥。请先在命令行运行 `pi` 完成 provider 登录 / API key 配置。
客户端会读取 `~/.pi/agent/auth.json` 中**所有已配置的 provider** 逐个尝试拉取模型，无需手动选择探测 provider。

**助手无回复 / 回复为空**
多为 API 密钥失效或余额不足。可用 `pi --print "你好"` 在命令行直接验证密钥是否可用。

**发送消息后 UI 显示"红色错误"并自动消失**
表示消息未能送达 pi 进程（常见于进程已退出 / stdin 已关闭）。文本已自动回填到输入框，可重试。

**找不到 pi**
确保 pi 已全局安装且 `where pi`（Windows）能返回路径。

---

## 相关文档

- [pi 官方文档](https://pi.dev/docs/latest)
- [pi RPC 模式](https://pi.dev/docs/latest/rpc)
- [pi SDK](https://pi.dev/docs/latest/sdk)
- 本项目设计规范见 [`DESIGN.md`](./DESIGN.md)
