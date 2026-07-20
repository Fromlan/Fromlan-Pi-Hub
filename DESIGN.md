# Fromlan Pi Hub 外观设计文档

> 本设计系统提炼自参照项目 `pi-desktop-fleet` 的视觉语言，作为 Fromlan Pi Hub 客户端样式的权威规范。核心特征：**OKLCH 色彩空间、深色为默认的双主题、Inter + Geist Mono 字体、细边框与柔和阴影、三列紧凑布局**。

---

## 一、设计原则

1. **深色优先**：`:root` 即深色主题，`body[data-theme="light"]` 覆盖为浅色。默认深色，切换浅色只改一组变量。
2. **OKLCH 色彩**：所有颜色用 `oklch(L C H)` 表达，感知均匀，深浅主题只需调 L（亮度）即可保持色相一致。
3. **Token 驱动**：组件不写死颜色/圆角/阴影，一律引用 CSS 变量。改主题=改 token，不动组件。
4. **克制的层次**：用背景色分层（app < sidebar < main < header < input）+ 细边框（0.5px）+ 三级阴影表达层级，不用重描边。
5. **紧凑密度**：正文 13px、6–12px 内边距、`0.5px` 半透明白边框，开发工具风格。
6. **相对色派生**：hover / focus / active 高亮用 `oklch(from var(--x) l c h / α)` 语法从 token 派生，不另设颜色变量。
7. **图标语言化**：所有图标来自 lucide-react；会话状态用圆点 SVG（`StatusIcon`），Issue 状态/优先级用进度环与竖条 SVG（`IssueStatusIcon` / `PriorityIcon`）；不用 emoji（跨平台渲染不一致）。

---

## 二、整体布局

Fromlan Pi Hub 采用 **三列 CSS Grid**：

```
.app {
  display: grid;
  grid-template-columns: 48px 280px minmax(0, 1fr);
  grid-template-areas: "iconrail sidebar main";
  height: 100vh;
}
```

| 列 | 宽度 | 内容 | 关键类 |
|---|---|---|---|
| IconRail | 48px | 顶级导航：新建 / 看板·Agents·Squads·Plugins·Autopilots·Inbox / 主题·设置 | `.iconrail` |
| Sidebar | 280px | 视图切换 + 搜索 + 运行中/已停止会话（或面板上下文） | `.sidebar` |
| Main | 1fr | `activePanel` + `viewMode` 路由区（Kanban / IssueDetail / Session / 各管理面板） | `.main` |

响应式：

- `@media (max-width: 1024px)`:Sidebar 收到 `minmax(220px, 260px)`
- `@media (max-width: 720px)`:Sidebar 隐藏为 0

### 2.1 IconRail（48px 垂直图标条）

- 三段布局：`iconrail-top`（新建会话）/ `iconrail-mid`（看板 / Agents / Squads / Plugins / Autopilots / Inbox）/ `iconrail-bot`（主题 + 设置）
- 按钮 32×32，`.iconrail-btn`，透明背景，hover `--bg-list-hover`
- Active 态：背景 `--bg-list-selected` + 文字 `--accent-blue` + **3px 左侧 accent bar**（`::before` 伪元素）
- 新建按钮变体 `.iconrail-btn-accent`：实心 `--btn-bg`，白字
- Inbox 未读用 `.iconrail-dot` 角标（非 emoji）
- 图标来自 lucide-react：`Plus` / `LayoutDashboard` / `Users` / `Network` / `Plug` / `Timer` / `Inbox` / `Sun` / `Moon` / `Settings`

### 2.2 Sidebar（280px 会话列表）

- 顶部 `.sidebar-header`：`SearchInput` + `.sidebar-new`（新建按钮）
- `.sidebar-sections`：可滚动垂直区
- 两个 `.sidebar-section`：
  - "运行中"：默认渲染
  - "已停止"：可折叠（`.sidebar-section-toggle` + ChevronDown 图标），状态存于 `showStoppedGroup`
