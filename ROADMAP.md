# Lite-Pi 迭代路线图(ROADMAP)

> 这份路线图定义 Lite-Pi 从 v0.2.0 → v1.0.0 的演进方向、阶段边界与验收标准。
> 设计灵感来自 [Multica](https://github.com/multica-ai/multica),沿用其**任务模型、分派协议、Skill 标准化、Squad 路由**这套已经被 40k stars 验证的设计哲学,但保留 Lite-Pi "**只服务 pi、纯本地、桌面原生**" 的定位。
>
> 版本化:每次阶段完成时,把"已完成 / 推迟 / 取消"的状态同步到文末的「版本状态」表。
>
> 最近更新:2026-07-17。

---

## 一、使命陈述

> **让 Lite-Pi 成为 Windows 桌面上 "Multica 本地单机版"** —— 人管 Agent,Agent 干活的工位台。

Lite-Pi 不是一个聊天客户端,而是一个"**管 Agent + 分派任务 + 看结果 + 攒 Skill + 配 Cron**"的工作台。用户打开 Lite-Pi 看到的不再是"消息流",而是"**待办看板**"。

---

## 二、设计灵感来自 Multica

借鉴 Multica 的 8 条核心理念(行为与数据模型,不是 UI):

| # | 理念 | 含义 |
|---|---|---|
| 1 | **Agent = 一等公民** | Agent 不是工具,是 teammate。它**不读 inbox**(inbox 是给人类的提醒,agent 是"被触发即工作的执行体")。 |
| 2 | **Polymorphic assignee** | `assignee_type + assignee_id` 可以是 human / agent / squad,统一 picker,UI 上无需区分。 |
| 3 | **任务状态机 6 态** | `queued → dispatched → running → completed / failed / cancelled`;5min + 2.5h 双重超时;retryable 错误自动重试(最多 2 次),`agent_error` 不重试。 |
| 4 | **4 种触发路径** | Assign / `@`-mention / Chat / Autopilot,共享同一任务后端,区别在于 "改不改 issue / 谁触发 / 上下文范围"。 |
| 5 | **Squad = leader 路由** | Squad 不增加能力,只增加路由。派活给 Squad → leader agent 读 issue + roster → `@`-mention 最合适的人。 |
| 6 | **Skill = 知识包** | 对齐 Anthropic Agent Skills 标准的 `SKILL.md` + 附属文件,跨 CLI 通用。 |
| 7 | **Runtime = Daemon × CLI** | 单一组合,跨 Workspace 即分发(本地单机可跳过)。 |
| 8 | **失败回滚 status** | 任务失败 → issue status 自动 `in_progress → todo`,看板立刻反映。 |

### 借鉴 / 不借鉴硬边界

**全量借鉴**:理念 1、2、3、4、5、6、8。
**完全不做**:Multica 的 WebSocket 队列、跨 Workspace、多人协作、16 CLI 支持、Cloud Runtimes。Lite-Pi 是本地单机 + 单 CLI,这是定位决定的。

### Lite-Pi 独有优势(反过来是 Multica 没有的)

- 桌面原生体验(系统托盘、全局快捷键、文件拖放)
- 每个 session 独立 cwd(已实现)
- 会话历史快照 + 继续对话(已实现)
- 纯本地、无云、API key 自管(用户主诉求,也是法律/合规红利)

---

## 三、7 个阶段路线图

### 阶段 0 — 语义重命名 + Task 数据模型占位(v0.3.0,~1 周)

**目标**:不引入新功能,只做"术语对齐" + 为后续阶段预留占位。

**改动**:
- `src/shared/types.ts`:新增 `Task` 类型(仅占位,renderer 暂不引用)。
- `src/main/persistence.ts`:初始化 `tasks.json` 为空数组。
- PluginsPanel / AgentFileEditor:UI 文案 `plugin (skill)` 改为 `skill`,沿用 Anthropic Agent Skills 术语。
- `CLAUDE.md` + `DESIGN.md` 增加一节"借鉴 Multica 的什么 / 不借鉴什么",防止后续 drift。
- Session 状态名以 Multica 6 态为基准重新校准(颜色可保留)。

**验收**:
- 旧数据兼容(`plugin (skill)` 与 `skill` 同义)
- `Task` 类型可被未启用代码引用而不报错

**风险**:极低

---

### 阶段 1 — Issue 模型 + Kanban 看板(v0.4.0,⭐⭐⭐⭐⭐,~2-3 周)

**目标**:把 Lite-Pi 从"聊天客户端"升级成"看板 + 详情"双视图。**这是产品形态的认知杠杆**,本阶段后用户的心智负担从"消息流过载"变成"待办清晰"。

**新增文件**:
- `src/renderer/components/KanbanPanel.tsx`:5-7 列状态。
- `src/renderer/components/IssueCard.tsx`:标题 + assignee 头像 + 状态圆点 + comment 计数 + 优先级色块。
- `src/renderer/components/IssueDetail.tsx`:左侧元数据(标题、描述、assignee picker、状态、优先级、due date) + 右侧评论时间线 + 底部"Run"按钮。
- `src/renderer/components/AssigneePicker.tsx`:统一 picker(human / agent / squad,squad 阶段 3 才生效)。
- `src/renderer/components/PriorityBadge.tsx`、`IssueKey.tsx`:复用级组件。

**新增数据模型**(`src/shared/types.ts`):
```
Issue { id, key('LSN-1' 大写 3-10 字母 + 顺序号), title, description,
        status: 'backlog'|'todo'|'in_progress'|'in_review'|'done'|'blocked'|'cancelled',
        priority: 'urgent'|'high'|'medium'|'low',
        assignee: { kind: 'human'|'agent'|'squad', id },
        parent?: string, createdAt, updatedAt, dueDate? }
Comment { id, issueId, author: {kind, id, name}, body, mentions: [...], createdAt }
```

**关键决策**:
- **Issue 与 Session 关系 = 1:N**。不取代 Session,只补充。一个 issue 可以派生多个对比 session。
- **新会话从 issue 起**:`IssueDetail` 底部"Run"按钮 → 弹窗选 agent/model/cwd(沿用 `NewSessionDialog`)→ 创建 session 并关联 issueId。
- **顶部切换器**:`看板 / 列表 / 当前会话`,而不是云 Workspace 切换器。Lite-Pi 是单机,概念更轻。
- **assignee picker 在三处复用**:Issue 详情顶部、Session 创建弹窗、评论 @-mention。

**持久化**:
- `src/main/issue-store.ts`(新):持久化 `issues.json` + `comments.json`,沿用现有 `persistence.ts` 的风格(atomic write)。
- `src/shared/types.ts` 增 IPC 通道:`issue:list/get/create/update/delete`、`issue:assign`、`issue:status`、`comment:list/add/delete`。

**验收**:
- 创建 issue → 派给已配置的 Agent → 自动 spawn session → session 进度实时反映回 issue 卡片
- 关闭 session(停止)不影响 issue,issue 仍可重新派活
- 状态切换、assignee 切换、优先级切换 — 三处持久化一致
- 100% 键盘可达 + 主流程 E2E 测试

**风险**:中(数据模型新增,持久化格式变更,需迁移现有 session 关联)

---

### 阶段 2 — 任务超时 / 重试 / 失败回滚(v0.5.0,~2 周)

**目标**:阶段 1 的"派活"动作有了 Task 后,补齐 Multica 的"任务可靠性"层 —— 让用户敢放手。

**新增文件**:
- `src/main/task-monitor.ts`(新):定时(默认 5s)扫描所有 session,判定超时。
- `src/renderer/components/TaskHistory.tsx`:在 Issue 详情底部显示每次执行的 attempt 历史(attempt 序号、起止时间、失败原因、重试次数)。

**关键行为**:
- `dispatched > 5min` 仍 `idle` → 标 `failed:runtime_offline`(retryable)
- `running > 2.5h` → 标 `failed:timeout`(retryable)
- `runtime_offline` / `timeout` / `runtime_recovery` → 自动 spawn 新 task attempt,最多 2 次
- `agent_error`(API 错误、配额) → 不重试,**issue.status 自动回滚** `in_progress → todo`
- session 卡片上加 "已重试 1/2" 标签

**持久化扩展**:
- `tasks.json` schema:`Task { id, issueId?, sessionId, attempt, type: 'manual'|'cron'|'webhook'|'mention'|'rerun', status, priority, prompt, createdAt, finishedAt, error? { reason, retryable } }`

**验收**:
- 手动 kill 一个 session → 5min 内 task 被标 failed → 若 retryable,自动重建 session
- 错误信息准确反映 pi 子进程退出码 / 协议报错
- 任务日志可在 Issue / Session 两处看到

**风险**:低(在现有 SessionManager 之上加层,行为可见)

---

### 阶段 3 — Squad 路由代理(v0.6.0,⭐⭐⭐⭐⭐,~3 周)

**目标**:Lite-Pi 真正出圈的功能 —— 让一个 Agent 替人**选谁该干活**,模拟真实团队"组长派活"的协作。

**新增文件**:
- `src/main/squad-manager.ts`(新):Squad CRUD、roster 管理、leader protocol prompt 拼接。
- `src/renderer/components/SquadsPanel.tsx`:IconRail 加一个图标,左侧 squad 列表 + 右侧 squad 详情。
- `src/renderer/components/SquadDetail.tsx`:leader 选择、成员名单 + role 描述、instructions 编辑器、归档按钮。
- `src/renderer/components/MentionPicker.tsx`:评论输入 `@` 时弹出,选择 human / agent / squad。
- `src/shared/mention.ts`(新):`[@Name](mention://agent/<uuid>)` markdown 协议解析与生成。

**Squad 数据模型**:
```
Squad { id, name, description, leaderAgentName,
        members: [{ kind: 'agent'|'human', id, role }],
        instructions: string, archived: boolean }
```

**Squad Leader Protocol**(`src/main/squad-manager.ts` 拼接):
派活给 Squad 时,leader agent 的 session prompt 头部注入三段:
1. **SquadOperatingProtocol**(硬编码,不可改):"读 issue → 用 `[@Name](mention://agent/<uuid>)` 形式 `@`-mention 一个或多个 member → 简短评估(2-3 句)→ 停止执行。"
2. **SquadRoster**:leader 自身的 mention markdown + 每个 member 的 mention markdown。
3. **SquadInstructions**:用户配置的路由规则。

**leader session 完成后**:
1. 自动抓取 leader 最后一条 assistant 输出。
2. 解析 `mention://agent/<uuid>` 链接。
3. **对每个被提及的 member 立即 spawn 新 session**,prompt = 完整 issue context + 当前评论时间线。
4. leader 评估写进 issue 评论时间线(单独的 `[leader-decision]` 元数据)。

**反自触发保护**(摘自 Multica,直接搬):
- leader 自身评论 → 不再触发自己
- 评论里已含 `@agent-xxx` → leader 不再触发,让显式 mention 生效
- 评论里只含 issue 跨引用 → leader 仍触发

**验收**:
- 配置 Squad `Frontend Team`,leader = `frontend-lead` agent,members = 2 个 specialists
- 用户创建 issue + 派给 Squad → leader session 自动启动
- leader 在输出中 `@` 了 `ui-specialist` → `ui-specialist` session 自动启动
- 整个过程在 Issue 评论时间线可见

**风险**:高(协议复杂,但分层清晰;做最坏兜底:leader 输出无法解析 → issue status 回滚 + 通知用户手动指定 member)

---

### 阶段 4 — Skill 标准对齐(v0.7.0,~1 周)

**目标**:把 `~/.pi/agent/skills/<name>/` 与 Anthropic Agent Skills 标准的 `SKILL.md` 对齐,提升 Skill 跨 CLI 互操作性。

**改动**:
- `src/renderer/components/PluginsPanel.tsx`:单文件名为 `SKILL.md` 时,采用 Anthropic 渲染(顶部 frontmatter 卡片 + markdown 预览)。
- `src/renderer/components/AgentFileEditor.tsx`:Agent 配置页加 "Skills" tab,显示已 attached skill 列表 + 移除按钮。
- `src/main/plugin-manager.ts`:新增 zip 导入(`SKILL.md` + 附属脚本批量上传)。
- 向后兼容:旧命名(`<name>.md`)继续支持,UI 提示"建议改名为 SKILL.md 以符合 Agent Skills 标准"。

**验收**:
- 用户可以导入一个来自第三方仓库的 skill zip
- Skill 在 Agent 配置页可见、可移除
- 编辑后的 skill 不重启 daemon 也能在下次新建 session 生效(沿用现有"reload 提示"机制)

**风险**:极低

---

### 阶段 5 — Autopilot 周期触发(v0.8.0,~2 周)

**目标**:把"派活"从"人手动"扩展到"时间驱动",补齐 Multica 4 触发路径的最后一种。

**新增文件**:
- `src/main/autopilot-manager.ts`(新):加载 `autopilots.json`,node-cron 调度。
- `src/main/autopilot-store.ts`(新):autopilot + 触发日志 `autopilot_runs.json` 持久化。
- `src/renderer/components/AutopilotsPanel.tsx`:IconRail 加图标,CRUD UI + cron 编辑器(react-cron-input)+ 触发日志。
- `package.json`:新增依赖 `node-cron` + `cronstrue`(人类可读 cron 表达式)。

**Autopilot 数据模型**:
```
Autopilot { id, name, agentName, schedule: { cron, tz },
            prompt, mode: 'create_issue'|'run_only',
            priority, enabled, lastRunAt, nextRunAt }
```

**两种触发模式**(对应 Multica 借鉴):
- `create_issue`:触发 → 新建 issue(标题支持 `{{date}}` 占位,UTC `YYYY-MM-DD`)→ 派给 agent → 走完整 assignment 流程。
- `run_only`:触发 → 直接 spawn session(prompt 为固定文案)→ 适合"每日生成日报""每周扫 GitHub issues"这种无 context 的活。

**触发源**:
- Schedule(cron + tz,IANA,本地时区解释)
- Webhook(v0.8.0 暂缓,先做 cron;webhook 留到 v0.9.x)

**验收**:
- 配置 `0 9 * * 1-5` 的 autopilot,周一早上自动跑出 session 并创建 issue
- 手动 `Run now` 按钮与 cron 触发走相同代码路径
- 触发日志可查(firedAt、status、产出 sessionId)

**风险**:低(纯增量,在现有 SessionManager 之上加层)

---

### 阶段 6 — Inbox + 桌面通知(v0.9.0,~1 周)

**目标**:用户可以"开着应用去干别的",任务在背景跑,回到 Lite-Pi 看通知。

**新增文件**:
- `src/main/inbox-store.ts`(新):订阅 + 通知聚合。
- `src/renderer/components/InboxPanel.tsx`:IconRail 加图标,左侧分区列表(被 mention / 我订阅 / 我负责 / 我创建) + 右侧统一详情。
- `src/main/notification.ts`(新):包装 Electron `Notification`,管理去重 + 节流。

**订阅模型**(Multica 借鉴,本地化简化):
- 每个 issue 默认 subscribed = creator + assignee + 评论过的人
- `Subscribe` 按钮手工取消 / 加入

**严格沿用的原则**:**agent 不在 inbox 里**(Multica 核心原则)。inbox 只给"人"(本机用户)看。

**触发桌面通知的条件**:
- 被 `@`-mention(限人)
- 被 assign
- Assignee 是 agent 但失败(retryable 已耗尽)— 通知人

**验收**:
- 后台跑 session 时,app 在前台不弹通知,最小化 / 不在桌面时弹原生通知
- InboxPanel 顶部有未读小红点
- 点击通知直接跳到对应 Issue 详情

**风险**:低

---

### 阶段 7 — **不做**

**明确不做**:多 CLI 支持。Lite-Pi 立项本意就是"**只服务 pi**"。Multica 的"16 CLI 支持"是其差异化能力,反过来,**Lite-Pi 在 "Pi-only 极致体验" 上做文章**。

如果未来有需求,会以独立大版本(v2.x,改名 Lite-Agents)推进,不在本路线图范围。

---

## 四、阶段 ROI 与推荐执行顺序

| 序 | 阶段 | 主题 | 工作量 | 价值 | 风险 | 累计 |
|---|---|---|---|---|---|---|
| 1 | 0 | 语义重命名 + Task 占位 | 1 周 | ⭐⭐ | 极低 | 1w |
| 2 | 1 | **Issue + Kanban + 详情** | 2-3 周 | ⭐⭐⭐⭐⭐ | 中 | 3-4w |
| 3 | 2 | 任务超时 / 重试 / 回滚 | 2 周 | ⭐⭐⭐ | 低 | 5-6w |
| 4 | 3 | **Squad 路由代理** | 3 周 | ⭐⭐⭐⭐⭐ | 高 | 8-9w |
| 5 | 4 | Skill 标准化 | 1 周 | ⭐⭐⭐ | 低 | 9-10w |
| 6 | 5 | Autopilot cron | 2 周 | ⭐⭐⭐⭐ | 低 | 11-12w |
| 7 | 6 | Inbox + 桌面通知 | 1 周 | ⭐⭐ | 低 | 12-13w |

**第一刀推荐:阶段 1(看板 + Issue)**。理由:
- 它把 Lite-Pi 从"工具"提升到"工作台",**单个阶段带来最大的产品形态跨越**
- 阶段 2、3 都建立在"Task"概念上,而 Task 的语义只有在有了 Issue 之后才完整
- 用户能立即感知:"终于不是聊天软件了"

---

## 五、版本状态表

| 版本 | 阶段 | 发布日期 | 关键里程碑 |
|---|---|---|---|
| v0.1.0 | 初始 | 2026-05 | 基础多标签 pi 客户端 |
| v0.2.0 | 三列 + 设计系统 | 2026-07 | Plugin / Agent 隔离管理 |
| **v0.3.0** | **阶段 0** | — | 语义对齐、Task 占位 |
| **v0.4.0** | **阶段 1** | **2026-07-17** | **Issue + Kanban + Detail + Comment + SessionCard 来源标签(见下方交付清单)** |
| v0.5.0 | 阶段 2 | — | 状态机 + 超时 + 重试 |
| v0.6.0 | 阶段 3 | — | Squad 路由代理 |
| v0.7.0 | 阶段 4 | — | Skill 标准对齐 |
| v0.8.0 | 阶段 5 | — | Autopilot cron |
| v0.9.0 | 阶段 6 | — | Inbox + 通知 |
| v1.0.0 | 整体 | — | "Lite-Pi = Multica 本地单机版"正式 GA |

每次阶段完成,在本表新增一行,标注发布日期、是否完成、是否有 scope 调整。

### v0.4.0 实际交付(2026-07-17)

**修改文件**(11):
- `src/shared/types.ts` —— 加 Issue / Comment / IssueStatus / IssuePriority / Assignee / AssigneeKind / IssueCreateInput 类型;13 个 IPC 常量;SessionSnapshot 与 StartSessionOpts 加 issueId?
- `src/main/session-manager.ts` —— ManagedSession 加 issueId 字段;start / resume / toSnapshot 三处透传
- `src/main/index.ts` —— 注册 10 个 issue/comment IPC handler + 广播事件
- `src/preload/index.ts` —— 新增 issueAPI 命名空间(contextBridge),含 5 个事件订阅
- `src/renderer/global.d.ts` —— 声明 window.issueAPI 类型
- `src/renderer/store.ts` —— issues / commentsByIssue / activeIssueId / viewMode slices + 派生 getter
- `src/renderer/App.tsx` —— 三态视图路由 + IPC 订阅 + 顶部 notice 条
- `src/renderer/components/Sidebar.tsx` —— 顶部 segmented control + viewMode 条件渲染
- `src/renderer/components/NewSessionDialog.tsx` —— 接收 issueId / presetTitle / assigneeName 三个可选 props
- `src/renderer/components/SessionCard.tsx` —— 若 issueId 关联,显示"来自 LSN-N 任务"标签
- `src/renderer/styles.css` —— Issue 状态 7 色 + 优先级 4 色 token(深 / 浅主题两套);新增约 580 行样式

**新增文件**(8):
- `src/main/issue-store.ts` —— issues.json + comments.json 持久化(schema envelope + atomic write)
- `src/renderer/components/IssueKey.tsx`
- `src/renderer/components/PriorityBadge.tsx`
- `src/renderer/components/AssigneePicker.tsx`
- `src/renderer/components/IssueCard.tsx`
- `src/renderer/components/IssueCreateDialog.tsx`
- `src/renderer/components/IssueDetail.tsx`
- `src/renderer/components/KanbanPanel.tsx`

**验证**: `npm run typecheck`(node + web)双侧 0 error;`npm run build` 三段产物完整(main 50.95 KB / preload 6.78 KB / renderer 1.38 MB JS + 48.57 KB CSS)。完整 14 项 E2E 自检的操作手册见 plan 文件 `C:\Users\Administrator\.claude\plans\sunny-squishing-flurry.md`。

下次阶段:**v0.5.0**(任务超时 / 重试 / 失败回滚)。

---

### v0.4.0 跑测补丁(2026-07-17)

跑 14 项验收的过程中(用 vite dev + Electron DevTools Protocol 模拟用户操作),发现了 3 个真 bug,全部已修。

**Bug 1: `src/renderer/index.html` 缺 issueAPI mock**

现状: vite mock 只有 sessionAPI / pluginAPI / agentAPI / appAPI 四个 namespace;新增的 issueAPI 没注入,导致 vite 直访 dev server 时 `useStore.getState()` 抛 `Cannot read properties of undefined (reading 'list')`,React 整树炸掉,console 报 "An error occurred in the <App> component"。

修复: 在 mock 脚本块补 issueAPI 完整 14 个方法的 Promise.resolve 兜底(含 5 个事件订阅),同时给 sessionAPI / pluginAPI / agentAPI 补齐所有用到的方法(否则 `getMessages` / `onChanged` 等调用会 undefined 报错)。

**Bug 2: `IssueDetail` / `IssueCard` 的 zustand v5 selector 无限循环**

现状: 写法 `useStore((s) => s.commentsByIssue[id] ?? [])`,当 id 不命中时,`?? []` 每次渲染都返回新数组字面量,触发 React 19 `The result of getSnapshot should be cached to avoid an infinite loop` 警告,导致 IssueDetail 在 viewMode=list 时 main 子元素为 0(渲染被 React 阻断)。

修复:
- 在文件顶部声明模块级常量 `const EMPTY_COMMENTS: Comment[] = []`,selector 改用 `s.commentsByIssue[id] ?? EMPTY_COMMENTS`,稳定引用。
- 同时同步修 `IssueCard.tsx`,把 `?? []` 改成 `?? EMPTY_COMMENTS`。
- `useStore((s) => (id ? s.issues.find(...) : null))` 保留 —— find 命中是稳定引用,un命中是 null 也是稳定值。

**Bug 3: `KanbanPanel` notice 文案 bug**

现状: `\`改 status 失败: ${r.ok === false ? "" : ""}\``,三元两个分支都是空字符串,失败时 notice 永远是 "改 status 失败: " 后面空。

修复: 改为 `\`改 status 失败: ${"error" in r ? r.error : "未知错误"}\``(IpcResult 类型守卫),保障用户能看到具体失败原因。

**新增 dev 桥:`window.useStoreDevtools`**

为支持 14 项验收在浏览器内注入 mock 状态(store 没办法从 dev 工具访问),在 `src/renderer/store.ts` 末尾加 `import.meta.env.DEV` 守卫:

```ts
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as any).useStoreDevtools = useStore;
}
```

生产构建由 tree-shake 移除,不进 bundle。`src/renderer/global.d.ts` 同步声明 `window.useStoreDevtools` + 加 `/// <reference types="vite/client" />` 让 TS 识别 `import.meta.env`。

**14 项验收结果**

| # | 项目 | 状态 |
|---|---|---|
| 1 | Sidebar 顶部 segmented control,默认"看板" | ✅ |
| 2 | 看板 7 列布局 + 全 0 | ✅ |
| 3 | 切"详情"显示"选择一个 issue 查看详情" | ✅ |
| 4 | 创建 issue → LSN-1 卡片 | ✅ |
| 5 | 改 priority=high + 评论计数 0 | ✅ |
| 6 | 评论"hello"立即出现 | ✅ |
| 7 | ▶ Run → NewSessionDialog + 透传 issueId 等 | ⚠️ mock 下看不到完整 dialog(getModels mock 空);代码层通过 typecheck + 真实 pi 需本地验 |
| 8 | SessionCard "来自 LSN-1" + 跳转 | ✅ |
| 9 | 拖拽乐观更新 + 失败回滚 + notice | ✅(修复 Bug 3 后) |
| 10 | 旧会话 + 新会话并存 | ✅ |
| 11 | Ctrl+R 重启 dev 状态还原 | ⚠️ 实现已就位,真实持久化需 Electron 重启 |
| 12 | console 无 uncaught | ✅ |
| 13 | `npm run typecheck` 双侧 0 error | ✅ |
| 14 | Tab 焦点可达 | ⚠️ 代码层 ✅(原生控件可 Tab),运行时需本地验 |

总计 11/14 完全通过,3 项需要本地 Electron 跑(`#7` #11 #14)。

**跑测期间新增工具改动**(供后续回归):

- `src/renderer/index.html` —— 补 issueAPI mock + 已存在 API 完善(为允许浏览器直接验证)
- `src/renderer/components/IssueDetail.tsx` —— EMPTY_COMMENTS 模块常量 + selector 稳定化
- `src/renderer/components/IssueCard.tsx` —— EMPTY_COMMENTS 复用
- `src/renderer/components/KanbanPanel.tsx` —— notice 文案 bug 修复
- `src/renderer/store.ts` —— dev 桥 `useStoreDevtools`
- `src/renderer/global.d.ts` —— `vite/client` + `useStoreDevtools` 类型声明

下次阶段:**v0.5.0**(任务超时 / 重试 / 失败回滚)。

---

## 六、跨阶段架构决策记录(ADR-lite)

写阶段 1 时的设计选择,影响后续所有阶段:

| 决策 | 选择 | 理由 |
|---|---|---|
| Issue vs Session 关系 | **1:N**(issue 派生 N 个 session) | 不取代 session,保留对比调试场景;但状态从 issue 视角看 |
| assignee 类型 | Polymorphic(kind + id) | 直接对标 Multica;阶段 3 加 squad 时不破字段 |
| 持久化目录 | 复用 `{userData}/lite-pi/`,新增 `issues.json` / `comments.json` / `tasks.json` / `squads.json` / `autopilots.json` | 单一根,atomic write,迁移成本低 |
| IPC 通道 | 集中在 `src/shared/types.ts`,按 `issue:list/get/...` 命名 | 项目硬规则,新增阶段沿用 |
| leader protocol 可配置? | **否**(硬编码) | Multica 经验:可编辑的 protocol 很快被改坏,只暴露 `instructions` 这一段用户自定义 |
| Webhook 触发 | 阶段 5 暂缓 | local 单机,内网 webhook 没强需求;先做 cron 验证逻辑 |
| Cron 解释时区 | **本地时区**(IANA) | 与 Lite-Pi "Windows 桌面" 强绑定;避免服务器/客户端时区漂移 |
| 多 CLI 支持 | **明确不做** | 立项定位决定;v2.x 可独立项目 |

---

## 七、风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| 阶段 1 数据迁移失败 | 中 | 写迁移脚本 + 旧数据 read-only 兼容 + 在 README 提示手动备份 |
| 阶段 3 leader 输出不可解析 | 中 | 兜底:issue status 回滚 + Inbox 通知 + 留 `multica fallback: pick-first-member` 配置 |
| 阶段 5 cron 漂移 | 低 | 用 `cronstrue` UI 显示人类可读 + 触发后 30s 内去重 |
| 阶段 6 桌面通知打扰 | 中 | 默认仅后台才弹;Settings 提供"始终 / 仅后台 / 关"三档 |
| Skills 引入恶意脚本 | 低 | 一律按 SKILL.md 提醒"仅从信任源导入";不自动执行附属脚本(留钩子在 v1.1) |

---

## 八、参考链接

- [Multica 仓库](https://github.com/multica-ai/multica)
- [Multica Agents 文档](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/agents.mdx)
- [Multica Squads 文档](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/squads.mdx)
- [Multica Skills 文档](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/skills.mdx)
- [Multica Autopilots 文档](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/autopilots.mdx)
- [Multica Tasks 文档](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/tasks.mdx)
- [Multica Assigning Issues](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/assigning-issues.mdx)
- [Multica Daemon & Runtimes](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/daemon-runtimes.mdx)
- [Anthropic Agent Skills 标准](https://agentskills.io)
