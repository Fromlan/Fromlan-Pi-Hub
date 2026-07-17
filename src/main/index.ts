import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "path";
import { homedir } from "os";
import { statSync } from "fs";
import { SessionManager } from "./session-manager";
import * as pluginManager from "./plugin-manager";
import * as agentManager from "./agent-manager";
import {
  IPC,
  type StartSessionOpts,
  type PluginType,
  type PluginChangedPayload,
  type AgentChangedPayload,
} from "../shared/types";

const sessionManager = new SessionManager();
let mainWindow: BrowserWindow | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 窗口关闭后释放引用，避免泄漏（reopen 时重新创建）
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    // 开发模式：优先用 ELECTRON_RENDERER_URL（electron-vite 提供），否则兜底 http://localhost:5173。
    // 两种情况都开 DevTools，便于手动调试。
    const url = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173";
    mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ── SessionManager 事件 -> 广播到渲染进程 ──
sessionManager.on("spawned", (snap) => broadcast(IPC.sessionSpawned, snap));
sessionManager.on("killed", (id) => broadcast(IPC.sessionKilled, id));
sessionManager.on("change", (snap) => broadcast(IPC.sessionChange, snap));
sessionManager.on("event", (payload) => broadcast(IPC.sessionEvent, payload));

// ── Session IPC ──
ipcMain.handle(IPC.sessionList, () => sessionManager.list());
ipcMain.handle(IPC.sessionGet, (_e, id: string) => sessionManager.get(id) ?? null);