- 搜索过滤：`sidebarSearch` 字段，按 title / provider / model 模糊匹配
- 非 chat 面板时显示 `.sidebar-back` 按钮（返回聊天）

### 2.3 SessionCard（单个会话卡片）

```
.session-card
├── .status-icon-dot   （8px 圆点，颜色由 .status-{starting|idle|...} 决定）
├── .session-card-body
│   ├── .session-card-title    （单行省略，12.5px）
│   └── .session-card-meta     （provider · model，10.5px tabular）
└── .session-card-close        （× 按钮，默认 opacity:0，hover 时显隐）
```

- Hover：背景 `--bg-list-hover` + 关闭按钮显形
- Active：背景 `--bg-list-selected` + **3px 左侧 accent bar**
- 已停止：opacity 0.7 + 斜体；active 时回升至 0.9

---

## 三、色彩系统（OKLCH）

### 3.1 背景分层（由深到浅递进，浅主题相反）

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--bg-app` | `oklch(.155 .005 285.8)` | `oklch(.964 .001 286.4)` | 应用最底层（IconRail 底色） |
| `--bg-sidebar` | `oklch(.155 .005 285.8)` | `oklch(.964 .001 286.4)` | Sidebar 背景 |
| `--bg-main` | `oklch(.18 .005 285.8)` | `oklch(.988 0 0)` | Main 内容区 |
| `--bg-header` | `oklch(.21 .006 285.9)` | `oklch(1 0 0)` | 顶栏 / 设置卡 |
| `--bg-input` | `oklch(.235 .007 285.9)` | `oklch(1 0 0)` | 输入框 / 次级按钮 |
| `--bg-modal` | `oklch(.235 .007 285.9)` | `oklch(1 0 0)` | 弹窗 |
| `--bg-list-hover` | `oklch(.274 .006 286)` | `oklch(.967 .001 286.4)` | 列表悬停 |
| `--bg-list-selected` | `oklch(.3 .006 286)` | `oklch(.95 .002 286.4)` | 列表选中 |
| `--bg-result` | `oklch(.13 .005 285.8)` | `oklch(.95 .002 286)` | 工具调用结果背景 |

### 3.2 文本

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--text-primary` | `oklch(.985 0 0)` | `oklch(.155 .005 286)` | 主文本 |
| `--text-secondary` | `oklch(.75 .005 286)` | `oklch(.42 .01 286)` | 次要文本 |
| `--text-muted` | `oklch(.62 .01 286)` | `oklch(.55 .01 286)` | 弱化/占位 |
| `--text-dim` | `oklch(.68 .01 286)` | `oklch(.48 .01 286)` | 极弱（时间戳等） |
| `--text-code` | `oklch(.72 .13 255)` | `oklch(.45 .16 255)` | 内联代码 |
| `--text-error` | `oklch(.78 .16 22)` | `oklch(.5 .2 27)` | 错误文本 |

### 3.3 强调色（Accent）

| Token | 深色 | 浅色 | 语义 |
|---|---|---|---|
| `--accent-blue` | `oklch(.65 .16 255)` | `oklch(.55 .16 255)` | 主色 / 链接 / 运行中 / focus |
| `--accent-green` | `oklch(.65 .15 145)` | `oklch(.55 .16 145)` | 成功 / 空闲 |
| `--accent-red` | `oklch(.704 .191 22)` | `oklch(.577 .245 27)` | 危险 / 退出 |
| `--accent-yellow` | `oklch(.75 .16 85)` | 同 | 警告 / 启动中 |
| `--accent-purple` | `oklch(.6 .16 300)` | `oklch(.5 .18 300)` | 压缩中 |
| `--accent-gray` | `oklch(.62 .01 286)` | `oklch(.55 .01 286)` | 中性 |

### 3.4 边框

| Token | 深色 | 浅色 |
|---|---|---|
| `--border-primary` | `oklch(1 0 0 / 10%)` | `oklch(.92 .004 286)` |
| `--border-input` | `oklch(1 0 0 / 14%)` | `oklch(.88 .005 286)` |
| `--border-focus` | `oklch(.65 .16 255)` | `oklch(.55 .16 255)` |

