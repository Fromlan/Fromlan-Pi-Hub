/**
 * 共享类型与 IPC 通道常量 —— main / preload / renderer 三端的单一事实源。
 */

/** IPC 通道名集中定义，避免字符串散落导致拼写不一致。 */
export const IPC = {
  // 会话调用类（renderer -> main，invoke/handle）
  sessionList: "session:list",
  sessionGet: "session:get",
  sessionStart: "session:start",
  sessionPrompt: "session:prompt",
  sessionSteer: "session:steer",
  sessionAbort: "session:abort",
  sessionKill: "session:kill",
  sessionKillAll: "session:killAll",
  sessionUpdateTitle: "session:updateTitle",
  sessionGetMessages: "session:getMessages",
  // 应用级
  appGetModels: "app:getModels",
  appGetHomeDir: "app:getHomeDir",
  appPathStat: "app:pathStat",
  appPickDirectory: "app:pickDirectory",
  // 持久化类
  sessionSaveMessages: "session:saveMessages",
  historyList: "history:list",
  historyGetMessages: "history:getMessages",
  historyResume: "history:resume",
  historyDelete: "history:delete",
  // 插件管理类（renderer -> main，invoke/handle）
  pluginList: "plugin:list",
  pluginRead: "plugin:read",
  pluginSave: "plugin:save",
  pluginDelete: "plugin:delete",
  pluginCreate: "plugin:create",
  // 独立 agent 管理类（renderer -> main，invoke/handle）
  agentList: "agent:list",
  agentCreate: "agent:create",
  agentDelete: "agent:delete",
  agentFileList: "agent:file:list",
  agentFileRead: "agent:file:read",
  agentFileSave: "agent:file:save",
  agentFileCreate: "agent:file:create",
  agentFileDelete: "agent:file:delete",
  // Issue 管理类（renderer -> main，invoke/handle）
  issueList: "issue:list",
  issueGet: "issue:get",
  issueCreate: "issue:create",
  issueUpdate: "issue:update",
  issueDelete: "issue:delete",
  issueAssign: "issue:assign",
  issueStatus: "issue:status",
  commentList: "comment:list",
  commentAdd: "comment:add",
  commentDelete: "comment:delete",
  // 事件类（main -> renderer，send/on）
  sessionSpawned: "session:spawned",
  sessionKilled: "session:killed",
  sessionChange: "session:change",
  sessionEvent: "session:event",
  pluginChanged: "plugin:changed",
  agentChanged: "agent:changed",
  issueChanged: "issue:changed",
  issueCreated: "issue:created",
  issueDeleted: "issue:deleted",
  commentAdded: "comment:added",
  commentDeleted: "comment:deleted",
} as const;

/** 插件类型字面量：限定到 ~\/.pi/agent/ 下的三个白名单子目录。 */
export type PluginType = "prompts" | "skills" | "extensions";

/** 插件列表条目（不含文件正文）。 */
export interface PluginItemMeta {
  /** 不含扩展名的名称（prompts 为 .md 文件名，skills 为目录名，extensions 为 .ts 文件名）。 */
  name: string;
  /** 相对 ~/.pi/agent/ 的相对路径，含子目录结构。 */
  relPath: string;
  /** 文件或目录字节数。 */
  size: number;
  /** 最近修改时间（毫秒）。 */
  mtime: number;
  /** lstat 判定是否为符号链接。 */
  isSymlink: boolean;
  /** 解析顶层 frontmatter 得到的字段子集（用于列表展示）；复杂结构不解析。 */
  frontmatter?: {
    description?: string;
    /** 仅 skills 包含。 */
    name?: string;
    /** 仅 prompts 包含。 */
    argumentHint?: string;
  };
}

/** 插件单文件读取结果。 */
export interface PluginFile {
  meta: PluginItemMeta;
  /** 完整文件原文（含 frontmatter 块）。 */
  body: string;
}

