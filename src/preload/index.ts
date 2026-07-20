import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type SessionSnapshot,
  type StartSessionOpts,
  type ModelInfo,
  type SessionEventPayload,
  type IpcResult,
  type MsgData,
  type PluginType,
  type PluginItemMeta,
  type PluginFile,
  type PluginChangedPayload,
  type AgentMeta,
  type AgentChangedPayload,
  type AgentUpdatePatch,
  type AgentIdentityFile,
  type Issue,
  type IssueCreateInput,
  type IssueStatus,
  type Assignee,
  type Comment,
  type Task,
  type IssueRerunOpts,
  type AppSettings,
  type Squad,
  type SquadCreateInput,
  type Autopilot,
  type AutopilotCreateInput,
  type AutopilotRun,
  type InboxItem,
  type Project,
  type ProjectCreateInput,
} from "../shared/types";

/** 包装 ipcRenderer.on，返回取消订阅函数（供 React useEffect 清理）。 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const sessionAPI = {
  list: (): Promise<SessionSnapshot[]> => ipcRenderer.invoke(IPC.sessionList),
  get: (id: string): Promise<SessionSnapshot | null> =>
    ipcRenderer.invoke(IPC.sessionGet, id),
  start: (
    opts: StartSessionOpts
  ): Promise<IpcResult<{ session: SessionSnapshot }>> =>
    ipcRenderer.invoke(IPC.sessionStart, opts),
  prompt: (id: string, message: string): Promise<IpcResult<{ sent: boolean }>> =>
    ipcRenderer.invoke(IPC.sessionPrompt, { id, message }),
  steer: (id: string, message: string): Promise<IpcResult<{ sent: boolean }>> =>
    ipcRenderer.invoke(IPC.sessionSteer, { id, message }),
  abort: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.sessionAbort, id),
  kill: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.sessionKill, id),
  killAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.sessionKillAll),
  updateTitle: (id: string, title: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.sessionUpdateTitle, { id, title }),
  getMessages: (id: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.sessionGetMessages, id),
  // 持久化
  saveMessages: (id: string, messages: MsgData[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.sessionSaveMessages, { id, messages }),
  historyList: (): Promise<SessionSnapshot[]> =>
    ipcRenderer.invoke(IPC.historyList),
  historyGetMessages: (id: string): Promise<MsgData[]> =>
    ipcRenderer.invoke(IPC.historyGetMessages, id),
  historyResume: (id: string): Promise<IpcResult<{ session: SessionSnapshot }>> =>
    ipcRenderer.invoke(IPC.historyResume, id),
  historyDelete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.historyDelete, id),
  // 事件订阅
  onSpawned: (cb: (s: SessionSnapshot) => void) =>
    subscribe<SessionSnapshot>(IPC.sessionSpawned, cb),
  onKilled: (cb: (id: string) => void) => subscribe<string>(IPC.sessionKilled, cb),
  onChange: (cb: (s: SessionSnapshot) => void) =>
    subscribe<SessionSnapshot>(IPC.sessionChange, cb),
  onEvent: (cb: (p: SessionEventPayload) => void) =>
    subscribe<SessionEventPayload>(IPC.sessionEvent, cb),
};

const appAPI = {
  getModels: (id?: string): Promise<ModelInfo[]> =>
    ipcRenderer.invoke(IPC.appGetModels, id),
  getHomeDir: (): Promise<string> => ipcRenderer.invoke(IPC.appGetHomeDir),
  pathStat: (
    p: string
  ): Promise<{ ok: true; isDirectory: boolean } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.appPathStat, p),
  /** 唤起系统文件夹选择对话框，用户取消返回 null。 */
  pickDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.appPickDirectory),
  /** 在系统文件管理器中打开指定路径并选中目标。 */
  revealInExplorer: (p: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.appRevealInExplorer, p),
  /** 用系统默认应用打开路径（文件夹用资源管理器打开，文件用默认编辑器）。 */
  openInExplorer: (p: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.appOpenInExplorer, p),
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.appGetSettings),
  updateSettings: (
    patch: Partial<AppSettings>
  ): Promise<IpcResult<{ settings: AppSettings }>> =>
    ipcRenderer.invoke(IPC.appUpdateSettings, patch),
};

/** 读取结果用判别联合：成功返回 PluginFile，失败返回 { ok:false, error }。pluginAPI.read 与 agentAPI.fileRead 共用。 */
type FileReadResult = PluginFile | { ok: false; error: string };
/** IDENTITY 读取：成功返回 AgentIdentityFile，失败返回 { ok:false, error }。 */
type IdentityReadResult = AgentIdentityFile | { ok: false; error: string };

