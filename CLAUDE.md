# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Fromlan Pi Hub 是一个 Electron 桌面客户端，**不内置 pi，也不管理 API 密钥**。它通过图形界面启动多个独立的 `pi --mode rpc` 子进程（每个对话标签一个），通过 JSONL 协议通信。前置依赖：全局安装 `pi`（≥ 0.80.6）且至少配置一个 provider（写入 `~/.pi/agent/auth.json`）。

## 常用命令

所有命令在仓库根目录执行：

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 启动 electron-vite 开发模式（自动开窗 + DevTools + 热重载） |
| `npm run build` | 生产构建，产出 `dist/`（main/preload/renderer 三段） |
| `npm run preview` | 构建后预览生产包 |
| `npm run dist` | 构建并打包为 Windows 便携 .exe（产出 `release/Fromlan-Pi-Hub-portable-x64.exe`，electron-builder） |
| `npm run typecheck` | 同时检查 main/preload 与 renderer 两侧类型 |
| `npm run typecheck:node` | 仅检查主进程 + preload + shared |
| `npm run typecheck:web` | 仅检查 renderer 端 |

## 架构

三进程模型，关注跨边界的数据流动：

```
渲染进程 (React + zustand)                主进程 (Electron)                    子进程
─────────────────────────────────      ──────────────────────            ──────────────
App / Sidebar / IconRail /               ipcMain.handle                    pi --mode rpc
Composer / MessageList /           ←→    SessionManager ─── PiRpcClient ──→ stdin/stdout
NewSessionDialog / AgentsPanel /          (状态机 + 模型拉取)                (JSONL 协议)
PluginsPanel / PluginEditor /             broadcast 事件 →
SettingsPanel                            ↕
store.applyEvent 增量拼流                pluginManager.list/read/save/..   ~/.pi/agent/
store.setPlugins / setNotice / setAgents  agentManager.list/create/..      prompts/ skills/ extensions/
                                         (frontmatter + 白名单 + symlink)   ↕
                                         (env 白名单 + error 监听)          ~/.pi/agents/<name>/
                                                                          (per-agent 隔离目录)
```

**关键数据流**（用户发送消息时）：
1. `Composer` → `sessionAPI.prompt`（preload contextBridge 暴露）
2. 主进程 `SessionManager.prompt` → `PiRpcClient` 写入子进程 stdin
3. pi 流式输出 JSONL → `PiRpcClient` 分帧解析（按 `\n`，剥离 `\r`，64MB 缓冲上限）
4. `SessionManager` 更新状态 → 主进程 `broadcast` → 渲染进程 `store.applyEvent` 增量拼接 → UI 实时刷新

**状态机**：`starting → idle → busy → (compacting) → idle` 或 `→ exited`。UI 状态颜色映射见 `DESIGN.md`（黄/绿/蓝脉冲/紫脉冲/红）。

## 目录结构与职责

