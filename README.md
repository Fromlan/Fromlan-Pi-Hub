<!--
  Fromlan Pi Hub README
  中文为主，英文为副。不展示目录结构。
-->
# Fromlan Pi Hub

> **Windows 上的本地 AI Agent 工作站。**
> — 在自己的机器上，构建、管理、调度自主 AI Agent。
<p align="center">
  <img src="assets/banner.jpg" alt="Fromlan Pi Hub — Multi-session RPC client for pi" width="100%">
</p>

**中文** · [English](#fromlan-pi-hub-1)

---

## 这是什么？

Fromlan Pi Hub 是面向 [pi](https://pi.dev) 的桌面工作台。它将多个 `pi --mode rpc` 子进程的管理从命令行提升为图形界面，提供会话隔离、看板追踪、Agent 编排和周期调度能力。所有数据存储在本地，API 密钥沿用 pi 自身的 `~/.pi/agent/auth.json`。

### 设计理念

- **Agent 是一等公民。** Agent 是被分派任务的执行单元，而非被调用的工具。它接收上下文、选择策略、执行并回报结果。
- **任务导向。** 默认视图是待办看板——展示工作项的状态流转——而非消息时间线。聊天记录退居为执行日志。
- **本地优先。** 不上传数据到任何中间服务器，不注入遥测。代码、密钥、持久化文件均留在本机。
- **进程隔离。** 每个会话对应一个独立的 pi 子进程，拥有独立的工作目录和环境变量。单个会话崩溃不影响其他会话。
- **Agent 隔离。** 会话绑定 Agent 后，pi 以全局禁用参数启动，仅显式加载该 Agent 的专属插件，确保工具集可见范围严格收敛。

---

## 架构

Fromlan Pi Hub 采用**三进程模型**，追求进程隔离和崩溃恢复：

```
┌──────────────────────────────────────────────────┐
│  渲染进程 (React 19 + Zustand)                     │
│  Kanban · IssueDetail · MessageList · Composer     │
│  store.applyEvent 增量拼接流式输出                    │
└──────────────────┬───────────────────────────────┘
                   │ contextBridge (preload)
                   │ sessionAPI / appAPI / pluginAPI / agentAPI / issueAPI
┌──────────────────┴───────────────────────────────┐
│  主进程 (Electron)                                 │
│  ipcMain.handle  +  事件 broadcast                  │
│                                                   │
│  SessionManager — 多会话状态机                       │
│  PiRpcClient — 每会话一个                           │
│  IssueStore / AgentManager / PluginManager         │
│  TaskMonitor / SquadManager / AutopilotManager     │
└──────────────────┬───────────────────────────────┘
                   │ stdin/stdout (JSONL)
          ┌────────┴────────┐  ┌────────────────┐
          │ pi --mode rpc   │  │ pi --mode rpc  │  …
          │ (会话 A)         │  │ (会话 B)         │
          └─────────────────┘  └────────────────┘
```

### 关键设计决策

**pi 是外部依赖，绝不内置。** 应用通过 `spawn pi --mode rpc` 启动子进程，经 stdin/stdout JSONL 通信。这意味着：
- pi 独立升级——不需要重建应用。
- API 密钥留在 `~/.pi/agent/auth.json`，GUI 碰不到。
- 崩溃隔离：死掉的 pi 进程只影响一个会话，不影响整个应用。

**一个会话 = 一个 pi 进程。** 每个对话标签拥有独立的子进程、独立的工作目录、独立的 Agent 绑定、独立的环境变量。会话之间不共享状态，关闭标签只杀掉那个进程。

**Agent 隔离通过 CLI 参数实现。** 当会话绑定 Agent 时，pi 以 `--no-extensions --no-skills --no-prompt-templates --no-context-files` 启动，然后显式注入该 Agent 专属的插件文件。这保证了会话只能看到指定 Agent 的工具集——全局配置完全不可见。

**环境变量白名单，而非透传。** 父进程的环境变量**不**转发给 pi 子进程——只复制一份严格的系统路径白名单（`PATH`、`SYSTEMROOT` 等）。所有 `*_API_KEY*`、`*_SECRET*`、`*_TOKEN*` 模式会被强制剔除。杜绝 fork 导致的凭据泄露。

**Issue 与 Session 的关系是 1:N。** Issue 是工作单元；Session 是执行尝试。一个 Issue 可以派生多个 Session（重试、替代方案、后续任务）。看板才是"真相之源"——聊天记录只是执行日志。

---

## 功能

### 当前 (v0.4.0)
- **多会话管理** — 创建、监控、中止、关闭独立的 pi 会话
- **Kanban 看板** — 7 列 Issue 追踪（backlog → todo → in_progress → in_review → done / blocked / cancelled）
- **Issue 详情页** — 元数据、assignee 选择器、评论时间线、一键"Run"派生会话
- **流式 Markdown 渲染** — 助手回复实时逐字显示、代码高亮、thinking 折叠、工具调用可视化
- **Agent 管理** — 增删改独立 Agent，每个可配置私有的 prompts、skills、extensions
- **插件编辑器** — `~/.pi/agent/` 下全局 prompt 模板、skill、extension 的 CRUD
- **深色优先双主题** — OKLCH 色彩空间、Inter + Geist Mono 字体、离线可用

### 路线图
| 版本 | 主题 | 状态 |
|------|------|------|
| v0.4.0 | Issue + Kanban | ✅ 已发布 |
| v0.5.0 | 任务超时 / 重试 / 回滚 | 计划中 |
| v0.6.0 | Squad 路由（组长 Agent 派活给专员） | 计划中 |
| v0.7.0 | Agent Skills 标准对齐（SKILL.md） | 计划中 |
| v0.8.0 | Autopilot Cron 调度 | 计划中 |
| v0.9.0 | Inbox + 桌面通知 | 计划中 |
| v1.0.0 | 正式 GA —— 完整的本地 Agent 工作台 | 目标 |

### 明确不做
- 多 CLI 支持 — **只做 pi**，这是立项定位
- 云端运行时、WebSocket 队列、多人协作
- 远程 `/reload` 注入（提示用户手动 reload）

---

## 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org) | ≥ 18 | 运行与构建 |
| [pi](https://pi.dev) | ≥ 0.80.6 | 必须在 PATH 中，应用启动时会调用 `where pi` |
| API 密钥 | — | 通过 pi 自带的 `auth.json` 配置，路径 `~/.pi/agent/auth.json` |

> **本应用不内置 pi，也不管理密钥。** 如果终端里 `pi --print "你好"` 跑不通，应用也跑不通。

---

## 快速开始

```bash
git clone https://github.com/Fromlan/Fromlan-Pi-Hub.git
cd Fromlan-Pi-Hub

npm install
npm run dev       # 开发模式，自动开窗 + DevTools
npm run dist      # 打便携 .exe → release/
npm run typecheck # 全量类型检查
```

---

## 技术栈

- **运行时**: Electron 33 + electron-vite
- **UI**: React 19 + TypeScript + Zustand 5
- **富文本**: react-markdown + remark-gfm + rehype-highlight
- **图标**: lucide-react（不用 emoji）
- **打包**: electron-builder（Windows 便携版 `.exe`）
- **子进程**: pi RPC 模式（stdin/stdout JSONL 分帧）

---

## 常见问题

**新建会话时提示"未找到可用模型"？**
pi 未配置有效密钥。请先在命令行运行 `pi` 完成 provider 登录。

**助手无回复 / 回复为空？**
多为 API 密钥失效或余额不足。可用 `pi --print "test"` 验证。

**出现红色错误提示，消息保留在输入框？**
消息未能送达 pi 进程（进程已退出或 stdin 已关闭）。文本已保留，重试即可。

**找不到 pi？**
确保 pi 已全局安装，且 `where pi`（Windows）能返回路径。应用出于安全原因优先选择 `.exe` 而非 `.cmd/.bat`。

---

## 参考链接

- [pi 官方文档](https://pi.dev/docs/latest)
- [pi RPC 模式](https://pi.dev/docs/latest/rpc)
- [Anthropic Agent Skills 标准](https://agentskills.io)
- [DESIGN.md](./DESIGN.md) — 视觉设计系统
- [ROADMAP.md](./ROADMAP.md) — 完整迭代路线图

---

# Fromlan Pi Hub

<p align="center">
  <img src="assets/banner.jpg" alt="Fromlan Pi Hub — Multi-session RPC client for pi" width="100%">
</p>

> **The local-first AI agent workstation for Windows.**
> — Build, manage, and orchestrate autonomous AI agents on your own machine.

[中文](#fromlan-pi-hub) · **English**

---

## What Is This?

Fromlan Pi Hub is a desktop workbench for [pi](https://pi.dev). It elevates the management of multiple `pi --mode rpc` child processes from the command line to a graphical interface, providing session isolation, Kanban tracking, agent orchestration, and periodic scheduling. All data stays local; API keys are read exclusively from pi's own `~/.pi/agent/auth.json`.

### The Philosophy

- **Agent = first-class citizen.** An agent is an autonomous execution unit that receives context, selects a strategy, executes, and reports back — not a function you invoke.
- **Task-oriented.** The default view is a Kanban board showing work-item state transitions, not a message timeline. Chat history is execution log, not primary interface.
- **Local-first.** No data leaves the machine. No telemetry, no middleware, no SaaS. Code, keys, and persistence all live on the filesystem.
- **Process isolation.** Each session is an independent pi subprocess with its own working directory and environment. One crashed session never takes down others.
- **Agent isolation.** When a session binds to an agent, pi is launched with all global plugins disabled, then the agent's private toolkit is explicitly injected. Visibility is strictly scoped.

---

## Architecture

Fromlan Pi Hub uses a **three-process model** designed for process isolation and crash resilience:

```
┌──────────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand)                    │
│  Kanban · Issue Detail · MessageList · Composer   │
│  store.applyEvent — incremental stream stitching  │
└──────────────────┬───────────────────────────────┘
                   │ contextBridge (preload)
                   │ sessionAPI / appAPI / pluginAPI / agentAPI / issueAPI
┌──────────────────┴───────────────────────────────┐
│  Main Process (Electron)                          │
│  ipcMain.handle  +  event broadcast               │
│                                                   │
│  SessionManager — multi-session state machine      │
│  PiRpcClient — one per session                    │
│  IssueStore / AgentManager / PluginManager         │
│  TaskMonitor / SquadManager / AutopilotManager     │
└──────────────────┬───────────────────────────────┘
                   │ stdin/stdout (JSONL)
          ┌────────┴────────┐  ┌────────────────┐
          │ pi --mode rpc   │  │ pi --mode rpc  │  …
          │ (session A)     │  │ (session B)     │
          └─────────────────┘  └────────────────┘
```

### Key Design Decisions

**Pi is external, never embedded.** The app spawns `pi --mode rpc` as a child process and communicates over stdin/stdout JSONL. This means:
- pi updates independently — no app rebuild needed.
- API keys stay in `~/.pi/agent/auth.json`, never touched by the GUI.
- Crash isolation: a dead pi process kills one session, not the whole app.

**One session = one pi process.** Each conversation tab gets its own subprocess with its own working directory, agent binding, and environment. Sessions don't share state, and closing a tab kills only that process.

**Agent isolation via CLI flags.** When a session binds to an agent, pi is launched with `--no-extensions --no-skills --no-prompt-templates --no-context-files`, then the agent's specific plugins are explicitly injected. This guarantees the session sees only the agent's toolkit — nothing from global config leaks in.

**Env whitelist, not passthrough.** Parent process environment variables are NOT forwarded to pi children — only a strict allowlist of system paths is copied. All `*_API_KEY*`, `*_SECRET*`, `*_TOKEN*` patterns are stripped from any explicit `env` overrides. No credential leak through forking.

**Issue → Session = 1:N.** An issue is a unit of work; sessions are execution attempts. One issue can spawn multiple sessions (retries, alternative approaches, follow-ups). The Kanban board is the source of truth — chats are execution logs.

---

## Features

### Current (v0.4.0)
- **Multi-session management** — spawn, monitor, abort, and close independent pi sessions
- **Kanban board** — 7-column issue tracker (backlog → todo → in_progress → in_review → done / blocked / cancelled)
- **Issue detail view** — metadata, assignee picker, comment timeline, one-click "Run" to spawn a session
- **Streaming Markdown rendering** — real-time assistant output with code highlighting, thinking fold, tool call visualization
- **Agent management** — create/edit/delete isolated agents with private prompts, skills, and extensions
- **Plugin editor** — CRUD for global prompt templates, skills, and extensions under `~/.pi/agent/`
- **Dark-first dual-theme** — OKLCH color space, Inter + Geist Mono fonts, no external network dependency

### Roadmap
| Stage | Theme | Status |
|-------|-------|--------|
| v0.4.0 | Issue + Kanban | ✅ Released |
| v0.5.0 | Task timeout / retry / rollback | Planned |
| v0.6.0 | Squad routing (leader agent dispatches to specialists) | Planned |
| v0.7.0 | Agent Skills standard alignment (SKILL.md) | Planned |
| v0.8.0 | Autopilot cron scheduling | Planned |
| v0.9.0 | Inbox + desktop notifications | Planned |
| v1.0.0 | GA — complete local Agent workstation | Target |

### Explicitly Out of Scope
- Multi-CLI support — **pi only**, by design
- Cloud runtimes, WebSocket queues, multi-user collaboration
- Remote `/reload` injection (we prompt the user to reload manually)

---

## Prerequisites

| Dependency | Version | Why |
|------------|---------|-----|
| [Node.js](https://nodejs.org) | ≥ 18 | Runtime & build |
| [pi](https://pi.dev) | ≥ 0.80.6 | Must be on PATH; the app calls `where pi` at startup |
| API key | — | Configured via pi's own `auth.json` at `~/.pi/agent/auth.json` |

> **This app does not ship pi and does not handle API keys.** If `pi --print "hello"` doesn't work in your terminal, the app won't work either.

---

## Quick Start

```bash
git clone https://github.com/Fromlan/Fromlan-Pi-Hub.git
cd Fromlan-Pi-Hub

npm install
npm run dev       # dev mode with HMR + DevTools
npm run dist      # portable .exe → release/
npm run typecheck # full type check
```

---

## Tech Stack

- **Runtime**: Electron 33 + electron-vite
- **UI**: React 19 + TypeScript + Zustand 5
- **Markdown**: react-markdown + remark-gfm + rehype-highlight
- **Icons**: lucide-react (no emoji)
- **Packaging**: electron-builder (Windows portable `.exe`)
- **Subprocess**: pi RPC mode (stdin/stdout JSONL framing)

---

## FAQ

**"No available models" when creating a session?**
pi has no valid API key configured. Run `pi` in a terminal first to complete provider login.

**Assistant returns empty or nothing?**
Likely a dead API key or quota exhaustion. Verify with `pi --print "test"`.

**"Red error" flashes and message stays in input?**
The message failed to deliver to the pi process (process died or stdin closed). The text is preserved — just retry.

**Can't find pi?**
Ensure pi is globally installed and `where pi` (Windows) returns a path. The app prefers `.exe` over `.cmd/.bat` for security.

---

## Reference

- [pi Documentation](https://pi.dev/docs/latest)
- [pi RPC Mode](https://pi.dev/docs/latest/rpc)
- [Anthropic Agent Skills Standard](https://agentskills.io)
- [DESIGN.md](./DESIGN.md) — visual design system
- [ROADMAP.md](./ROADMAP.md) — full iteration plan
