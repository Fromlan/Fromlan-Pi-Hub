import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "path";
import { homedir } from "os";
import { statSync } from "fs";
import { SessionManager } from "./session-manager";
import * as pluginManager from "./plugin-manager";
import * as agentManager from "./agent-manager";
import * as issueStore from "./issue-store";
import * as issueRunner from "./issue-runner";
import * as settingsStore from "./settings-store";
import * as squadStore from "./squad-store";
import * as projectStore from "./project-store";
import * as autopilotStore from "./autopilot-store";
import * as autopilotManager from "./autopilot-manager";
import * as inboxStore from "./inbox-store";
import { ensurePiHubHelper } from "./guide-agent";
import { uniqueMentions } from "../shared/mention";
import { startTaskMonitor, stopTaskMonitor } from "./task-monitor";
import {
  startHubAgentBridge,
  stopHubAgentBridge,
} from "./hub-agent-bridge";
import {
  IPC,
  type StartSessionOpts,
  type PluginType,
  type PluginChangedPayload,
  type AgentChangedPayload,
  type AgentUpdatePatch,
  type IssueCreateInput,
  type IssueStatus,
  type Assignee,
  type IssueRerunOpts,
  type AppSettings,
  type SquadCreateInput,
  type AutopilotCreateInput,
  type Squad,
  type Autopilot,
  type Project,
  type ProjectCreateInput,
} from "../shared/types";

const sessionManager = new SessionManager();
let mainWindow: BrowserWindow | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

issueRunner.initIssueRunner({
  sessions: sessionManager,
  broadcast,
  IPC: {
    issueChanged: IPC.issueChanged,
    commentAdded: IPC.commentAdded,
    taskChanged: IPC.taskChanged,
  },
});

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
    // 开发模式：优先用 ELECTRON_RENDERER_URL（electron-vite 提供），否则兜底 IPv4。
    // 两种情况都开 DevTools，便于手动调试。
    const url =
      process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:5173/";
    void loadDevUrlWithRetry(mainWindow, url);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/** 等 Vite renderer 就绪；避免抢连或 IPv4/IPv6 短暂拒绝。 */