```
src/
├── shared/types.ts            # IPC 通道常量 + 共享类型（单一事实源，renderer 与 main 都引用）
├── main/
│   ├── index.ts               # app 生命周期、窗口创建、IPC 注册、事件广播
│   ├── session-manager.ts     # 多会话管理、状态机、get_available_models 调用
│   ├── pi-rpc-client.ts       # 单个 pi 子进程封装：spawn、JSONL 分帧、request/response
│   ├── plugin-manager.ts      # ~/.pi/agent/ 下 prompts/skills/extensions 的文件 CRUD
│   ├── agent-manager.ts       # ~/.pi/agents/<name>/ 下独立 agent + 其下三类插件的 CRUD
│   ├── agents-store.ts        # agent 元数据 JSON 持久化（{userData}/fromlan-pi-hub/agents.json）
│   └── persistence.ts         # 消息历史与已停止会话快照持久化（{userData}/fromlan-pi-hub/）
├── preload/index.ts           # contextBridge 安全暴露 sessionAPI / appAPI / pluginAPI / agentAPI
└── renderer/
    ├── App.tsx                # 顶层布局：按 activePanel 路由到各面板
    ├── store.ts               # zustand：sessions / messagesBySession / applyEvent + 应用级偏好
    ├── styles.css             # 设计系统 tokens（OKLCH） + @font-face
    ├── fonts/                 # 本地内嵌 Inter + Geist Mono（latin + latin-ext，offline）
    └── components/
        ├── IconRail.tsx           # 左侧图标导航栏：新建、Agents、Plugins、主题、设置（设置占位）
        ├── Sidebar.tsx            # 会话列表：运行中 / 已停止两栏 + 搜索 + 新建按钮
        ├── SessionCard.tsx        # 单个会话卡片：标题、元信息、状态圆点、关闭按钮
        ├── NewSessionDialog.tsx   # 新建会话：provider/model/agent/cwd 动态拉取
        ├── MessageList.tsx        # 消息流容器，切换 session 时跳底、同 session 平滑滚动
        ├── MessageItem.tsx        # 文本/思考/工具/结果气泡 + Markdown
        ├── Composer.tsx           # 输入框：发送 / 中止 / 续对话；message_end 后自动持久化
        ├── StatusBadge.tsx        # 状态圆点，薄壳转 StatusIcon
        ├── StatusIcon.tsx         # 五种状态图标（含脉冲动画）
        ├── AgentsPanel.tsx        # Agent 管理：左侧 agent 列表 + 右侧 prompts/skills/extensions 三栏
        ├── AgentFileEditor.tsx    # 编辑 agent 下单文件 + 顶层 Agent 元数据
        ├── PluginEditor.tsx       # 编辑 ~/.pi/agent/ 下单文件
        ├── PluginsPanel.tsx       # ~/.pi/agent/ 全局 prompts/skills/extensions 三栏管理
        ├── SettingsPanel.tsx      # 设置（占位）
        ├── SearchInput.tsx        # Sidebar 顶部搜索框
        └── ThemeToggle.tsx        # 浅/深主题切换（在 IconRail 内联使用）
```

## 关键实现细节（修改前必读）

### Windows 特定的 pi 路径解析（src/main/）
`where pi` 优先选 `.exe`（`shell:false`，杜绝命令注入），否则退回 `.cmd/.bat`（`shell:true`），最后兜底裸 `pi`。**不要**直接传 `shell:true` 给 `.exe`，也不要假设 `pi` 在 PATH。

### JSONL 分帧
严格按 `\n` 切分并剥离 `\r`，**64MB 缓冲上限**防止故障子进程刷屏导致 OOM。修改分帧逻辑时务必保留上限检查（超限时主动 reject pending + kill + 清缓冲）。

### 进程回收
关闭标签或关窗时要优雅关闭子进程：先 `stdin.end()`（EOF），等 5s 兜底再 `kill()`。退出时 `reject` 所有挂起的请求，避免渲染端永久 pending。

### Error 监听
`PiRpcClient` 在 stdout 超限 / child.on('error') 时会 emit `error`。主进程 `SessionManager` 必须订阅，否则 EventEmitter 默认在无 error 监听时抛未捕获异常带崩主进程。

### env 白名单（critical）
`PiRpcClient.spawn` **不再透传父进程 env**（早期版本曾 spread `...process.env`，会把 shell 中的 `*_API_KEY` 注入子进程）。改为白名单：仅 `PATH/PATHEXT/SYSTEMROOT/TEMP/TMP/HOME/USERPROFILE/HOMEDRIVE/HOMEPATH/LANG/LC_ALL/TZ` + `opts.env`（仍会二次剔除 `*API_KEY*/*SECRET*/*TOKEN*`）+ 强制 `NO_COLOR=1`、`FORCE_COLOR=0`。API key 由 pi 自身从 `~/.pi/agent/auth.json` 读。

### abort 必须 fire-and-forget
pi 的 `abort` 命令不发 response，所以 `SessionManager.abort` 用 `sendFireAndForget` 而非 `send`。否则在流式运行中按"中止"会留一个永久 pending request。

