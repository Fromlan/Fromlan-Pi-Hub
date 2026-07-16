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
  // 事件类（main -> renderer，send/on）
  sessionSpawned: "session:spawned",
  sessionKilled: "session:killed",
  sessionChange: "session:change",
  sessionEvent: "session:event",
} as const;

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