### 3.5 会话状态色（对应 SessionStatus）

| 状态 | Token | 色相 | 脉冲动画 |
|---|---|---|---|
| starting 启动中 | `--accent-yellow` | 黄 | 否 |
| idle 空闲 | `--accent-green` | 绿 | 否 |
| busy 运行中 | `--accent-blue` | 蓝 | 是 |
| compacting 压缩中 | `--accent-purple` | 紫 | 是 |
| exited 已退出 | `--accent-red` | 红 | 否（opacity 0.6） |

实现：会话 `StatusIcon` 渲染 `.status-icon-dot.status-{status}`，颜色与脉冲通过 CSS 类切换，**禁止在 JS 中写死颜色**。

### 3.6 Issue 状态 / 优先级色（Kanban）

| Token | 用途 |
|---|---|
| `--issue-status-backlog` … `--issue-status-cancelled` | 七态语义色；列 tint、`IssueStatusIcon`、Working chip |
| `--priority-urgent` / `high` / `medium` / `low` | `PriorityIcon` 竖条填充色 |

列背景用 `color-mix(in oklch, var(--issue-status-*) 10–12%, var(--bg-header))`，**不要**给卡片整边上色。

---

## 四、字体

```
--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
             "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif;
--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas,
             "Courier New", monospace;
```

- **正文**：Inter（400/500/600/700 四字重），含中文回退（苹方 / 微软雅黑）。
- **等宽**：Geist Mono（400/500），用于代码块、工具调用参数、pid、tabular-nums 数字。
- 字体文件本地内嵌于 `src/renderer/fonts/`（latin + latin-ext 子集），`font-display: swap`，离线可用。
- 全局 `body { font-size: 13px; line-height: 1.5 }`，紧凑密度。
- **例外**：Composer 输入框、Dialog 输入控件保持 `14px`（这是用户主动输入区域，13px 会显得过小影响输入体验）。
- 数字对齐用 `.tabular { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }`。

---

## 五、圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 小按钮、tab 角标、关闭按钮 |
| `--radius-md` | 8px | 输入框、按钮、工具卡、卡片 |
| `--radius-lg` | 10px | 消息气泡、IconRail/Sidebar 头部 |
| `--radius-xl` | 14px | 弹窗 |
| `--radius-2xl` | 18px | 大卡片（预留） |

---

## 六、阴影（深/浅两套）

| Token | 深色 | 浅色 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgb(0 0 0/.24), 0 1px 1px rgb(0 0 0/.18)` | `0 1px 2px rgb(15 23 42/.05), …` |
| `--shadow-md` | `0 8px 24px rgb(0 0 0/.32), 0 2px 6px rgb(0 0 0/.18)` | `0 8px 24px rgb(15 23 42/.1), …` |
| `--shadow-lg` | `0 16px 40px rgb(0 0 0/.46), 0 3px 10px rgb(0 0 0/.24)` | `0 16px 40px rgb(15 23 42/.16), …` |

弹窗用 `--shadow-lg`，悬浮卡用 `--shadow-md`，IconRail/Sidebar 不用阴影（靠 `--border-primary` 区分列）。

---

## 七、相对色派生（设计签名技术）

hover / focus / active 高亮**不另设 token**，用 `oklch(from var(--x) l c h / α)` 语法从基础 token 派生：

```css
/* focus 光晕 */
.search-input:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px oklch(from var(--accent-blue) l c h / 0.18);
}

/* 危险 hover 背景 */
.session-card-close:hover {
  color: var(--accent-red);
  background: oklch(from var(--accent-red) l c h / 0.12);
}

