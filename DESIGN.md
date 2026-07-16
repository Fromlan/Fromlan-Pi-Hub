# Lite-Pi 外观设计文档

> 本设计系统提炼自参照项目 `pi-desktop-fleet` 的视觉语言，作为 Lite-Pi 客户端样式的权威规范。核心特征：**OKLCH 色彩空间、深色为默认的双主题、Inter + Geist Mono 字体、细边框与柔和阴影**。

---

## 一、设计原则

1. **深色优先**：`:root` 即深色主题，`body[data-theme="light"]` 覆盖为浅色。默认深色，切换浅色只改一组变量。
2. **OKLCH 色彩**：所有颜色用 `oklch(L C H)` 表达，感知均匀，深浅主题只需调 L（亮度）即可保持色相一致。
3. **Token 驱动**：组件不写死颜色/圆角/阴影，一律引用 CSS 变量。改主题=改 token，不动组件。
4. **克制的层次**：用背景色分层（app < sidebar < main < header < input）+ 细边框（0.5px）+ 三级阴影表达层级，不用重描边。

---

## 二、色彩系统（OKLCH）

### 2.1 背景分层（由深到浅递进，浅主题相反）

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--bg-app` | `oklch(.155 .005 285.8)` | `oklch(.964 .001 286.4)` | 应用最底层 |
| `--bg-sidebar` | `oklch(.155 .005 285.8)` | `oklch(.964 .001 286.4)` | 侧栏/标签栏 |
| `--bg-main` | `oklch(.18 .005 285.8)` | `oklch(.988 0 0)` | 主内容区 |
| `--bg-header` | `oklch(.21 .006 285.9)` | `oklch(1 0 0)` | 顶栏 |
| `--bg-input` | `oklch(.235 .007 285.9)` | `oklch(1 0 0)` | 输入框/次级按钮 |
| `--bg-modal` | `oklch(.235 .007 285.9)` | `oklch(1 0 0)` | 弹窗 |
| `--bg-list-hover` | `oklch(.274 .006 286)` | `oklch(.967 .001 286.4)` | 列表悬停 |
| `--bg-list-selected` | `oklch(.3 .006 286)` | `oklch(.95 .002 286.4)` | 列表选中 |

### 2.2 文本

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--text-primary` | `oklch(.985 0 0)` | `oklch(.155 .005 286)` | 主文本 |
| `--text-secondary` | `oklch(.75 .005 286)` | `oklch(.42 .01 286)` | 次要文本 |
| `--text-muted` | `oklch(.62 .01 286)` | `oklch(.55 .01 286)` | 弱化/占位 |
| `--text-dim` | `oklch(.68 .01 286)` | `oklch(.48 .01 286)` | 极弱（时间戳等） |
| `--text-code` | `oklch(.72 .13 255)` | `oklch(.45 .16 255)` | 内联代码 |
| `--text-error` | `oklch(.78 .16 22)` | `oklch(.5 .2 27)` | 错误文本 |

### 2.3 强调色（Accent）

| Token | 深色 | 浅色 | 语义 |
|---|---|---|---|
| `--accent-blue` | `oklch(.65 .16 255)` | `oklch(.55 .16 255)` | 主色/链接/运行中 |
| `--accent-green` | `oklch(.65 .15 145)` | `oklch(.55 .16 145)` | 成功/空闲 |
| `--accent-red` | `oklch(.704 .191 22)` | `oklch(.577 .245 27)` | 危险/退出 |
| `--accent-yellow` | `oklch(.75 .16 85)` | 同 | 警告/启动中 |
| `--accent-gray` | `oklch(.62 .01 286)` | `oklch(.55 .01 286)` | 中性 |

### 2.4 边框

| Token | 深色 | 浅色 |
|---|---|---|
| `--border-primary` | `oklch(1 0 0 / 10%)` | `oklch(.92 .004 286)` |
| `--border-input` | `oklch(1 0 0 / 14%)` | `oklch(.88 .005 286)` |
| `--border-focus` | `oklch(.65 .16 255)` | `oklch(.55 .16 255)` |

### 2.5 会话状态色（对应 SessionStatus）

| 状态 | Token | 色相 |
|---|---|---|
| starting 启动中 | `--accent-yellow` | 黄 |
| idle 空闲 | `--accent-green` | 绿 |
| busy 运行中 | `--accent-blue` | 蓝（脉冲动画） |
| compacting 压缩中 | `--accent-purple` `oklch(.6 .16 300)` | 紫（脉冲） |
| exited 已退出 | `--accent-red` | 红 |

---

## 三、字体

```
--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
             "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif;
--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas,
             "Courier New", monospace;
```