const pluginAPI = {
  list: (type: PluginType): Promise<PluginItemMeta[]> =>
    ipcRenderer.invoke(IPC.pluginList, type),
  read: (type: PluginType, name: string): Promise<FileReadResult> =>
    ipcRenderer.invoke(IPC.pluginRead, type, name),
  save: (
    type: PluginType,
    name: string,
    body: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.pluginSave, type, name, body),
  create: (
    type: PluginType,
    name: string,
    body?: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.pluginCreate, type, name, body),
  delete: (
    type: PluginType,
    name: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.pluginDelete, type, name),
  importSkillZip: (): Promise<IpcResult<{ name: string }>> =>
    ipcRenderer.invoke(IPC.pluginImportSkillZip),
  onChanged: (cb: (p: PluginChangedPayload) => void) =>
    subscribe<PluginChangedPayload>(IPC.pluginChanged, cb),
};

const agentAPI = {
  list: (): Promise<AgentMeta[]> => ipcRenderer.invoke(IPC.agentList),
  create: (
    name: string,
    description?: string,
    identity?: string
  ): Promise<IpcResult<{ meta: AgentMeta }>> =>
    ipcRenderer.invoke(IPC.agentCreate, name, description, identity),
  update: (
    name: string,
    patch: AgentUpdatePatch
  ): Promise<IpcResult<{ meta: AgentMeta }>> =>
    ipcRenderer.invoke(IPC.agentUpdate, name, patch),
  delete: (name: string): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.agentDelete, name),
  identityRead: (name: string): Promise<IdentityReadResult> =>
    ipcRenderer.invoke(IPC.agentIdentityRead, name),
  identitySave: (
    name: string,
    body: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.agentIdentitySave, name, body),
  fileList: (name: string, type: PluginType): Promise<PluginItemMeta[]> =>
    ipcRenderer.invoke(IPC.agentFileList, name, type),
  fileRead: (
    name: string,
    type: PluginType,
    file: string
  ): Promise<FileReadResult> =>
    ipcRenderer.invoke(IPC.agentFileRead, name, type, file),
  fileSave: (
    name: string,
    type: PluginType,
    file: string,
    body: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.agentFileSave, name, type, file, body),
  fileCreate: (
    name: string,
    type: PluginType,
    file: string,
    body?: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.agentFileCreate, name, type, file, body),
  fileDelete: (
    name: string,
    type: PluginType,
    file: string
  ): Promise<IpcResult<Record<string, never>>> =>
    ipcRenderer.invoke(IPC.agentFileDelete, name, type, file),
  onChanged: (cb: (p: AgentChangedPayload) => void) =>
    subscribe<AgentChangedPayload>(IPC.agentChanged, cb),
};

contextBridge.exposeInMainWorld("sessionAPI", sessionAPI);
contextBridge.exposeInMainWorld("appAPI", appAPI);
contextBridge.exposeInMainWorld("pluginAPI", pluginAPI);
contextBridge.exposeInMainWorld("agentAPI", agentAPI);

const issueAPI = {
  list: (): Promise<Issue[]> => ipcRenderer.invoke(IPC.issueList),
  get: (id: string): Promise<Issue | null> =>
    ipcRenderer.invoke(IPC.issueGet, id),
  create: (
    input: IssueCreateInput
  ): Promise<IpcResult<{ issue: Issue }>> =>
    ipcRenderer.invoke(IPC.issueCreate, input),
  update: (
    id: string,
    patch: Partial<Issue>
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.issueUpdate, { id, patch }),
  delete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.issueDelete, id),
  assign: (
    id: string,
    assignee: Assignee
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.issueAssign, { id, assignee }),
  setStatus: (
    id: string,
    status: IssueStatus
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.issueStatus, { id, status }),
  /** Multica：手动重新派活。 */
  rerun: (
    id: string,
    opts?: IssueRerunOpts
  ): Promise<
    IpcResult<{ task: Task | null; skipped?: string }>
  > => ipcRenderer.invoke(IPC.issueRerun, { id, opts }),
  taskList: (): Promise<Task[]> => ipcRenderer.invoke(IPC.taskList),
  taskListByIssue: (issueId: string): Promise<Task[]> =>
    ipcRenderer.invoke(IPC.taskListByIssue, issueId),
  commentList: (issueId: string): Promise<Comment[]> =>
    ipcRenderer.invoke(IPC.commentList, issueId),
  commentAdd: (
    input: Omit<Comment, "id" | "createdAt">
  ): Promise<IpcResult<{ comment: Comment }>> =>
    ipcRenderer.invoke(IPC.commentAdd, input),
  commentDelete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.commentDelete, id),
  // 事件订阅
  onCreated: (cb: (i: Issue) => void) =>
    subscribe<Issue>(IPC.issueCreated, cb),
  onChanged: (cb: (i: Issue) => void) =>
    subscribe<Issue>(IPC.issueChanged, cb),
  onDeleted: (cb: (p: { id: string }) => void) =>
    subscribe<{ id: string }>(IPC.issueDeleted, cb),
  onCommentAdded: (cb: (c: Comment) => void) =>
    subscribe<Comment>(IPC.commentAdded, cb),
  onCommentDeleted: (cb: (p: { id: string }) => void) =>
    subscribe<{ id: string }>(IPC.commentDeleted, cb),
  onTaskChanged: (cb: (t: Task) => void) =>
    subscribe<Task>(IPC.taskChanged, cb),
};

