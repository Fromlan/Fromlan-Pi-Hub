# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Fromlan Pi Hub 是一个 Electron 桌面客户端，**不内置 pi，也不管理 API 密钥**。它通过图形界面启动多个独立的 `pi --mode rpc` 子进程（每个会话一个），通过 JSONL 协议通信。

产品定位：**Windows 上的 Multica 本地单机版** —— Kanban 派活、Project 分组、Task 可靠性、Squad 路由、Autopilot、Inbox；聊天为执行日志。只服务 pi，纯本地，无云。

前置依赖：全局安装 `pi`（≥ 0.80.6）且至少配置一个 provider（写入 `~/.pi/agent/auth.json`）。

## 常用命令

所有命令在仓库根目录执行：

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 启动 electron-vite 开发模式（自动开窗 + DevTools + 热重载） |
| `npm run build` | 生产构建，产出 `dist/`（main/preload/renderer 三段） |
| `npm run preview` | 构建后预览生产包 |
| `npm run dist` | 构建并打包为 Windows 便携 .exe（产出 `release/Fromlan-Pi-Hub-portable-x64.exe`，electron-builder） |

本地 `npm run dist` 走 [`scripts/dist.mjs`](scripts/dist.mjs)：默认用 npmmirror 拉 Electron / electron-builder 二进制（避免直连 GitHub 超时）；`win.signAndEditExecutable=false`（未签名 portable，跳过 winCodeSign 解压，否则 Windows 无「开发人员模式」时会因创建符号链接失败）。GitHub Actions 同样可用该脚本。覆盖镜像：预先设置 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`。
| `npm run typecheck` | 同时检查 main/preload 与 renderer 两侧类型 |
| `npm run typecheck:node` | 仅检查主进程 + preload + shared |
| `npm run typecheck:web` | 仅检查 renderer 端 |

## 发版（GitHub Release）

日常 push **不会**打包。仅推送 `v*` tag 时，`.github/workflows/release.yml` 在 Windows 上跑 `npm run dist`、用 GitHub 自动生成 Release Notes，并上传 `Fromlan-Pi-Hub-portable-*.exe`。

版本以 `package.json` 的 `version` 为准；tag 必须为同名 `vX.Y.Z`，否则 CI 校验失败。

```bash
# 1. 改 package.json version（例如 0.9.1）并 commit
git add package.json
git commit -m "chore: bump version to 0.9.1"

# 2. 打同名 tag 并推送
git tag v0.9.1
git push origin HEAD
git push origin v0.9.1
```

完成后在 GitHub Releases 页查看产物与更新说明。

## 架构

三进程模型，关注跨边界的数据流动：

```
渲染进程 (React + zustand)                主进程 (Electron)                    子进程
─────────────────────────────────      ──────────────────────            ──────────────
App / IconRail / Sidebar /               ipcMain.handle                    pi --mode rpc
KanbanPanel / IssueDetail /        ←→    SessionManager ─── PiRpcClient ──→ stdin/stdout
Squads / Projects / Autopilots /          issue-runner + task-monitor       (JSONL 协议)
Inbox / Composer / MessageList /          broadcast 事件 →
store.applyEvent 增量拼流                plugin/agent/squad/project/
store.setIssues / setTasks               autopilot/inbox/settings stores + persistence
                                         (env 白名单 + path/symlink 守卫)
