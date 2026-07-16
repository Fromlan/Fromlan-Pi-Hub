import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type SessionSnapshot,
  type StartSessionOpts,
  type ModelInfo,
  type SessionEventPayload,
  type IpcResult,
  type MsgData,
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
};

contextBridge.exposeInMainWorld("sessionAPI", sessionAPI);
contextBridge.exposeInMainWorld("appAPI", appAPI);

export type SessionAPI = typeof sessionAPI;
export type AppAPI = typeof appAPI;