async function loadDevUrlWithRetry(
  win: BrowserWindow,
  url: string,
  attempts = 20,
  delayMs = 250
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (win.isDestroyed()) return;
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (success: boolean) => {
        if (settled || win.isDestroyed()) return;
        settled = true;
        win.webContents.removeListener("did-finish-load", onFinish);
        win.webContents.removeListener("did-fail-load", onFail);
        resolve(success);
      };
      const onFinish = () => finish(true);
      const onFail = (
        _e: Electron.Event,
        _code: number,
        _desc: string,
        failedUrl: string
      ) => {
        if (
          failedUrl.startsWith("http://127.0.0.1") ||
          failedUrl.startsWith("http://localhost")
        ) {
          finish(false);
        }
      };
      win.webContents.once("did-finish-load", onFinish);
      win.webContents.once("did-fail-load", onFail);
      void win.loadURL(url).catch(() => finish(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!win.isDestroyed()) {
    console.error(`[dev] failed to load renderer after retries: ${url}`);
  }
}

// ── SessionManager 事件 -> 广播到渲染进程 ──
sessionManager.on("spawned", (snap) => broadcast(IPC.sessionSpawned, snap));
sessionManager.on("killed", (id) => broadcast(IPC.sessionKilled, id));
sessionManager.on("change", (snap) => broadcast(IPC.sessionChange, snap));
sessionManager.on("event", (payload) => broadcast(IPC.sessionEvent, payload));
sessionManager.on(
  "issue-session-completed",
  (p: { sessionId: string; summary: string }) => {
    issueRunner.onSessionCompleted(p.sessionId, p.summary);
  }
);
sessionManager.on(
  "issue-session-failed",
  (p: { sessionId: string; error: string }) => {
    issueRunner.onSessionFailed(p.sessionId, p.error);
  }
);

// ── Session IPC ──
ipcMain.handle(IPC.sessionList, () => sessionManager.list());
ipcMain.handle(IPC.sessionGet, (_e, id: string) => sessionManager.get(id) ?? null);

ipcMain.handle(IPC.sessionStart, async (_e, opts: StartSessionOpts) => {
  try {
    const snap = await sessionManager.start(opts);
    issueRunner.setDispatchDefaults(snap.provider, snap.model, snap.cwd);
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
    console.error("[main] sessionSteer:", e);
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
  try {
    sessionManager.saveMessagesFromRenderer(id, messages as any);
    return { ok: true };
  } catch (e) {
    console.error("[main] sessionSaveMessages:", e);
    return { ok: false, error: (e as Error).message };
  }
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
  try {
    sessionManager.deletePersisted(id);
    return { ok: true };
  } catch (e) {
    console.error("[main] historyDelete:", e);
    return { ok: false, error: (e as Error).message };
  }
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

// ── 文件系统 ──

// 在系统文件管理器中显示路径（选中文件或打开文件夹）
ipcMain.handle(IPC.appRevealInExplorer, async (_e, p: string) => {
  try {
    await shell.showItemInFolder(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// 用系统默认应用打开路径（文件夹打开资源管理器，文件用默认编辑器）
ipcMain.handle(IPC.appOpenInExplorer, async (_e, p: string) => {
  try {
    await shell.openPath(p);
    return { ok: true };
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

ipcMain.handle(IPC.appGetSettings, () => settingsStore.getSettings());
ipcMain.handle(IPC.appUpdateSettings, (_e, patch: Partial<AppSettings>) => {
  try {
    const settings = settingsStore.updateSettings(patch);
    const d = issueRunner.getDispatchDefaults();
    if (settings.defaultProvider || settings.defaultModel || settings.defaultCwd) {
      issueRunner.setDispatchDefaults(
        settings.defaultProvider || d.provider,
        settings.defaultModel || d.model,
        settings.defaultCwd || d.cwd
      );
    }
    return { ok: true, settings };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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

ipcMain.handle(
  IPC.agentCreate,
  (_e, name: string, description?: string, identity?: string) => {
    try {
      const meta = agentManager.create(name, description, identity);
      broadcastAgent({ name, action: "created" });
      return { ok: true, meta };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
);

ipcMain.handle(IPC.agentUpdate, (_e, name: string, patch: AgentUpdatePatch) => {
  try {
    const meta = agentManager.update(name, patch ?? {});
    broadcastAgent({ name, action: "updated" });
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

ipcMain.handle(IPC.agentIdentityRead, (_e, name: string) => {
  try {
    return agentManager.readIdentity(name);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(IPC.agentIdentitySave, (_e, name: string, body: string) => {
  try {
    agentManager.saveIdentity(name, body ?? "");
    broadcastAgent({ name, action: "identitySaved" });
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

// ── Issue IPC（阶段 1 + Assign 派活） ──
ipcMain.handle(IPC.issueList, () => issueStore.listIssues());
ipcMain.handle(IPC.issueGet, (_e, id: string) => issueStore.getIssue(id) ?? null);

ipcMain.handle(IPC.issueCreate, async (_e, input: IssueCreateInput) => {
  try {
    if (input.projectId) {
      const p = projectStore.getProject(input.projectId);
      if (!p) return { ok: false, error: "项目不存在" };
    }
    const issue = issueStore.createIssue(input);
    broadcast(IPC.issueCreated, issue);
    // 创建时已指定 agent 且非 backlog → 自动派活
    void issueRunner.maybeEnqueue(issue.id, "create");
    return { ok: true, issue };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(
  IPC.issueUpdate,
  async (_e, { id, patch }: { id: string; patch: Record<string, unknown> }) => {
    if (patch.projectId !== undefined && patch.projectId !== null && patch.projectId !== "") {
      const p = projectStore.getProject(String(patch.projectId));
      if (!p) return { ok: false, error: "项目不存在" };
    }
    const before = issueStore.getIssue(id);
    const normalized =
      patch.projectId === "" || patch.projectId === null
        ? { ...patch, projectId: undefined }
        : patch;
    const issue = issueStore.updateIssue(
      id,
      normalized as Partial<Parameters<typeof issueStore.updateIssue>[1]>
    );
    if (!issue) return { ok: false };

    broadcast(IPC.issueChanged, issue);

    const assigneeChanged =
      patch.assignee !== undefined &&
      JSON.stringify(before?.assignee) !== JSON.stringify(issue.assignee);
    const statusChanged =
      patch.status !== undefined && before?.status !== issue.status;

    if (assigneeChanged) {
      void issueRunner.maybeEnqueue(id, "assign");
    } else if (statusChanged) {
      void issueRunner.maybeEnqueue(id, "status");
    }
    return { ok: true };
  }
);

ipcMain.handle(IPC.issueDelete, (_e, id: string) => {
  const ok = issueStore.deleteIssue(id);
  if (ok) broadcast(IPC.issueDeleted, { id });
  return { ok };
});

ipcMain.handle(
  IPC.issueAssign,
  async (_e, { id, assignee }: { id: string; assignee: Assignee }) => {
    if (assignee.kind === "squad" && assignee.id) {
      const squad = squadStore.getSquad(assignee.id);
      if (!squad || squad.archived) {
        return { ok: false, error: "不能派给已归档的小队" };
      }
    }
    const issue = issueStore.assignIssue(id, assignee);
    if (!issue) return { ok: false };
    broadcast(IPC.issueChanged, issue);
    void issueRunner.maybeEnqueue(id, "assign");
    return { ok: true };
  }
);

ipcMain.handle(
  IPC.issueStatus,
  async (_e, { id, status }: { id: string; status: IssueStatus }) => {
    const issue = issueStore.setIssueStatus(id, status);
    if (!issue) return { ok: false };
    broadcast(IPC.issueChanged, issue);
    void issueRunner.maybeEnqueue(id, "status");
    return { ok: true };
  }
);

ipcMain.handle(
  IPC.issueRerun,
  async (_e, { id, opts }: { id: string; opts?: IssueRerunOpts }) => {
    const r = await issueRunner.maybeEnqueue(id, "rerun", opts);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, task: r.task, skipped: r.skipped };
  }
);

ipcMain.handle(IPC.taskList, () => issueRunner.listAllTasks());
ipcMain.handle(IPC.taskListByIssue, (_e, issueId: string) =>
  issueRunner.listTasksForIssue(issueId)
);

// ── Comment IPC（阶段 1） ──
ipcMain.handle(IPC.commentList, (_e, issueId: string) =>
  issueStore.listComments(issueId)
);

ipcMain.handle(
  IPC.commentAdd,
  (
    _e,
    input: Omit<
      Parameters<typeof issueStore.addComment>[0],
      "id" | "createdAt"
    >
  ) => {
    try {
      const mentions =
        input.mentions?.length > 0
          ? input.mentions
          : uniqueMentions(input.body).map((m) => ({
              kind: m.kind,
              id: m.id,
            }));
      const c = issueStore.addComment({ ...input, mentions });
      broadcast(IPC.commentAdded, c);
      void issueRunner.handleCommentTriggers(c);
      return { ok: true, comment: c };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
);

ipcMain.handle(IPC.commentDelete, (_e, id: string) => {
  const ok = issueStore.deleteComment(id);
  if (ok) broadcast(IPC.commentDeleted, { id });
  return { ok };
});

// ── Squad IPC ──
ipcMain.handle(IPC.squadList, () => squadStore.listSquads());
ipcMain.handle(IPC.squadGet, (_e, id: string) => squadStore.getSquad(id) ?? null);
ipcMain.handle(IPC.squadCreate, (_e, input: SquadCreateInput) => {
  try {
    const squad = squadStore.createSquad(input);
    broadcast(IPC.squadChanged, squad);
    return { ok: true, squad };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});
ipcMain.handle(
  IPC.squadUpdate,
  (_e, { id, patch }: { id: string; patch: Partial<Squad> }) => {
    const squad = squadStore.updateSquad(id, patch);
    if (!squad) return { ok: false, error: "Squad 不存在" };
    broadcast(IPC.squadChanged, squad);
    return { ok: true, squad };
  }
);
ipcMain.handle(IPC.squadDelete, (_e, id: string) => {
  // Multica 语义：delete = archive；已派给该 squad 的 issue 转给 leader agent
  const squad = squadStore.getSquad(id);
  if (!squad) return { ok: false, error: "Squad 不存在" };
  if (squad.archived) return { ok: false, error: "Squad 已归档" };

  let transferred = 0;
  for (const issue of issueStore.listIssues()) {
    if (issue.assignee.kind === "squad" && issue.assignee.id === id) {
      const updated = issueStore.assignIssue(issue.id, {
        kind: "agent",
        id: squad.leaderAgentName,
      });
      if (updated) {
        broadcast(IPC.issueChanged, updated);
        transferred++;
      }
    }
  }

  const archived = squadStore.updateSquad(id, { archived: true });
  if (!archived) return { ok: false, error: "归档失败" };
  broadcast(IPC.squadChanged, archived);
  return { ok: true, transferred };
});

// ── Project IPC ──
ipcMain.handle(IPC.projectList, () => projectStore.listProjects());
ipcMain.handle(IPC.projectGet, (_e, id: string) =>
  projectStore.getProject(id) ?? null
);
ipcMain.handle(IPC.projectCreate, (_e, input: ProjectCreateInput) => {
  try {
    const project = projectStore.createProject(input);
    broadcast(IPC.projectChanged, project);
    return { ok: true, project };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});
ipcMain.handle(
  IPC.projectUpdate,
  (_e, { id, patch }: { id: string; patch: Partial<Project> }) => {
    try {
      const project = projectStore.updateProject(id, patch);
      if (!project) return { ok: false, error: "项目不存在" };
      broadcast(IPC.projectChanged, project);
      return { ok: true, project };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
);
ipcMain.handle(IPC.projectDelete, (_e, id: string) => {
  if (!projectStore.getProject(id)) {
    return { ok: false, error: "项目不存在" };
  }
  // Multica：删项目只 unlink Issue，不删 Issue
  for (const issue of issueStore.listIssues()) {
    if (issue.projectId === id) {
      const updated = issueStore.updateIssue(issue.id, {
        projectId: undefined,
      });
      if (updated) broadcast(IPC.issueChanged, updated);
    }
  }
  const ok = projectStore.deleteProject(id);
  if (ok) broadcast(IPC.projectChanged, { id, deleted: true });
  return { ok };
});

// ── Autopilot IPC ──
ipcMain.handle(IPC.autopilotList, () => autopilotStore.listAutopilots());
ipcMain.handle(IPC.autopilotCreate, (_e, input: AutopilotCreateInput) => {
  try {
    const ap = autopilotStore.createAutopilot(input);
    autopilotManager.onAutopilotChanged(ap);
    return { ok: true, autopilot: ap };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});
ipcMain.handle(
  IPC.autopilotUpdate,
  (_e, { id, patch }: { id: string; patch: Partial<Autopilot> }) => {
    const ap = autopilotStore.updateAutopilot(id, patch);
    if (!ap) return { ok: false, error: "Autopilot 不存在" };
    autopilotManager.onAutopilotChanged(ap);
    return { ok: true, autopilot: ap };
  }
);
ipcMain.handle(IPC.autopilotDelete, (_e, id: string) => {
  const ok = autopilotStore.deleteAutopilot(id);
  if (ok) autopilotManager.onAutopilotDeleted(id);
  return { ok };
});
ipcMain.handle(IPC.autopilotRunNow, async (_e, id: string) => {
  return autopilotManager.fireAutopilot(id, true);
});
ipcMain.handle(IPC.autopilotRuns, (_e, id?: string) =>
  autopilotStore.listRuns(id)
);

// ── Inbox IPC ──
ipcMain.handle(IPC.inboxList, () => inboxStore.listInbox());
ipcMain.handle(IPC.inboxMarkRead, (_e, id: string) => {
  const item = inboxStore.markRead(id);
  if (item) broadcast(IPC.inboxChanged, item);
  return { ok: !!item };
});
ipcMain.handle(IPC.inboxMarkAllRead, () => {
  inboxStore.markAllRead();
  return { ok: true };
});
ipcMain.handle(IPC.inboxClear, () => {
  inboxStore.clearInbox();
  return { ok: true };
});

// ── Skill zip 导入 ──
ipcMain.handle(IPC.pluginImportSkillZip, async () => {
  const win =
    BrowserWindow.getFocusedWindow() ??
    mainWindow ??
    BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: "无窗口" };
  const r = await dialog.showOpenDialog(win, {
    title: "导入 Skill Zip",
    filters: [{ name: "Zip", extensions: ["zip"] }],
    properties: ["openFile", "dontAddToRecent"],
  });
  if (r.canceled || r.filePaths.length === 0) {
    return { ok: false, error: "已取消" };
  }
  try {
    const { name } = pluginManager.importSkillZip(r.filePaths[0]);
    broadcastPlugin({ type: "skills", name, action: "created" });
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ── App 生命周期 ──
app.whenReady().then(() => {
  sessionManager.loadPersisted();
  startHubAgentBridge(broadcast);
  try {
    ensurePiHubHelper();
  } catch (e) {
    console.error("[main] ensurePiHubHelper failed:", e);
  }
  createWindow();
  startTaskMonitor({
    getSessions: () => sessionManager.list(),
  });
  autopilotManager.initAutopilotManager(broadcast);
});

app.on("will-quit", () => {
  stopTaskMonitor();
  stopHubAgentBridge();
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