ipcMain.handle(IPC.sessionStart, async (_e, opts: StartSessionOpts) => {
  try {
    const snap = await sessionManager.start(opts);
    return { ok: true, session: snap };
  } catch (e) {
    console.error("[main] sessionStart:", e);
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.sessionPrompt, (_e, { id, message }: { id: string; message: string }) => {
  try {
    const r = sessionManager.prompt(id, message);
    return { ok: true, ...r };
  } catch (e) {
    console.error("[main] sessionPrompt:", e);
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.sessionSteer, (_e, { id, message }: { id: string; message: string }) => {
  try {
    const r = sessionManager.steer(id, message);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.sessionAbort, async (_e, id: string) => {
  await sessionManager.abort(id);
  return { ok: true };
});

ipcMain.handle(IPC.sessionKill, async (_e, id: string) => {
  await sessionManager.kill(id);
  return { ok: true };
});

ipcMain.handle(IPC.sessionKillAll, async () => {
  await sessionManager.killAll();
  return { ok: true };
});

ipcMain.handle(IPC.sessionUpdateTitle, (_e, { id, title }: { id: string; title: string }) => {
  const ok = sessionManager.updateTitle(id, title);
  return { ok };
});

ipcMain.handle(IPC.sessionGetMessages, (_e, id: string) => sessionManager.getMessages(id));

// ── 持久化 IPC ──
ipcMain.handle(IPC.sessionSaveMessages, (_e, { id, messages }: { id: string; messages: unknown[] }) => {
  sessionManager.saveMessagesFromRenderer(id, messages as any);
  return { ok: true };
});

ipcMain.handle(IPC.historyList, () => sessionManager.persistedSessions());

ipcMain.handle(IPC.historyGetMessages, (_e, id: string) => {
  try {
    return sessionManager.getPersistedMessages(id);
  } catch (e) {
    console.error("[main] historyGetMessages:", e);
    return [];
  }
});

ipcMain.handle(IPC.historyResume, async (_e, id: string) => {
  try {
    const snap = await sessionManager.resume(id);
    return { ok: true, session: snap };
  } catch (e) {
    console.error("[main] historyResume:", e);
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.historyDelete, (_e, id: string) => {
  sessionManager.deletePersisted(id);
  return { ok: true };
});

// ── App IPC ──
ipcMain.handle(IPC.appGetModels, (_e, id?: string) => sessionManager.getModels(id));
ipcMain.handle(IPC.appGetHomeDir, () => homedir());
ipcMain.handle(IPC.appPathStat, (_e, p: string) => {
  try {
    const s = statSync(p);
    if (!s.isDirectory()) return { ok: false, error: "不是目录" };
    return { ok: true, isDirectory: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// 唤起系统文件夹选择对话框；用户取消返回 null
ipcMain.handle(IPC.appPickDirectory, async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    title: "选择工作目录",
    properties: ["openDirectory", "dontAddToRecent"],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  return r.filePaths[0];
});

// ── Plugin IPC ──
function broadcastPlugin(payload: PluginChangedPayload): void {
  broadcast(IPC.pluginChanged, payload);
}

ipcMain.handle(IPC.pluginList, async (_e, type: PluginType) => {
  try {
    return await pluginManager.list(type);
  } catch (e) {
    console.error("[main] pluginList:", e);
    return [] as Awaited<ReturnType<typeof pluginManager.list>>;
  }
});

ipcMain.handle(IPC.pluginRead, (_e, type: PluginType, name: string) => {
  try {
    return pluginManager.read(type, name);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.pluginSave, (_e, type: PluginType, name: string, body: string) => {
  try {
    pluginManager.save(type, name, body);
    broadcastPlugin({ type, name, action: "saved" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.pluginCreate, (_e, type: PluginType, name: string, body?: string) => {
  try {
    pluginManager.create(type, name, body);
    broadcastPlugin({ type, name, action: "created" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.pluginDelete, (_e, type: PluginType, name: string) => {
  try {
    pluginManager.remove(type, name);
    broadcastPlugin({ type, name, action: "deleted" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ── Agent IPC ──
function broadcastAgent(payload: AgentChangedPayload): void {
  broadcast(IPC.agentChanged, payload);
}

ipcMain.handle(IPC.agentList, () => {
  try {
    return agentManager.list();
  } catch (e) {
    console.error("[main] agentList:", e);
    return [];
  }
});

ipcMain.handle(IPC.agentCreate, (_e, name: string, description?: string) => {
  try {
    const meta = agentManager.create(name, description);
    broadcastAgent({ name, action: "created" });
    return { ok: true, meta };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.agentDelete, (_e, name: string) => {
  try {
    agentManager.remove(name);
    broadcastAgent({ name, action: "deleted" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.agentFileList, async (_e, name: string, type: PluginType) => {
  try {
    return await agentManager.listFiles(name, type);
  } catch (e) {
    console.error("[main] agentFileList:", e);
    return [] as Awaited<ReturnType<typeof agentManager.listFiles>>;
  }
});

ipcMain.handle(IPC.agentFileRead, (_e, name: string, type: PluginType, file: string) => {
  try {
    return agentManager.readFile(name, type, file);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.agentFileSave, (_e, name: string, type: PluginType, file: string, body: string) => {
  try {
    agentManager.saveFile(name, type, file, body);
    broadcastAgent({ name, type, action: "fileSaved" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.agentFileCreate, (_e, name: string, type: PluginType, file: string, body?: string) => {
  try {
    agentManager.createFile(name, type, file, body);
    broadcastAgent({ name, type, action: "fileCreated" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.agentFileDelete, (_e, name: string, type: PluginType, file: string) => {
  try {
    agentManager.deleteFile(name, type, file);
    broadcastAgent({ name, type, action: "fileDeleted" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ── App 生命周期 ──
app.whenReady().then(() => {
  sessionManager.loadPersisted();
  createWindow();
});

// 所有窗口关闭后退出（macOS 除外，遵循 Electron 惯例）
app.on("window-all-closed", async () => {
  // 先回收所有子进程，再决定是否退出；killAll 出错也不阻塞 quit
  try {
    await sessionManager.killAll();
  } catch (e) {
    console.error("[main] killAll failed:", e);
  }
  if (process.platform !== "darwin") app.quit();
});

// 重新激活时若没有窗口则重建
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on("uncaughtException", (err) => {
  console.error("[main] uncaught:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});