contextBridge.exposeInMainWorld("issueAPI", issueAPI);

const squadAPI = {
  list: (): Promise<Squad[]> => ipcRenderer.invoke(IPC.squadList),
  get: (id: string): Promise<Squad | null> =>
    ipcRenderer.invoke(IPC.squadGet, id),
  create: (
    input: SquadCreateInput
  ): Promise<IpcResult<{ squad: Squad }>> =>
    ipcRenderer.invoke(IPC.squadCreate, input),
  update: (
    id: string,
    patch: Partial<Squad>
  ): Promise<IpcResult<{ squad: Squad }>> =>
    ipcRenderer.invoke(IPC.squadUpdate, { id, patch }),
  delete: (
    id: string
  ): Promise<{ ok: boolean; transferred?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.squadDelete, id),
  onChanged: (cb: (s: Squad) => void) =>
    subscribe<Squad>(IPC.squadChanged, cb),
};

const autopilotAPI = {
  list: (): Promise<Autopilot[]> => ipcRenderer.invoke(IPC.autopilotList),
  create: (
    input: AutopilotCreateInput
  ): Promise<IpcResult<{ autopilot: Autopilot }>> =>
    ipcRenderer.invoke(IPC.autopilotCreate, input),
  update: (
    id: string,
    patch: Partial<Autopilot>
  ): Promise<IpcResult<{ autopilot: Autopilot }>> =>
    ipcRenderer.invoke(IPC.autopilotUpdate, { id, patch }),
  delete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.autopilotDelete, id),
  runNow: (
    id: string
  ): Promise<IpcResult<{ run: AutopilotRun }>> =>
    ipcRenderer.invoke(IPC.autopilotRunNow, id),
  runs: (id?: string): Promise<AutopilotRun[]> =>
    ipcRenderer.invoke(IPC.autopilotRuns, id),
  onChanged: (cb: (a: Autopilot) => void) =>
    subscribe<Autopilot>(IPC.autopilotChanged, cb),
};

const inboxAPI = {
  list: (): Promise<InboxItem[]> => ipcRenderer.invoke(IPC.inboxList),
  markRead: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.inboxMarkRead, id),
  markAllRead: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.inboxMarkAllRead),
  clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.inboxClear),
  onChanged: (cb: (item: InboxItem) => void) =>
    subscribe<InboxItem>(IPC.inboxChanged, cb),
};

contextBridge.exposeInMainWorld("squadAPI", squadAPI);
contextBridge.exposeInMainWorld("autopilotAPI", autopilotAPI);
contextBridge.exposeInMainWorld("inboxAPI", inboxAPI);

const projectAPI = {
  list: (): Promise<Project[]> => ipcRenderer.invoke(IPC.projectList),
  get: (id: string): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectGet, id),
  create: (
    input: ProjectCreateInput
  ): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke(IPC.projectCreate, input),
  update: (
    id: string,
    patch: Partial<Project>
  ): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke(IPC.projectUpdate, { id, patch }),
  delete: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.projectDelete, id),
  onChanged: (
    cb: (p: Project | { id: string; deleted: true }) => void
  ) => subscribe<Project | { id: string; deleted: true }>(IPC.projectChanged, cb),
};

contextBridge.exposeInMainWorld("projectAPI", projectAPI);

export type SessionAPI = typeof sessionAPI;
export type AppAPI = typeof appAPI;
export type PluginAPI = typeof pluginAPI;
export type AgentAPI = typeof agentAPI;
export type IssueAPI = typeof issueAPI;
export type SquadAPI = typeof squadAPI;
export type AutopilotAPI = typeof autopilotAPI;
export type InboxAPI = typeof inboxAPI;
export type ProjectAPI = typeof projectAPI;