/* 脉冲动画 box-shadow */
.status-icon-dot[data-pulse="true"] {
  animation: pulse 1.2s ease-in-out infinite;
  box-shadow: 0 0 0 0 oklch(from var(--accent-blue) l c h / 0.4);
}
```

语法规则：`oklch(from <token> <L> <C> <H> / <alpha>)`，`L C H` 三个通道可重写为 `l c h` 保留原值。

---

## 八、组件规范

### 8.1 按钮（六型）

| 类 | 背景 | 文字 | 边框 | 用途 |
|---|---|---|---|---|
| `.btn-primary` | `--btn-bg`（= `--accent-blue`） | `--btn-text`（白） | 无 | 主要操作 |
| `.btn-secondary` | `--bg-input` | `--text-primary` | `.5px --border-input` | 次要操作 |
| `.btn-danger` | `--accent-red` | `--btn-text` | 无 | 删除/中止 |
| `.btn-success` | `--accent-green` | `--btn-success-text` | 无 | 成功/继续 |
| `.btn-ghost` | 透明 | `--text-secondary` | `.5px transparent` | 工具栏轻操作，hover 显 `--bg-list-hover` |
| `.btn-link` | 透明 | `--accent-blue` | 透明 | 文本式按钮，hover 下划线 |

统一规范：`border-radius: var(--radius-md)`；padding `8px 16px`；`font-size: 13px`；`transition: background .12s, border-color .12s, opacity .12s`。

变体别名（历史遗留，不推荐新建使用）：`.btn-send` = `.btn-primary`、`.btn-abort` = `.btn-danger`、`.btn-resume` = `.btn-success`。

### 8.2 消息气泡（六类）

统一基类 `.bubble`：`border-radius: var(--radius-lg); padding: 10px 14px; font-size: 13px; line-height: 1.6; word-break: break-word; max-width: 82%`。

| 类型 | 对齐 | 背景 | 特征 |
|---|---|---|---|
| 用户 `.bubble-user` | 右 `flex-end` | `--bubble-user`（蓝调） | 白字；`.bubble-pending` opacity 0.55 |
| 助手 `.bubble-text` | 左 `flex-start` | `--bubble-text` | Markdown 渲染 |
| 思考 `.bubble-thinking` | 左 | `--bubble-thinking` | 斜体、可折叠（`<details>`）；Brain 图标 |
| 工具 `.bubble-tool` | 左 | `--bubble-tool` | **左边框条 `3px --accent-blue`**；可折叠；Loader2/Wrench/XCircle 图标 |
| 结果 `.bubble-result` | 左 | `--bubble-result` | **左边框条 `3px --accent-green`**；可折叠 |
| 系统 `.bubble-system` | 居中 | 透明 | 12px、斜体、居中 |

工具气泡错误态：`.bubble-tool.toolcall-error` → 左边框 `--accent-red`。

消息流容器 `.message-stream`：`flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:10px`。

### 8.3 弹窗

- `.dialog-overlay` / `.modal-overlay`：全屏 `--overlay-bg`（深 `rgb(0 0 0/.55)` / 浅 `rgb(15 23 42/.35)`）+ flex 居中 + `backdrop-filter: blur(2px)`（可选）+ `z-index: 100`。
- `.dialog` / `.modal`：`--bg-modal` + `.5px --border-primary` + `--radius-xl` + `--shadow-lg` + `padding: 24px` + `min-width: 400px`。
- `.dialog-actions` / `.modal-actions`：右对齐 `gap: 8px`，左下角删除按钮用 `.btn-danger` + `margin-right: auto`。

### 8.4 滚动条

- 全局 10px 宽，`.track` 透明，`.thumb` 用 `--scrollbar-thumb`（深 `oklch(1 0 0 / 10%)` / 浅 `oklch(0 0 0 / 12%)`），hover `--scrollbar-thumb-hover`。

### 8.5 主题切换

- `ThemeToggle` 组件：渲染在 IconRail `.iconrail-bot` 顶部。
- 切换 action `toggleTheme()`：写 `document.body.dataset.theme` + 更新 `theme` 字段。
- body 加 `transition: background-color .2s ease, color .2s ease`，主题切换平滑过渡。
- 当前仅内存态（刷新回到 dark）。持久化需扩展，可加 localStorage。

### 8.6 Issue / Kanban（对齐 Multica / Linear 信息层级）

灵感来自 [Multica](https://github.com/multica-ai/multica) 看板与详情，**视觉语言**对齐；已引入 **Project** 分组（Issue 多对一 + 进度汇总），以及 Agent 主动改状态 / Skill 提炼等编排能力；仍不做 Labels。

#### IssueCard（主结构）

```
.issue-card
├── .issue-card-row1     PriorityIcon + .issue-key | .issue-card-working
├── .issue-card-title    13px / 500 / line-clamp-2（主视觉）
├── .issue-card-project  可选，11px muted（所属项目名）
├── .issue-card-desc     可选，11.5px muted，单行省略
└── .issue-card-row4     ActorAvatar + 名 | due / 相对时间 + MessageSquare 计数
```

- 卡片用 `--bg-main` + `0.5px` 边框 + `--shadow-sm`；hover 只微调边框/底
- 优先级：仅 `PriorityIcon`（4 格竖条 SVG）；Key 为 muted mono
- **禁止**彩色文字优先级徽章、**禁止** emoji（评论计数用 lucide `MessageSquare`）
- 活跃 Task：右上角 `.issue-card-working`（「Working」脉冲 chip）
- 项目名不得压过标题层级（小字 muted，非徽章堆砌）

#### Kanban 列

- 固定列宽 **280px**（`grid-auto-flow: column` + `grid-auto-columns: 280px`），横向滚动
- 列头：`IssueStatusIcon`（进度环 SVG）+ 标题 + 计数；**不用**实心圆点作主指示
- 列壳 `rounded-xl` + 状态 tint；空态文案「暂无 issue」

> 会话状态用 `StatusIcon`（圆点）；Issue 状态用 `IssueStatusIcon`（进度环）。二者勿混名。

#### IssueDetail（文档主栏 + 右侧 Properties）

```
.issue-detail-layout
├── .issue-detail-doc          max-width 48rem；面包屑 / 大标题 / 描述 / Activity
└── .issue-detail-sidebar      ~300px；Properties 网格 + 操作 + 只读时间戳
```

- 标题：`.issue-title-hero` ≈ 22px / 700
- Properties 行：`.issue-prop-row` = label 88px + 控件；label muted
- TaskHistory 挂在主栏 Activity 下方

#### 评论线程

- `.comment-item` 轻卡片；头行 `ActorAvatar`（md）+ 作者 + 时间
- `.comment-body` 左缩进约 48px（对齐 Multica `pl-12`）
- agent 评论：左边线 accent，非整块重染色

---

## 九、动效

- `prefers-reduced-motion: reduce` 时全局动画降到 0.01ms（媒体查询）。
- 状态圆点脉冲：`pulse 1.2s ease-in-out infinite`，opacity 1→0.55→1 + box-shadow 扩散。
- 流式光标：`blink 1s step-start infinite`（仅 opacity），光标字符用 `▍`（U+258D 半块，更稳）。
- 工具图标旋转：`spin 1s linear infinite`（Loader2）。
- 过渡：`transition: background .12s, border-color .12s, color .12s, opacity .12s`，交互元素统一。

---

## 十、图标系统

- **lucide-react** 为唯一图标库，命名导入（不要 `import *`），尺寸按使用场景：
  - IconRail 按钮：16–18px
  - SessionCard / 工具气泡头部：12–13px
  - 主题切换：14px
- 状态圆点不通过图标表达，使用 `.status-icon-dot` 自定义 8px 圆，颜色由 CSS 类决定。
- 颜色统一用 `currentColor` 或 `--text-muted`，hover 用 `--text-primary`。

---

## 十一、共享工具（src/shared/utils.ts）

编辑器重复代码已收敛到 `shared/utils.ts`，新增插件/Agent 编辑器必须复用：

- `formatBytes(n)`：字节数人类可读
- `NAME_REGEX`：`Record<PluginType, RegExp>`，文件名校验
- `PLUGIN_TYPE_LABEL`：`Record<PluginType, string>`，UI 显示名
- `buildNewBody(...)`：新建插件文件时构造 frontmatter + 模板正文

不要在 `PluginEditor.tsx` / `AgentFileEditor.tsx` 重新定义上述常量。

---

## 十二、状态路由模型

`store.ts` 拆分三层路由字段（取代旧的虚拟 ID `__plugins__` / `__agents__`）：

```ts
type PanelKind =
  | "chat" | "agents" | "plugins" | "settings"
  | "squads" | "autopilots" | "inbox";