- **正文**：Inter（400/500/600/700 四字重），含中文回退（苹方 / 微软雅黑）。
- **等宽**：Geist Mono（400/500），用于代码块、工具调用参数、pid、tabular-nums 数字。
- 字体文件本地内嵌于 `src/renderer/fonts/`（latin + latin-ext 子集），`font-display: swap`，离线可用。
- 数字对齐用 `.tabular { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }`。

---

## 四、圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 小按钮、标签 |
| `--radius-md` | 8px | 输入框、按钮、工具卡 |
| `--radius-lg` | 10px | 消息气泡 |
| `--radius-xl` | 14px | 弹窗 |
| `--radius-2xl` | 18px | 大卡片 |

---

## 五、阴影（深/浅两套）

| Token | 深色 | 浅色 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgb(0 0 0/.24), 0 1px 1px rgb(0 0 0/.18)` | `0 1px 2px rgb(15 23 42/.05), …` |
| `--shadow-md` | `0 8px 24px rgb(0 0 0/.32), 0 2px 6px rgb(0 0 0/.18)` | `0 8px 24px rgb(15 23 42/.1), …` |
| `--shadow-lg` | `0 16px 40px rgb(0 0 0/.46), 0 3px 10px rgb(0 0 0/.24)` | `0 16px 40px rgb(15 23 42/.16), …` |

弹窗用 `--shadow-lg`，悬浮卡用 `--shadow-md`。

---

## 六、组件规范

### 6.1 按钮（六型）

| 类 | 背景 | 文字 | 边框 |
|---|---|---|---|
| `.btn-primary` | `--accent-blue` | 白 | 无 |
| `.btn-secondary` | `--bg-input` | `--text-primary` | `.5px --border-input` |
| `.btn-danger` | `--accent-red` | 白 | 无 |
| `.btn-success` | `--accent-green` | 深 | 无 |
| `.btn-ghost` | 透明 | `--text-secondary` | `.5px transparent`（悬停显边） |
| `.btn-link` | 无 | `--accent-blue` | 无，文本样式 |

统一 `border-radius: var(--radius-md)`；padding `8px 16px`；`font-size: 14px`。

### 6.2 消息气泡（对话核心）

统一基类 `.bubble`：`border-radius: var(--radius-lg); padding: 10px 14px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-width` 约 80%。

| 类型 | 对齐 | 背景 | 特征 |
|---|---|---|---|
| 用户 `.bubble-user` | 右 `flex-end` | `--bubble-user`（蓝调） | 白字 |
| 助手 `.bubble-text` | 左 `flex-start` | `--bubble-text` | Markdown 渲染 |
| 思考 `.bubble-thinking` | 左 | `--bubble-thinking` | 斜体、12px、可折叠 |
| 工具 `.bubble-tool` | 左 | `--bubble-tool` | 左边框条 `3px --accent-blue` |
| 结果 `.bubble-result` | 左 | `--bubble-result` | 左边框条 `3px --accent-green` |
| 系统 `.bubble-system` | 居中 | 透明 | 11px、斜体、居中 |

消息流容器 `.message-stream`：`flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:10px`。

### 6.3 弹窗

`.modal-overlay`：全屏 `--overlay-bg`（深 `rgb(0 0 0/.55)` / 浅 `rgb(15 23 42/.35)`）+ flex 居中。
`.modal`：`--bg-modal` + `.5px --border-primary` + `--radius-xl` + `--shadow-lg`。
`.modal-actions`：右对齐 `gap:8px`。

### 6.4 标签栏（Tab）

标签：`--radius-md`，选中态背景 `--bg-list-selected` + 底部/边框 `--accent-blue`；状态圆点 8px（busy/compacting 脉冲动画）。

### 6.5 滚动条

`--scrollbar-thumb: oklch(1 0 0 / 10%)`（深）/ `oklch(0 0 0 / 12%)`（浅），`--scrollbar-track: transparent`，悬停加深。

---

## 七、动效

- `prefers-reduced-motion: reduce` 时全局动画降到 0.01ms。
- 运行中状态圆点：1s ease-in-out 透明度脉冲。
- 流式光标：1s step 闪烁。
- 过渡：交互元素 `transition: background .12s, border-color .12s`。

---

## 八、实现映射

| 设计要素 | 落地位置 |
|---|---|
| Design tokens | `src/renderer/styles.css` 顶部 `:root` + `body[data-theme=light]` |
| @font-face | `styles.css` 引用 `./fonts/*.woff2` |
| 组件类名 | 各 `components/*.tsx` 采用本文档语义类名（bubble-*/btn-*/modal 等） |
| 主题切换 | 设置 `document.body.dataset.theme = "light" | "dark"` |
