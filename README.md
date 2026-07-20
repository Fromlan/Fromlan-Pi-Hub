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

Fromlan Pi Hub 是面向 [pi](https://pi.dev) 的桌面工作台。它将多个 `pi --mode rpc` 子进程的管理从命令行提升为图形界面，提供会话隔离、看板追踪、Agent 编排、周期调度、用量统计与订阅切换能力。所有数据存储在本地；API 密钥落在 `~/.pi/agent/auth.json`（可由 Hub「订阅」面板写入，或由 pi `/login` 配置）。

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
│  Kanban · Projects · Squads · Providers · Usage · Autopilots · Inbox   │
│  store.applyEvent 增量拼接流式输出                    │
└──────────────────┬───────────────────────────────┘
                   │ contextBridge (preload)
                   │ session / issue / project / squad / autopilot / inbox / …
┌──────────────────┴───────────────────────────────┐
│  主进程 (Electron)                                 │
│  ipcMain.handle  +  事件 broadcast                  │
│                                                   │
│  SessionManager · issue-runner · task-monitor      │
│  Project / Squad / Autopilot / Inbox / Settings    │
│  PluginManager · AgentManager · PiRpcClient        │
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
- API 密钥落在 `~/.pi/agent/auth.json`；Hub「订阅」可管理多套 Profile 并一键写入，子进程仍不经环境变量拿到密钥。
- 崩溃隔离：死掉的 pi 进程只影响一个会话，不影响整个应用。

**一个会话 = 一个 pi 进程。** 每个对话标签拥有独立的子进程、独立的工作目录、独立的 Agent 绑定、独立的环境变量。会话之间不共享状态，关闭标签只杀掉那个进程。

**Agent 隔离通过 CLI 参数实现。** 当会话绑定 Agent 时，pi 以 `--no-extensions --no-skills --no-prompt-templates --no-context-files` 启动，然后显式注入该 Agent 专属的插件文件。这保证了会话只能看到指定 Agent 的工具集——全局配置完全不可见。

**环境变量白名单，而非透传。** 父进程的环境变量**不**转发给 pi 子进程——只复制一份严格的系统路径白名单（`PATH`、`SYSTEMROOT` 等）。所有 `*_API_KEY*`、`*_SECRET*`、`*_TOKEN*` 模式会被强制剔除。杜绝 fork 导致的凭据泄露。

**Issue 与 Session 的关系是 1:N。** Issue 是工作单元；Session 是执行尝试。一个 Issue 可以派生多个 Session（重试、替代方案、后续任务）。看板才是"真相之源"——聊天记录只是执行日志。

**Task 是每一次派活。** Assign / `@mention` / Autopilot / Rerun / Squad 委派都产生一条 Task（六态：queued → dispatched → running → completed | failed | cancelled）。超时与可重试错误由 task-monitor 扫描；失败时 Issue 回滚到 `todo`。会话毒化时复用 workdir、丢弃续聊 session；成功摘要可提炼 Skill；派活会话可注入 `hub_*` 工具让 Agent 改看板状态。

**Project 是 Issue 分组，不是第二个工作区。** 一个 Issue 至多属于一个 Project；进度由关联 Issue 状态汇总。项目可配置 `defaultCwd`，派活时优先作为 pi 工作目录（对齐 Multica `local_directory`；不做 github_repo / 云仓库）。

---

## 功能

### 当前 (v0.9.x)
- **多会话管理** — 创建、监控、中止、关闭独立的 pi 会话；历史快照可继续对话
- **Kanban 看板** — Multica/Linear 风格：280px 列、状态 tint、`PriorityIcon` 卡片、Working chip；拖拽改状态；Assign 即派活；可按项目过滤
- **Projects** — Issue 多对一容器；状态 / 优先级 / Lead / 进度条；可选默认工作目录；删除项目只 unlink Issue
- **Issue 详情** — 文档主栏 + 右侧 Properties（含项目选择）；截止日期 / 父 Issue；评论 `@mention`；重新派活；Task 执行历史
- **任务可靠性** — 派活/执行双超时、错误分类重试（可配置）、失败写回评论 + 看板回滚；**毒化会话 resume**（钉住 `piSessionId`/workdir；毒化则同目录新会话；Issue 级 rerun 始终新会话；TaskHistory 逐行可续聊）
- **Squad 路由** — Leader 读 roster → `@` 成员 → 成员各自起 Task；成员回帖可再唤醒 Leader；归档时 Issue 转给 Leader；无 mention 时 `pick-first-member` 兜底
- **Autopilot** — cron 周期触发（创建 Issue 并派活 / 直接跑）；手动 Run now + 触发日志
- **Inbox + 桌面通知** — 仅给人看（被 mention / 指派 / 任务失败 / Skill 提炼提议）；Agent 不进 Inbox
- **订阅** — 多套 Provider Profile（含 API Key）；启用时写入 `~/.pi/agent/auth.json`（可选 `models.json` baseUrl）；可从现有 auth 导入；列表不回传明文 key
- **用量** — 会话结束采集 `get_session_stats`；按天 token/cost 图表（7/30/90 天）；按模型汇总；Task 历史可显示单次用量
- **Agent 主动协作** — 派活会话注入 `hub_*` 工具（改状态 / 报 blocker / 建子 Issue / 写评论）；本机 loopback 桥鉴权；Agent 已改状态则完成时不再盲目 `in_review`
- **Skill 复利** — 成功摘要末尾 `fromlan-skill` 围栏 → 写入 Agent/全局 skills；设置 `off | propose | auto`（默认 propose）
- **Pi Hub Helper** — 首次启动自动种子引导 Agent（对齐 Multica Helper）；欢迎弹窗三选一建 Issue 并派活；身份经 `IDENTITY.md` + `--append-system-prompt` 注入
- **Agent / Skill 管理** — 独立 Agent 目录隔离；全局与 Agent 级 `SKILL.md`；zip 导入 Skill
- **流式 Markdown** — 实时助手输出、代码高亮、thinking 折叠、工具调用可视化
- **设置** — 默认 provider/model/cwd、超时与重试、Skill 提炼模式、通知策略、主题

### 路线图
| 版本 | 主题 | 状态 |
|------|------|------|
| v0.4.0 | Issue + Kanban | ✅ |
| v0.5.0 | 任务超时 / 重试 / 回滚 | ✅ |
| v0.6.0 | Squad 路由 + `@mention` | ✅ |
| v0.7.0 | Agent Skills（SKILL.md + zip） | ✅ |
| v0.8.0 | Autopilot Cron | ✅ |
| v0.9.0 | Inbox + 桌面通知 | ✅ |
| v0.9.x | Projects + Squad 加深；Skill 提炼 / 毒化 resume / hub_*；用量 + 订阅 | ✅ |
| v1.0.0 | 正式 GA —— E2E 验收与发布打磨 | 目标 |

灵感来自 [Multica](https://github.com/multica-ai/multica) 的任务模型与编排哲学；实现为 **pi-only、纯本地、桌面原生**。详见 [ROADMAP.md](./ROADMAP.md)。

### 明确不做
- 多 CLI 支持 — **只做 pi**，这是立项定位
- 云端运行时、WebSocket 队列、多人协作 / 多 Workspace
- Project github_repo Resource、侧栏个人钉选、Labels
- Autopilot Webhook（仅 cron + Run now）
- 远程 `/reload` 注入（提示用户手动 reload）

---

## 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org) | ≥ 18 | 运行与构建 |
| [pi](https://pi.dev) | ≥ 0.80.6 | 必须在 PATH 中，应用启动时会调用 `where pi` |
| API 密钥 | — | `~/.pi/agent/auth.json`；可用 Hub「订阅」面板或 pi `/login` |

> **本应用不内置 pi。** 如果终端里 `pi --print "你好"` 跑不通，应用也跑不通。密钥可由 Hub 写入 auth.json，但运行时仍由 pi 自行读取。

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
- **调度**: node-cron + cronstrue
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

Fromlan Pi Hub is a desktop workbench for [pi](https://pi.dev). It elevates the management of multiple `pi --mode rpc` child processes from the command line to a graphical interface, providing session isolation, Kanban tracking, agent orchestration, periodic scheduling, usage charts, and provider profile switching. All data stays local; API keys live in pi's `~/.pi/agent/auth.json` (writable via Hub's Providers panel, or via `pi /login`).

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
│  Kanban · Projects · Squads · Providers · Usage · Autopilots · Inbox  │
│  store.applyEvent — incremental stream stitching  │
└──────────────────┬───────────────────────────────┘
                   │ contextBridge (preload)
                   │ session / issue / project / squad / autopilot / inbox / …
┌──────────────────┴───────────────────────────────┐
│  Main Process (Electron)                          │
│  ipcMain.handle  +  event broadcast               │
│                                                   │
│  SessionManager · issue-runner · task-monitor      │
│  Project / Squad / Autopilot / Inbox / Settings    │
│  PluginManager · AgentManager · PiRpcClient        │
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
- API keys live in `~/.pi/agent/auth.json`; Hub's Providers panel can manage profiles and write that file, but child processes never receive keys via env passthrough.
- Crash isolation: a dead pi process kills one session, not the whole app.

**One session = one pi process.** Each conversation tab gets its own subprocess with its own working directory, agent binding, and environment. Sessions don't share state, and closing a tab kills only that process.

**Agent isolation via CLI flags.** When a session binds to an agent, pi is launched with `--no-extensions --no-skills --no-prompt-templates --no-context-files`, then the agent's specific plugins are explicitly injected. This guarantees the session sees only the agent's toolkit — nothing from global config leaks in.

**Env whitelist, not passthrough.** Parent process environment variables are NOT forwarded to pi children — only a strict allowlist of system paths is copied. All `*_API_KEY*`, `*_SECRET*`, `*_TOKEN*` patterns are stripped from any explicit `env` overrides. No credential leak through forking.

**Issue → Session = 1:N.** An issue is a unit of work; sessions are execution attempts. One issue can spawn multiple sessions (retries, alternative approaches, follow-ups). The Kanban board is the source of truth — chats are execution logs.

**A Task is every dispatch.** Assign / `@mention` / Autopilot / Rerun / Squad delegation each create a Task (six states: queued → dispatched → running → completed | failed | cancelled). `task-monitor` enforces dual timeouts and classified retries; failures roll the Issue back to `todo`. Poisoned sessions reuse the workdir with a fresh conversation; successful summaries can extract Skills; dispatch sessions may inject `hub_*` tools so agents can update the board.

**A Project groups Issues — it is not a second workspace.** An Issue belongs to at most one Project; progress rolls up from linked Issue statuses. Optional `defaultCwd` becomes the preferred pi working directory on dispatch (Multica `local_directory` analogue; no github_repo / cloud checkout).

---

## Features

### Current (v0.9.x)
- **Multi-session management** — spawn, monitor, abort, close; resume from history snapshots
- **Kanban board** — Multica/Linear-style: 280px columns, status tint, `PriorityIcon` cards, Working chip; drag status; assign to auto-dispatch; filter by project
- **Projects** — many Issues → one Project; status / priority / lead / progress; optional default cwd; deleting a project only unlinks Issues
- **Issue detail** — document main + Properties (incl. project picker); due date / parent; comment `@mention`; rerun; Task history
- **Task reliability** — dual timeouts, classified retries, failure comments + board rollback; **poisoned-session resume** (pin `piSessionId`/workdir; poisoned → same cwd, fresh session; issue-level rerun always fresh; TaskHistory row retry can continue)
- **Squad routing** — leader reads roster → `@` members → member Tasks; member updates can re-wake the leader; archive transfers Issues to the leader; `pick-first-member` if mentions are missing
- **Autopilot** — cron triggers (create issue + dispatch / run); Run now + run log
- **Inbox + desktop notifications** — humans only (mention / assign / task failed / skill proposed); agents never read Inbox
- **Providers (subscriptions)** — Hub-managed profiles with API keys; activate writes `~/.pi/agent/auth.json` (optional `models.json` baseUrl); import from existing auth; list IPC never returns raw keys
- **Usage** — session `get_session_stats` → local jsonl; daily token/cost chart (7/30/90d); by-model table; TaskHistory shows per-run usage when present
- **Agent-driven PM** — dispatch sessions inject `hub_*` tools (set status / report blocker / create child issue / comment) via a localhost bridge; skips blind `in_review` if the agent already changed status
- **Skill compounding** — optional `fromlan-skill` fence in the success summary → write agent/global skills; settings `off | propose | auto` (default propose)
- **Pi Hub Helper** — first-run seed of a guide agent (Multica Helper analogue); welcome modal with three starter Issues; identity via `IDENTITY.md` + `--append-system-prompt`
- **Agent / Skill management** — per-agent isolation; global & agent `SKILL.md`; zip import
- **Streaming Markdown** — live output, code highlight, thinking fold, tool visualization
- **Settings** — default provider/model/cwd, timeouts/retries, skill extract mode, notify mode, theme

### Roadmap
| Stage | Theme | Status |
|-------|-------|--------|
| v0.4.0 | Issue + Kanban | ✅ |
| v0.5.0 | Task timeout / retry / rollback | ✅ |
| v0.6.0 | Squad routing + `@mention` | ✅ |
| v0.7.0 | Agent Skills (SKILL.md + zip) | ✅ |
| v0.8.0 | Autopilot cron | ✅ |
| v0.9.0 | Inbox + desktop notifications | ✅ |
| v0.9.x | Projects + Squad deepen; skill extract / poisoned resume / hub_*; usage + providers | ✅ |
| v1.0.0 | GA — E2E acceptance & release polish | Target |

Inspired by [Multica](https://github.com/multica-ai/multica)'s task model; implemented as **pi-only, local-first, desktop-native**. See [ROADMAP.md](./ROADMAP.md).

### Explicitly Out of Scope
- Multi-CLI support — **pi only**, by design
- Cloud runtimes, WebSocket queues, multi-user / multi-workspace
- Project github_repo resources, personal sidebar pins, Labels
- Autopilot webhooks (cron + Run now only)
- Remote `/reload` injection (we prompt the user to reload manually)

---

## Prerequisites

| Dependency | Version | Why |
|------------|---------|-----|
| [Node.js](https://nodejs.org) | ≥ 18 | Runtime & build |
| [pi](https://pi.dev) | ≥ 0.80.6 | Must be on PATH; the app calls `where pi` at startup |
| API key | — | `~/.pi/agent/auth.json`; Hub Providers panel or `pi /login` |

> **This app does not ship pi.** If `pi --print "hello"` doesn't work in your terminal, the app won't work either. Keys may be written by Hub into auth.json; at runtime pi still reads them itself.

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
- **Scheduling**: node-cron + cronstrue
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