// chat 下另有 viewMode: "kanban" | "list" | "session"
```

路由矩阵（摘要）：

| activePanel / viewMode | Main 渲染 |
|---|---|
| `chat` + `kanban` | KanbanPanel |
| `chat` + `list` | IssueDetail |
| `chat` + `session` | MessageList + Composer |
| `agents` / `plugins` / `squads` / `autopilots` / `inbox` / `settings` | 对应面板 |

迁移：`setActive(id)` 保留为薄壳，自动根据 id 类型路由（`__plugins__` → `setPanel("plugins")`，真实会话 id → `setSession(id)`，persisted id → `setPersistedSession(id)`）。

---

## 十三、实现映射

| 设计要素 | 落地位置 |
|---|---|
| Design tokens | `src/renderer/styles.css` 顶部 `:root` + `body[data-theme=light]` |
| @font-face | `styles.css` 引用 `./fonts/*.woff2` |
| 三列布局 | `.app` grid + `.iconrail` + `.sidebar` + `.main` |
| 组件类名 | `components/*.tsx` 采用本文档语义类名（`.bubble-*` / `.btn-*` / `.session-card` / `.iconrail-btn` 等） |
| 主题切换 | `body.dataset.theme` + `useStore.toggleTheme()`，由 IconRail `.iconrail-bot` 按钮触发 |
| 图标 | lucide-react named import + 会话 `StatusIcon` / Issue `IssueStatusIcon` / `PriorityIcon` / `ActorAvatar` |
| Issue 看板/详情 | `KanbanPanel` / `IssueCard` / `IssueDetail` + `.kanban-*` / `.issue-*` / `.comment-*` |
| 共享工具 | `src/shared/utils.ts`（formatBytes / NAME_REGEX / buildNewBody） |
| IPC 类型 | `src/shared/types.ts` 单一事实源，含 `PanelKind` |

---

## 十四、反模式（禁止）

1. ❌ 在组件内写硬编码颜色（如 `#e8c33d` `color: #fff`）→ 必须用 token 或 `oklch(from ...)` 派生。
2. ❌ 用 emoji 作为 UI 图标 → 用 lucide-react。
3. ❌ 用 `style={{ ... }}` 内联样式 → 用语义类名。
4. ❌ 引用已删除的 `PLUGIN_TAB_ID` / `AGENTS_TAB_ID` 虚拟 ID → 用 `PanelKind`。
5. ❌ 在 `PluginEditor` / `AgentFileEditor` 重新定义 `formatBytes` / `NAME_REGEX` / `buildNewBody` → 引用 `shared/utils.ts`。
6. ❌ 用 `import * as Icons from "lucide-react"` → 用 named import 减小包体积。
7. ❌ 创建新按钮变体但不走 `.btn-*` 命名 → 必须复用六型之一或扩展。
8. ❌ 给新元素加 1px 实色边框 → 用 `0.5px` + 半透明 token 边框。
9. ❌ 用 outline 做焦点环 → 用 `box-shadow: 0 0 0 3px oklch(from var(--accent-blue) l c h / 0.18)`。
10. ❌ Issue 卡片上用文字优先级徽章 / 实心状态圆点堆砌 → 用 `PriorityIcon` + `IssueStatusIcon`（列头）+ Working chip。
11. ❌ 把会话 `StatusIcon` 与 Issue `IssueStatusIcon` 混为一个组件 → 会话圆点 / Issue 进度环分文件。