### 单会话消息上限（store）
`messagesBySession[sessionId]` 在 applyEvent 提交时滚动裁剪：保留首条 + 尾部 500 条（`MAX_MESSAGES`）。持久化路径（saveMessages/exportMessages）独立导出，不受此影响。

### IPC 通道单一事实源
所有 IPC 通道名集中在 `src/shared/types.ts`。新增通道时务必先在此文件加常量，main 注册 / preload 暴露 / renderer 调用 三处同步。

### 命名对齐
preload 暴露的方法名沿用 channel 名：`pluginAPI.delete` / `agentAPI.delete` 对应 `pluginDelete` / `agentDelete` channel。`PluginFile | { ok: false; error: string }` 判别联合用 `FileReadResult` 在两 API 间共享。

### 设计系统规范
所有颜色/圆角/阴影走 `src/renderer/styles.css` 的 CSS 变量（OKLCH）。新增颜色时**不要**写死 oklch() 值，一律加 token。详见 `DESIGN.md`（按钮六型、消息气泡六类、阴影三级、动画规范）。

### 四种主面板（由 IconRail 切换）
`activePanel: "chat" | "agents" | "plugins" | "settings"`。App.tsx 按其路由顶层组件：
- `chat` → MessageList + Composer（activeSessionId 优先，否则 activePersistedId 历史回放）
- `agents` → AgentsPanel（管理 ~/.pi/agents/<name>/ 独立目录）
- `plugins` → PluginsPanel（管理 ~/.pi/agent/ 全局共享）
- `settings` → SettingsPanel（占位）

不再使用"虚拟标签"概念；路由状态全部走 `activePanel + activeSessionId + activePersistedId` 三字段。

### 插件 / Agent 文件 CRUD（plugin-manager.ts / agent-manager.ts）
读写 ~/.pi/agent/{prompts,skills,extensions}/ 与 ~/.pi/agents/<name>/{prompts,skills,extensions}/，对应 IPC 通道 `plugin:list/read/save/create/delete` 与 `agent:list/create/delete` + `agent:file:*`。保存/删除后主进程 broadcast 对应 `*Changed` 事件，渲染端面板按需刷新 + 提示"在任意 Pi 会话中执行 `/reload` 以应用更改"。**Fromlan Pi Hub 是 RPC 客户端，无远程触发 `/reload` 的能力**，不自动注入（会打断活跃会话）。

**安全边界**（src/main/plugin-manager.ts + agent-manager.ts）：
- 路径严格收敛到 `<对应 ROOT>/<type>/` 白名单目录，防 `..` 穿越（`ensureSafePath`）。
- 文件名正则：prompts/skills `^[a-z0-9][a-z0-9-]*$`、extensions `^[a-z0-9][a-z0-9._-]*$`。
- 删除软链接用 `unlinkSync` 只移除链接本身，**不跟随删除目标**。
- 读取路径用 `realpathSync` 二次校验（`ensureSafeRealPath`），防止白名单内 symlink 指向 `~/.ssh` 等敏感位置被读出。
- 只在顶级 `---\n...\n---\n` 块解析 frontmatter，复杂嵌套（metadata/allowed-tools）原样保留不解析。

### Agent 隔离机制（独立 agent）
新建 session 时指定 `agentName`，主进程 PiRpcClient 会：
- 追加 `--no-extensions --no-skills --no-prompt-templates --no-context-files` 关闭全局与项目级发现；
- 再用 `--prompt-template / --skill / --extension` 显式注入 `~/.pi/agents/<name>/{prompts,skills,extensions}/` 下的文件。

效果：绑定 agent 的会话**看不到**全局 `~/.pi/agent/` 下的内容，只能用自己 agent 目录里的插件。剪贴板/工具调用 cwd 仍继承自会话。

### Renderer 订阅陷阱
**禁止在 React render 体内调 `useStore.getState()`** —— 该调用不订阅变化，列表/计数不会响应 store 更新。改用 `useStore(selector)` 或 `useStore(useShallow(...))`。在事件回调 / useEffect 闭包内调 getState() 是合法的（典型场景：App.tsx 一次性初始化 IPC 订阅）。