/** 插件变更事件负载。 */
export interface PluginChangedPayload {
  type: PluginType;
  name: string;
  action: "saved" | "deleted" | "created";
}

/** 主面板类型：与左侧 IconRail 的导航项一一对应。 */
export type PanelKind = "chat" | "agents" | "plugins" | "settings";

export type SessionStatus =
  | "starting"
  | "idle"
  | "busy"
  | "compacting"
  | "exited";

/** 传给 renderer 的会话快照（不含底层进程句柄）。 */
export interface SessionSnapshot {
  id: string;
  provider: string;
  model: string;
  cwd?: string;
  title: string;
  status: SessionStatus;
  messageCount: number;
  pendingMessageCount: number;
  piSessionId?: string;
  pid?: number;
  createdAt: number;
  lastActivityAt: number;
  /** 绑定的 agent 名（用于 resume 时还原；新建会话时由 StartSessionOpts 传入）。 */
  agentName?: string;
  /** 阶段 1：从此 issue 派生的会话；旧数据为 undefined。 */
  issueId?: string;
}

/** 新建会话的参数。 */
export interface StartSessionOpts {
  provider: string;
  model: string;
  cwd?: string;
  title?: string;
  noSession?: boolean;
  /**
   * 绑定的 agent 名称。undefined = 用全局 ~/.pi/agent/；
   * 有值 = 用 ~/.pi/agents/<name>/ 并关闭全局/项目级发现。
   */
  agentName?: string;
  /** 阶段 1：从 IssueDetail.Run 启动时传入；用于 session-card 来源标签与会话反查。 */
  issueId?: string;
}

/** Agent 元数据。 */
export interface AgentMeta {
  name: string;
  description?: string;
  createdAt: number;
}

/** Agent 变更事件负载。 */
export interface AgentChangedPayload {
  /** agent 名称；fileList/fileRead/... 事件也会带上 plugin 子类型以供 renderer 局部刷新。 */
  name: string;
  type?: PluginType;
  action: "created" | "deleted" | "saved" | "fileCreated" | "fileSaved" | "fileDeleted";
}

/** get_available_models 返回的模型条目（宽松结构）。 */
export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

/** Pi RPC 事件的宽松结构（type + 任意字段）。 */
export interface PiEvent {
  type: string;
  [key: string]: unknown;
}

/** main -> renderer 的会话事件负载。 */
export interface SessionEventPayload {
  sessionId: string;
  event: PiEvent;
}

/** IPC 调用的统一返回信封。 */
export type IpcResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** 序列化后的消息数据（不含运行时瞬态字段）。 */
export interface ToolCallData {
  id: string;
  name: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
}

export interface MsgData {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  thinking?: string;
  toolCalls?: ToolCallData[];
}

// ── Issue / Comment 子系统（阶段 1） ──

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type IssuePriority = "urgent" | "high" | "medium" | "low";

/**
 * Polymorphic assignee —— 与 Multica 同构。
 * 阶段 1 实际仅 `agent` 类型可在 UI 中选择；`human` / `squad` 渲染为 disabled + tooltip。
 */
export type AssigneeKind = "human" | "agent" | "squad";

export interface Assignee {
  kind: AssigneeKind;
  id: string;
}

export interface Issue {
  id: string;
  /** 人类可读编号，格式 `FPH-1`；计数器自增永不回收。 */
  key: string;
  title: string;
  description?: string;
  status: IssueStatus;
  priority: IssuePriority;
  assignee: Assignee;
  parent?: string;
  createdAt: number;
  updatedAt: number;
  dueDate?: number;
}

export interface Comment {
  id: string;
  issueId: string;
  author: { kind: AssigneeKind; id: string; name: string };
  body: string;
  /** 占位字段，阶段 1 不实现 mention picker，解析留给阶段 3。 */
  mentions: Array<{ kind: AssigneeKind; id: string }>;
  createdAt: number;
}

export interface IssueCreateInput {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee?: Assignee;
  parent?: string;
  dueDate?: number;
}