```

**导航状态**：`activePanel`（chat | agents | plugins | settings | squads | projects | autopilots | inbox）+ `viewMode`（kanban | list | session）+ `activeSessionId` / `activePersistedId` / `activeIssueId` / `projectFilterId`。

**派活数据流**（Issue Assign / mention / cron）：
1. UI 或 Autopilot → `issueAPI` / 主进程钩子 → `issue-runner.maybeEnqueue` / `enqueueForAgent`
2. `task-store` 建 Task → `dispatch` → `SessionManager.start` + 注入 prompt
3. pi `agent_end` → 写评论 + Issue `in_review`（Squad Leader 则解析 mention 再派成员）
4. 失败 → `failTaskWithInfo`（分类 / 可选自动 retry）→ Issue 回滚 `todo`；耗尽则 Inbox 通知人

**聊天数据流**（用户发送消息时）：
1. `Composer` → `sessionAPI.prompt`（preload contextBridge 暴露）
2. 主进程 `SessionManager.prompt` → `PiRpcClient` 写入子进程 stdin
3. pi 流式输出 JSONL → `PiRpcClient` 分帧解析（按 `\n`，剥离 `\r`，64MB 缓冲上限）
4. `SessionManager` 更新状态 → 主进程 `broadcast` → 渲染进程 `store.applyEvent` 增量拼接 → UI 实时刷新

**会话状态机**：`starting → idle → busy → (compacting) → idle` 或 `→ exited`。  
**Task 状态机**：`queued → dispatched → running → completed | failed | cancelled`（对齐 Multica）。

UI 状态颜色映射见 `DESIGN.md`（黄/绿/蓝脉冲/紫脉冲/红）。

## 目录结构与职责

```
src/
├── shared/
│   ├── types.ts               # IPC 通道常量 + 共享类型（单一事实源）
│   └── mention.ts             # [@Name](mention://…) 解析与生成
├── main/
│   ├── index.ts               # app 生命周期、IPC 注册、事件广播
│   ├── session-manager.ts     # 多会话管理、状态机、get_available_models
│   ├── pi-rpc-client.ts       # 单个 pi 子进程：spawn、JSONL 分帧、request/response
│   ├── issue-runner.ts        # Issue→Task→Session 派活、Leader/mention/cron、失败重试
│   ├── task-store.ts          # tasks.json
│   ├── task-monitor.ts        # 双超时扫描（默认 5min / 2.5h）
│   ├── issue-store.ts         # issues.json + comments.json
│   ├── squad-store.ts         # squads.json
│   ├── project-store.ts       # projects.json
│   ├── autopilot-store.ts     # autopilots.json + autopilot_runs.json
│   ├── autopilot-manager.ts   # node-cron 调度
│   ├── inbox-store.ts         # inbox.json（仅人侧）
│   ├── notification.ts        # Electron Notification + 节流
│   ├── settings-store.ts      # settings.json（派活默认 / 超时 / 通知）
│   ├── plugin-manager.ts      # ~/.pi/agent/ CRUD + Skill zip 导入
│   ├── agent-manager.ts       # ~/.pi/agents/<name>/ CRUD
│   ├── agents-store.ts        # agent 元数据
│   └── persistence.ts         # session 历史 + getBaseDir()
├── preload/index.ts           # sessionAPI / appAPI / pluginAPI / agentAPI /
│                              # issueAPI / projectAPI / squadAPI / autopilotAPI / inboxAPI
└── renderer/
    ├── App.tsx                # 按 activePanel + viewMode 路由
    ├── store.ts               # zustand：sessions / issues / tasks / projects / squads / …
    ├── styles.css             # 设计系统 tokens（OKLCH）
    └── components/
        ├── IconRail.tsx       # 看板 / Projects / Agents / Squads / Plugins / Autopilots / Inbox / 设置
        ├── KanbanPanel.tsx / IssueCard.tsx / IssueDetail.tsx
        ├── PriorityIcon.tsx / IssueStatusIcon.tsx / ActorAvatar.tsx
        ├── TaskHistory.tsx / MentionPicker.tsx
        ├── SquadsPanel.tsx / ProjectsPanel.tsx / AutopilotsPanel.tsx / InboxPanel.tsx
        ├── ProjectPicker.tsx
        ├── AgentsPanel.tsx / PluginsPanel.tsx / SettingsPanel.tsx
        ├── StatusIcon.tsx     # 会话状态圆点（勿与 IssueStatusIcon 混淆）
        └── MessageList / Composer / SessionCard / …
