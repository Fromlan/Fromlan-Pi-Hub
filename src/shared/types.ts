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
  // 插件管理类（main -> renderer，invoke/handle）
  pluginList: "plugin:list",
  pluginRead: "plugin:read",
  pluginSave: "plugin:save",
  pluginDelete: "plugin:delete",
  pluginCreate: "plugin:create",
  // 事件类（main -> renderer，send/on）
  sessionSpawned: "session:spawned",
  sessionKilled: "session:killed",
  sessionChange: "session:change",
  sessionEvent: "session:event",
  pluginChanged: "plugin:changed",
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

/** 虚拟标签 id：以 "__" 开头以与真实会话 id 区分。 */
export const PLUGIN_TAB_ID = "__plugins__";

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
}

/** 新建会话的参数。 */
export interface StartSessionOpts {
  provider: string;
  model: string;
  cwd?: string;
  title?: string;
  noSession?: boolean;
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
