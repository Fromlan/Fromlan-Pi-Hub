# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Lite-Pi 是一个 Electron 桌面客户端，**不内置 pi，也不管理 API 密钥**。它通过图形界面启动多个独立的 `pi --mode rpc` 子进程（每个对话标签一个），通过 JSONL 协议通信。前置依赖：全局安装 `pi`（≥ 0.80.6）且至少配置一个 provider（写入 `~/.pi/agent/auth.json`）。

## 常用命令

所有命令在仓库根目录执行：

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 启动 electron-vite 开发模式（自动开窗 + DevTools + 热重载） |
| `npm run build` | 生产构建，产出 `dist/`（main/preload/renderer 三段） |
| `npm run preview` | 构建后预览生产包 |
| `npm run dist` | 构建并打包为 Windows 便携 .exe（产出 `release/Lite-Pi-portable-x64.exe`，electron-builder） |
| `npm run typecheck` | 同时检查 main/preload 与 renderer 两侧类型 |
| `npm run typecheck:node` | 仅检查主进程 + preload + shared |
| `npm run typecheck:web` | 仅检查 renderer 端 |

## 架构

三进程模型，关注跨边界的数据流动：

```
渲染进程 (React + zustand)                主进程 (Electron)                    子进程
─────────────────────────────────      ──────────────────────            ──────────────
App / TabBar / Composer /                ipcMain.handle                    pi --mode rpc
MessageList / NewSessionDialog    ←→    SessionManager ─── PiRpcClient ──→ stdin/stdout
PluginsPanel / PluginEditor             (状态机 + 模型拉取)                (JSONL 协议)
store.applyEvent 增量拼流                broadcast 事件 →
store.setPlugins / setNotice            ↕
                                       pluginManager.list/read/save/..   ~/.pi/agent/
                                       (frontmatter 解析 + 白名单)        prompts/ skills/ extensions/
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
│   ├── plugin-manager.ts      # ~/.pi/agent/ 下 plugins/skills/extensions 的文件 CRUD
│   └── persistence.ts         # 消息历史持久化与会话快照
├── preload/index.ts           # contextBridge 安全暴露 sessionAPI / appAPI / pluginAPI（白名单）
└── renderer/
    ├── App.tsx                # 布局 + IPC 事件订阅（setupListeners）
    ├── store.ts               # zustand：sessions / messagesBySession / applyEvent
    ├── styles.css             # 设计系统 tokens（OKLCH） + @font-face
    ├── fonts/                 # 本地内嵌 Inter + Geist Mono（latin + latin-ext，offline）
    └── components/
        ├── TabBar.tsx               # 多标签 + 状态圆点 + 关闭按钮 + 虚拟插件 tab
        ├── NewSessionDialog.tsx     # provider/model/cwd 选择（动态拉取模型）
        ├── MessageList.tsx          # 消息流容器，自动滚动
        ├── MessageItem.tsx          # 文本/思考/工具/结果气泡 + Markdown
        ├── Composer.tsx             # 输入框 + 中止按钮 + 错误回填
        ├── StatusBadge.tsx          # 状态圆点（脉冲动画）
        ├── PluginsPanel.tsx         # 插件管理主面板：类型切换 + 列表 + notice
        └── PluginEditor.tsx         # 编辑/新建/删除模态（复用 .dialog 样式）
```

## 关键实现细节（修改前必读）

### Windows 特定的 pi 路径解析（src/main/）
`where pi` 优先选 `.exe`（`shell:false`，杜绝命令注入），否则退回 `.cmd/.bat`（`shell:true`），最后兜底裸 `pi`。**不要**直接传 `shell:true` 给 `.exe`，也不要假设 `pi` 在 PATH。

### JSONL 分帧
严格按 `\n` 切分并剥离 `\r`，**64MB 缓冲上限**防止故障子进程刷屏导致 OOM。修改分帧逻辑时务必保留上限检查。

### 进程回收
关闭标签或关窗时要优雅关闭子进程：先 `stdin.end()`（EOF），等 5s 兜底再 `kill()`。退出时 `reject` 所有挂起的请求，避免渲染端永久 pending。

### API 密钥处理
环境变量只设 `NO_COLOR=1`、`FORCE_COLOR=0`。**禁止**注入任何 API key —— pi 的 `AuthStorage` 会从 `~/.pi/agent/auth.json` 读，优先级高于环境变量。任何涉及 env 的改动都要确认未触碰密钥。

### IPC 通道单一事实源
所有 IPC 通道名集中在 `src/shared/types.ts`。新增通道时务必先在此文件加常量，main 注册 / preload 暴露 / renderer 调用 三处同步。

### 设计系统规范
所有颜色/圆角/阴影走 `src/renderer/styles.css` 的 CSS 变量（OKLCH）。新增颜色时**不要**写死 oklch() 值，一律加 token。详见 `DESIGN.md`（按钮六型、消息气泡六类、阴影三级、动画规范）。

### 插件管理面板（"⚙ 插件"虚拟标签）
TabBar 上"⚙ 插件"标签（id = `PLUGIN_TAB_ID` / `"__plugins__"`）属于**虚拟标签**：渲染在 sessions 数组之外，删除会话不会被牵连；store 的 `removeSession` 用 `id.startsWith("__")` 做白名单判定。App.tsx 路由：`activeId === PLUGIN_TAB_ID` 时主区域渲染 `<PluginsPanel />` 而不是 MessageList/Composer。

管理 ~/.pi/agent/{prompts,skills,extensions}/ 下的插件文件，对应 IPC 通道 `plugin:list/read/save/create/delete` 与事件 `plugin:changed`（详见 `src/shared/types.ts`）。保存/删除后 broadcast `plugin:changed`，PluginsPanel 收到事件后刷新列表 + 弹顶部 notice 提示"在任意 Pi 会话中执行 `/reload` 以应用更改"。**Lite-Pi 是 RPC 客户端，无远程触发 `/reload` 的能力**，不自动注入（会打断活跃会话）。

**安全边界**（src/main/plugin-manager.ts）：
- 路径严格收敛到 `~/.pi/agent/<type>/` 三个白名单目录，防 `..` 穿越（`ensureSafePath`）。
- 文件名正则：prompts/skills `^[a-z0-9][a-z0-9-]*$`、extensions `^[a-z0-9][a-z0-9._-]*$`。
- 删除软链接用 `unlinkSync` 只移除链接本身，**不跟随删除目标**（用户用 `.agents/skills/` 共享场景下必要）。
- 只在顶级 `---\n...\n---\n` 块解析 frontmatter，复杂嵌套（metadata/allowed-tools）原样保留不解析。

### Renderer 订阅陷阱
**禁止在 React render 体内调 `useStore.getState()`** —— 该调用不订阅变化，列表/计数不会响应 store 更新。改用 `useStore(selector)` 或 `useStore(useShallow(...))`。PluginsPanel 的 tabs 计数正是这种坑的反面教材。