```

持久化根目录：`{userData}/fromlan-pi-hub/`（issues / comments / tasks / squads / projects / autopilots / inbox / settings / sessions / messages）。

## 关键实现细节（修改前必读）

### Windows 特定的 pi 路径解析（src/main/）
`where pi` 优先选 `.exe`（`shell:false`，杜绝命令注入），否则退回 `.cmd/.bat`（`shell:true`），最后兜底裸 `pi`。**不要**直接传 `shell:true` 给 `.exe`，也不要假设 `pi` 在 PATH。`shell:true` 时会对 provider/model/cwd 等用户可控参数做元字符消毒。

### JSONL 分帧
严格按 `\n` 切分并剥离 `\r`，**64MB 缓冲上限**防止故障子进程刷屏导致 OOM。修改分帧逻辑时务必保留上限检查（超限时主动 reject pending + kill + 清缓冲）。

### 进程回收
关闭标签或关窗时要优雅关闭子进程：先 `stdin.end()`（EOF），等 5s 兜底再 `kill()`，**8s 绝对 finalize**（即使 kill 后无 exit 事件也必须 settle，避免 `killAll` 永久挂起）。`get_state` 失败与零消息意外退出都必须从 sessions map 移除并关闭子进程。退出时 `reject` 所有挂起的请求。

### Error 监听
`PiRpcClient` 在 stdout 超限 / child.on('error') 时会 emit `error`。主进程 `SessionManager` 必须订阅，否则 EventEmitter 默认在无 error 监听时抛未捕获异常带崩主进程。

### env 白名单（critical）
`PiRpcClient.spawn` **不再透传父进程 env**（早期版本曾 spread `...process.env`，会把 shell 中的 `*_API_KEY` 注入子进程）。改为白名单：仅 `PATH/PATHEXT/SYSTEMROOT/TEMP/TMP/HOME/USERPROFILE/HOMEDRIVE/HOMEPATH/LANG/LC_ALL/TZ` + `opts.env`（仍会二次剔除 `*API_KEY*/*SECRET*/*TOKEN*`）+ 强制 `NO_COLOR=1`、`FORCE_COLOR=0`。API key 由 pi 自身从 `~/.pi/agent/auth.json` 读。

### abort 必须 fire-and-forget
pi 的 `abort` 命令不发 response，所以 `SessionManager.abort` 用 `sendFireAndForget` 而非 `send`。否则在流式运行中按"中止"会留一个永久 pending request。

### Task 可靠性
- `task-monitor` 默认每 5s 扫描；超时与 offline 类错误 `retryable`，最多 `maxRetries` 次总尝试（含首次）；`agent_error` 与 `cron` 触发不自动重试。
- 改超时/重试走 `settings-store`，勿硬编码魔法数到 monitor。

### Mention / Squad
- 评论 body 用 `uniqueMentions` 解析；`handleCommentTriggers` = mention 路由 +（Issue 已派给 Squad 时）Leader 再唤醒。
- Leader Protocol 硬编码在 `buildSquadLeaderPrompt`（不可用户编辑）；仅 `instructions` / 成员 `role` 可配。
- 反自触发：Leader 自身评论不唤醒；显式 `@agent/@squad/@human` 时让路（agent 回帖 `@` 他人除外，仍唤醒 Leader 协调）。
- Leader 输出无有效 mention → `pickFirstSquadMember` 兜底；仍无成员则回滚 `todo` + Inbox。
- 归档 Squad（UI「归档」）：软删 + 已派 Issue 转给 `leaderAgentName`；拒绝再派给已归档小队。

### Project
- Issue `projectId` 至多一个；删项目只 unlink，不删 Issue。
- 进度：`done / (linked − cancelled)`（`backlog` 计分母不计分子）。
- 有 `defaultCwd` 时，`resolveModel` 在未显式传 cwd 下优先用项目目录；Squad Leader briefing 用已解析的 `task.cwd` 重建。
- 不做：github_repo Resource、侧栏个人钉选、Labels、多 Workspace 权限。

### Inbox 原则
**Agent 不进 Inbox。** Inbox 只给人（本机用户）看：mention / assign / task_failed 等。

### 单会话消息上限（store）
`messagesBySession[sessionId]` 在 applyEvent 提交时滚动裁剪：保留首条 + 尾部 500 条（`MAX_MESSAGES`）。持久化路径（saveMessages/exportMessages）独立导出，不受此影响。`sessionId` 写入 messages/ 前必须通过安全字符校验，防路径穿越。

### IPC 通道单一事实源
所有 IPC 通道名集中在 `src/shared/types.ts`。新增通道时务必先在此文件加常量，main 注册 / preload 暴露 / renderer 调用 三处同步。

### 命名对齐
preload 暴露的方法名沿用 channel 名：`pluginAPI.delete` / `agentAPI.delete` 对应 `pluginDelete` / `agentDelete` channel。`PluginFile | { ok: false; error: string }` 判别联合用 `FileReadResult` 在两 API 间共享。

### 设计系统规范
所有颜色/圆角/阴影走 `src/renderer/styles.css` 的 CSS 变量（OKLCH）。新增颜色时**不要**写死 oklch() 值，一律加 token。详见 `DESIGN.md`（按钮六型、消息气泡六类、阴影三级、动画规范、**§8.6 Issue/Kanban Multica 层级**）。

Issue UI 约定：卡片主结构为 PriorityIcon+Key → 标题 →（可选项目名小字）→ 描述 → meta；列宽 280px + `IssueStatusIcon`；详情 = 文档主栏 + 右侧 Properties；评论 Avatar gutter；禁止 emoji 与文字优先级徽章堆砌。

### 主面板 + chat 内视图（IconRail / Sidebar）
`activePanel`：
- `chat` → 再用 `viewMode`：`kanban` | `list`（IssueDetail）| `session`
- `projects` → ProjectsPanel（Issue 分组；可选 defaultCwd）
- `agents` → AgentsPanel
- `plugins` → PluginsPanel（含 Skill zip 导入）
- `squads` → SquadsPanel
- `autopilots` → AutopilotsPanel
- `inbox` → InboxPanel
- `settings` → SettingsPanel（派活默认 / 可靠性 / 通知）

路由状态走 `activePanel + viewMode + activeSessionId + activePersistedId + activeIssueId + projectFilterId`。

### 插件 / Agent 文件 CRUD（plugin-manager.ts / agent-manager.ts）
读写 ~/.pi/agent/{prompts,skills,extensions}/ 与 ~/.pi/agents/<name>/{prompts,skills,extensions}/，对应 IPC 通道 `plugin:list/read/save/create/delete` / `plugin:importSkillZip` 与 `agent:list/create/delete` + `agent:file:*`。保存/删除后主进程 broadcast 对应 `*Changed` 事件，渲染端面板按需刷新 + 提示"在任意 Pi 会话中执行 `/reload` 以应用更改"。**Fromlan Pi Hub 是 RPC 客户端，无远程触发 `/reload` 的能力**，不自动注入（会打断活跃会话）。

**安全边界**（src/main/plugin-manager.ts + agent-manager.ts）：
- 路径严格收敛到 `<对应 ROOT>/<type>/` 白名单目录，防 `..` 穿越（`ensureSafePath`）。
- 文件名正则：prompts/skills `^[a-z0-9][a-z0-9-]*$`、extensions `^[a-z0-9][a-z0-9._-]*$`。
- 删除软链接用 `unlinkSync` 只移除链接本身，**不跟随删除目标**。
- 读取与写入路径均用 `realpathSync` 二次校验（`ensureSafeRealPath` / `ensureSafeWriteTarget`），防止白名单内 symlink 指向 `~/.ssh` 等敏感位置被读出或写出。
- Skill zip 导入须含 `SKILL.md`，解压目标仍受白名单约束。
- 只在顶级 `---\n...\n---\n` 块解析 frontmatter，复杂嵌套（metadata/allowed-tools）原样保留不解析。

### Agent 隔离机制（独立 agent）
新建 session 时指定 `agentName`，主进程 PiRpcClient 会：
- 追加 `--no-extensions --no-skills --no-prompt-templates --no-context-files` 关闭全局与项目级发现；
- 再用 `--prompt-template / --skill / --extension` 显式注入 `~/.pi/agents/<name>/{prompts,skills,extensions}/` 下的文件。

效果：绑定 agent 的会话**看不到**全局 `~/.pi/agent/` 下的内容，只能用自己 agent 目录里的插件。剪贴板/工具调用 cwd 仍继承自会话。

### Renderer 订阅陷阱
**禁止在 React render 体内调 `useStore.getState()`** —— 该调用不订阅变化，列表/计数不会响应 store 更新。改用 `useStore(selector)` 或 `useStore(useShallow(...))`。在事件回调 / useEffect 闭包内调 getState() 是合法的（典型场景：App.tsx 一次性初始化 IPC 订阅）。

### 借鉴 Multica / 不借鉴
详见 [ROADMAP.md](./ROADMAP.md)。全量借鉴任务模型、超时重试、四触发、Squad、Project 分组、Skill、Inbox 给人；**不做** Server–Daemon–Cloud、多 CLI、多 Workspace、github_repo Resource。
