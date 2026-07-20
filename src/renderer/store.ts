import { create } from "zustand";
import type {
  SessionSnapshot,
  PiEvent,
  MsgData,
  ToolCallData,
  PluginType,
  PluginItemMeta,
  AgentMeta,
  PanelKind,
  Issue,
  IssueStatus,
  Comment,
  Task,
  AppSettings,
  Squad,
  Project,
} from "../shared/types";
export { STATUS_LABEL } from "../shared/labels";

const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultProvider: "",
  defaultModel: "",
  defaultCwd: "",
  dispatchTimeoutMs: 5 * 60 * 1000,
  runningTimeoutMs: 2.5 * 60 * 60 * 1000,
  maxRetries: 2,
  notifyMode: "background",
  skillExtractMode: "propose",
  onboardedAt: undefined,
};

/** pi content 数组中段项（宽松结构：text / thinking / toolCall）。 */
export interface ContentPart {
  type: "text" | "thinking" | "toolCall";
  /** text */
  text?: string;
  /** thinking */
  thinking?: string;
  /** toolCall */
  id?: string;
  name?: string;
  arguments?: unknown;
}

/** 工具调用在 UI 上的视图模型。 */
export interface ToolCallView {
  id: string;
  name: string;
  args?: unknown;
  result?: string;
  /** 流式到达中的工具输出（已累积的最终文本，与 result 同步）。 */
  streamingOutput?: string;
  isError?: boolean;
  /** 截断标记（来自 details.truncation）。 */
  truncated?: boolean;
  fullOutputPath?: string;
  running: boolean;
}

export interface Msg {
  id: string;
  role: "user" | "assistant" | "tool" | "bashExecution" | "toolResult";
  /** 主要文本（text 段或 user 单字符串）。 */
  text: string;
  /** thinking 段拼接（仅 assistant）。 */
  thinking?: string;
  /** 工具调用列表（仅 assistant）。 */
  toolCalls?: ToolCallView[];
  /** pi content 段（assistant 真实结构），用于按顺序渲染。 */
  content?: ContentPart[];
  streaming?: boolean;
  /** true 表示该消息仅在 UI 乐观插入、尚未经服务端确认；失败时由 Composer 回滚。 */
  pending?: boolean;
  /** bash 命令原文（仅 bashExecution 角色）。 */
  command?: string;
  /** bash 退出码（仅 bashExecution 角色）。 */
  exitCode?: number;
  /** toolResult 关联的工具调用 id。 */
  toolCallId?: string;
  toolName?: string;
}

interface StoreState {
  // ── 路由（新模型）──
  activePanel: PanelKind;
  activeSessionId: string | null;
  activePersistedId: string | null;
  // activeId 保留作为兼容旧组件的薄壳 getter；setActive 内部路由到新字段。

  // ── 会话数据 ──
  sessions: SessionSnapshot[];
  /** @deprecated 由 activeSessionId 取代；保留以兼容旧代码读取。 */
  activeId: string | null;
  messagesBySession: Record<string, Msg[]>;
  draftBySession: Record<string, string>;
  persistedSessions: SessionSnapshot[];

  // ── UI 偏好 ──
  theme: "dark" | "light";
  sidebarSearch: string;
  showStoppedGroup: boolean;

  // ── 插件/Agent 缓存 ──
  plugins: Record<PluginType, PluginItemMeta[]>;
  /** 顶部提示信息（保存后提示 /reload）。 */
  lastNotice: string | null;
  agents: AgentMeta[];

  // ── Actions: 路由 ──
  setPanel: (panel: PanelKind) => void;
  setSession: (id: string | null) => void;
  setPersistedSession: (id: string | null) => void;
  /** @deprecated 兼容旧调用点：根据 id 类型路由到 setPanel / setSession / setPersistedSession。 */
  setActive: (id: string | null) => void;

  // ── Actions: 会话 ──
  upsertSession: (snap: SessionSnapshot) => void;
  removeSession: (id: string) => void;
  setSessions: (list: SessionSnapshot[]) => void;
  setDraft: (id: string, text: string) => void;
  /** 关闭会话：保存消息 → 触发主进程 kill → 1800ms 后从 sessions 移除（防止状态翻转）。 */
  closeSession: (id: string) => Promise<void>;
  /** 删除已停止会话历史。 */
  deletePersisted: (id: string) => Promise<void>;

  // ── Actions: 消息 ──
  addUserMessage: (sessionId: string, text: string) => string;
  removeMessage: (sessionId: string, msgId: string) => void;
  markMessageConfirmed: (sessionId: string, msgId: string) => void;
  applyEvent: (sessionId: string, event: PiEvent) => void;

  // ── Actions: 持久化 ──
  setPersistedSessions: (list: SessionSnapshot[]) => void;
  importMessages: (sessionId: string, msgs: MsgData[]) => void;
  resolvePersistedSession: (id: string) => void;

  // ── Actions: 插件 ──
  setPlugins: (type: PluginType, list: PluginItemMeta[]) => void;
  upsertPlugin: (type: PluginType, meta: PluginItemMeta) => void;
  removePlugin: (type: PluginType, name: string) => void;
  setNotice: (text: string | null) => void;

  // ── Actions: Agent ──
  setAgents: (list: AgentMeta[]) => void;
  upsertAgent: (meta: AgentMeta) => void;
  removeAgent: (name: string) => void;

  // ── Actions: 偏好 ──
  toggleTheme: () => void;
  setSidebarSearch: (q: string) => void;
  toggleStoppedGroup: () => void;

  // ── Issues / 视图切换（阶段 1） ──
  viewMode: "kanban" | "list" | "session";
  setViewMode: (mode: "kanban" | "list" | "session") => void;

  issues: Issue[];
  activeIssueId: string | null;
  commentsByIssue: Record<string, Comment[]>;
  /** Multica 派活 Task 列表（内存镜像）。 */
  tasks: Task[];
  appSettings: AppSettings;

  setIssues: (list: Issue[]) => void;
  upsertIssue: (i: Issue) => void;
  removeIssue: (id: string) => void;
  setActiveIssue: (id: string | null) => void;
  setCommentsForIssue: (issueId: string, list: Comment[]) => void;
  appendComment: (c: Comment) => void;
  removeCommentById: (commentId: string) => void;
  setTasks: (list: Task[]) => void;
  upsertTask: (t: Task) => void;
  setAppSettings: (s: AppSettings) => void;

  squads: Squad[];
  setSquads: (list: Squad[]) => void;
  upsertSquad: (s: Squad) => void;
  removeSquad: (id: string) => void;

  projects: Project[];
  /** 看板项目过滤；null = 全部。 */
  projectFilterId: string | null;
  setProjects: (list: Project[]) => void;
  upsertProject: (p: Project) => void;
  removeProject: (id: string) => void;
  setProjectFilterId: (id: string | null) => void;
}

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

/** 单会话内存上限。超长会话累积大量 tool call + 流式文本会吃内存。
 *  保留首条（多为 system 上下文）+ 滚动窗口尾部 MAX_MESSAGES 条。 */
const MAX_MESSAGES = 500;

/** 取某会话消息数组的最后一条仍在流式中的 assistant（忽略已完成的轮次）。 */
function lastStreamingAssistant(msgs: Msg[]): Msg | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && m.streaming === true) return m;
  }
  return undefined;
}

/** 从消息数组中导出可持久化的 MsgData（过滤瞬态字段）。 */
export function exportMessages(msgs: Msg[]): MsgData[] {
  return msgs
    .filter((m) => !m.streaming && !m.pending)
    .map((m) => {
      const base: MsgData = {
        id: m.id,
        role: m.role === "bashExecution" || m.role === "toolResult" ? "tool" : m.role,
        text: m.text,
      };
      const out: MsgData = { ...base };
      if (m.thinking) out.thinking = m.thinking;
      if (m.toolCalls && m.toolCalls.length > 0) {
        out.toolCalls = m.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
          // 仍在跑的 tool 不落盘 result，避免冻结半截输出
          result: tc.running ? undefined : tc.result,
          isError: tc.running ? undefined : tc.isError,
        }));
      }
      return out;
    });
}

/** 将 msgSeq 推进到超过所有已有消息 ID 的数值，避免重复 key。 */
function bumpSeqForIds(...idSets: string[][]): void {
  let max = msgSeq;
  for (const ids of idSets) {
    for (const id of ids) {
      const n = parseInt(id.replace(/^\D+/, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  msgSeq = max;
}

// ── assistant message 映射帮手 ────────────────────────────────────────────

/** 从 partial.content 重建 text / thinking 派生字段。 */
function deriveAssistantFields(content: ContentPart[]): {
  text: string;
  thinking: string;
  toolCalls: ToolCallView[];
} {
  let text = "";
  let thinking = "";
  const toolCalls: ToolCallView[] = [];
  for (const part of content) {
    if (part.type === "text") {
      text += part.text ?? "";
    } else if (part.type === "thinking") {
      thinking += part.thinking ?? "";
    } else if (part.type === "toolCall") {
      toolCalls.push({
        id: String(part.id ?? ""),
        name: String(part.name ?? "tool"),
        args: part.arguments,
        running: true,
      });
    }
  }
  return { text, thinking, toolCalls };
}

/** 寻找消息中具有指定 toolCall id 的位置：返回 [msgIdx, toolIdx]。 */
function locateToolCall(
  msgs: Msg[],
  toolCallId: string
): { msgIdx: number; toolIdx: number } | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant" || !m.toolCalls) continue;
    const j = m.toolCalls.findIndex((c) => c.id === toolCallId);
    if (j !== -1) return { msgIdx: i, toolIdx: j };
  }
  return null;
}

/** 把 tool result.content 数组中的 text 段拼成纯文本输出。 */
function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text?: string } =>
      !!c && typeof c === "object" && (c as { type?: string }).type === "text"
    )
    .map((c) => c.text ?? "")
    .join("");
}

export const useStore = create<StoreState>((set, get) => ({
  // ── 路由 ──
  activePanel: "chat",
  activeSessionId: null,
  activePersistedId: null,
  activeId: null,

  // ── 会话数据 ──
  sessions: [],
  messagesBySession: {},
  draftBySession: {},
  persistedSessions: [],

  // ── UI 偏好 ──
  theme: "dark",
  sidebarSearch: "",
  showStoppedGroup: true,

  // ── 缓存 ──
  plugins: { prompts: [], skills: [], extensions: [] },
  lastNotice: null,
  agents: [],

  // ── 路由 actions ──
  setPanel: (panel) =>
    set({
      activePanel: panel,
      activeId: panel === "chat" ? (get().activeSessionId ?? get().activePersistedId) : `__${panel}__`,
    }),

  setSession: (id) =>
    set({
      activeSessionId: id,
      activePanel: "chat",
      activePersistedId: null,
      activeId: id,
      ...(id != null ? { viewMode: "session" as const } : {}),
    }),

  setPersistedSession: (id) =>
    set({
      activePersistedId: id,
      activePanel: "chat",
      activeSessionId: null,
      activeId: id,
      ...(id != null ? { viewMode: "session" as const } : {}),
    }),

  setActive: (id) => {
    if (id == null) {
      set({ activeSessionId: null, activePersistedId: null, activeId: null });
      return;
    }
    if (id === "__plugins__") {
      get().setPanel("plugins");
      return;
    }
    if (id === "__agents__") {
      get().setPanel("agents");
      return;
    }
    if (id === "__settings__") {
      get().setPanel("settings");
      return;
    }
    // 真实 id：判断是运行中还是历史
    const state = get();
    if (state.sessions.some((s) => s.id === id)) {
      get().setSession(id);
    } else if (state.persistedSessions.some((p) => p.id === id)) {
      get().setPersistedSession(id);
    } else {
      set({ activeId: id });
    }
  },

  // ── 会话 actions ──
  setSessions: (list) =>
    set((s) => {
      const nextActiveSessionId = s.activeSessionId ?? list[0]?.id ?? null;
      return {
        sessions: list,
        activeSessionId: nextActiveSessionId,
        activeId: s.activePanel === "chat" ? nextActiveSessionId : s.activeId,
      };
    }),

  upsertSession: (snap) =>
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === snap.id);
      const sessions =
        idx === -1
          ? [...s.sessions, snap]
          : s.sessions.map((x) => (x.id === snap.id ? snap : x));
      const hasMsgs = snap.id in s.messagesBySession;
      const isNewSession = idx === -1;
      return {
        sessions,
        activeSessionId: s.activeSessionId ?? (isNewSession ? snap.id : s.activeSessionId),
        activeId: s.activePanel === "chat" && isNewSession ? snap.id : s.activeId,
        messagesBySession: hasMsgs
          ? s.messagesBySession
          : { ...s.messagesBySession, [snap.id]: [] },
      };
    }),

  removeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      const { [id]: _drop, ...restMsgs } = s.messagesBySession;
      const { [id]: _d2, ...restDraft } = s.draftBySession;
      const nextActive = s.activeSessionId === id ? sessions[0]?.id ?? null : s.activeSessionId;
      return {
        sessions,
        activeSessionId: nextActive,
        activeId: s.activePanel === "chat" ? nextActive : s.activeId,
        messagesBySession: restMsgs,
        draftBySession: restDraft,
      };
    }),

  setDraft: (id, text) =>
    set((s) => ({ draftBySession: { ...s.draftBySession, [id]: text } })),

  closeSession: async (id) => {
    // 保存消息
    const msgs = get().messagesBySession[id];
    if (msgs && msgs.length > 0) {
      const data = exportMessages(msgs);
      if (data.length > 0) {
        await window.sessionAPI.saveMessages(id, data);
      }
    }
    // 触发主进程 kill（kill 时主进程会把会话移到 persistedSessions）
    await window.sessionAPI.kill(id);
    // 1800ms 后清理 sessions 中的条目（防止 IPC 事件尚未翻转）
    setTimeout(() => {
      const stillThere = useStore.getState().sessions.find((x) => x.id === id);
      if (stillThere) useStore.getState().removeSession(id);
      // 同步刷新历史
      window.sessionAPI.historyList().then((list) =>
        useStore.getState().setPersistedSessions(list)
      );
    }, 1800);
  },

  deletePersisted: async (id) => {
    const state = get();
    await window.sessionAPI.historyDelete(id);
    // 同步清理内存中的消息与草稿，避免删除历史后消息残留（loadPersisted 已经把
    // 历史消息在 App.tsx 的 useEffect 里 importMessages 进了 messagesBySession）。
    const { [id]: _drop, ...restMsgs } = state.messagesBySession;
    const { [id]: _d2, ...restDraft } = state.draftBySession;
    set({
      persistedSessions: state.persistedSessions.filter((p) => p.id !== id),
      activePersistedId: state.activePersistedId === id ? null : state.activePersistedId,
      activeId: state.activePersistedId === id ? null : state.activeId,
      messagesBySession: restMsgs,
      draftBySession: restDraft,
    });
  },

  // ── 消息 actions ──
  addUserMessage: (sessionId, text) => {
    const id = nextId();
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? [];
      const userMsg: Msg = { id, role: "user", text, pending: true };
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...list, userMsg],
        },
      };
    });
    return id;
  },

  removeMessage: (sessionId, msgId) =>
    set((s) => {
      const list = s.messagesBySession[sessionId];
      if (!list) return {};
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: list.filter((m) => m.id !== msgId),
        },
      };
    }),

  markMessageConfirmed: (sessionId, msgId) =>
    set((s) => {
      const list = s.messagesBySession[sessionId];
      if (!list) return {};
      const idx = list.findIndex((m) => m.id === msgId);
      if (idx === -1 || !list[idx].pending) return {};
      const next = list.slice();
      next[idx] = { ...next[idx], pending: false };
      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: next },
      };
    }),

  applyEvent: (sessionId, event) => {
    const state = get();
    const list = state.messagesBySession[sessionId] ?? [];
    const msgs = list.slice();

    const commit = () =>
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          // 超长会话滚动窗口：保留首条 + 尾部 MAX_MESSAGES 条。
          // 首条通常是 system/初始上下文，后面切掉的部分不是用户当前关注的。
          [sessionId]:
            msgs.length > MAX_MESSAGES
              ? [msgs[0], ...msgs.slice(msgs.length - MAX_MESSAGES + 1)]
              : msgs,
        },
      }));

    switch (event.type) {
      case "message_start": {
        const msg = event.message as
          | { role?: string; content?: unknown }
          | undefined;
        if (msg?.role === "assistant") {
          const content: ContentPart[] = Array.isArray(msg.content)
            ? (msg.content as ContentPart[])
            : [];
          const derived = deriveAssistantFields(content);
          msgs.push({
            id: nextId(),
            role: "assistant",
            text: derived.text,
            thinking: derived.thinking || undefined,
            toolCalls: derived.toolCalls,
            content,
            streaming: true,
          });
          commit();
        } else if (msg?.role === "user") {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "user" && msgs[i].pending) {
              msgs[i] = { ...msgs[i], pending: false };
              commit();
              break;
            }
          }
        } else if (msg?.role === "toolResult") {
          const tr = msg as {
            toolCallId?: string;
            toolName?: string;
            content?: unknown;
            isError?: boolean;
          };
          msgs.push({
            id: nextId(),
            role: "toolResult",
            text: extractTextContent(tr.content),
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
          });
          commit();
        }
        break;
      }

      case "message_update": {
        const payload = event.message as
          | { role?: string; content?: unknown }
          | undefined;
        let target = lastStreamingAssistant(msgs);
        if (!target) {
          target = {
            id: nextId(),
            role: "assistant",
            text: "",
            content: [],
            streaming: true,
          };
          msgs.push(target);
        }
        if (payload?.role === "assistant" && Array.isArray(payload.content)) {
          const content = payload.content as ContentPart[];
          const derived = deriveAssistantFields(content);
          const targetIdx = msgs.lastIndexOf(target);
          const previousCalls = target.toolCalls ?? [];
          // 保留 prev 的 streamingOutput/result/running；新 streamed 的 name/args 优先生效
          const mergedCalls = derived.toolCalls.map((c) => {
            const prev = previousCalls.find((p) => p.id === c.id);
            if (!prev) return c;
            return {
              ...prev,
              ...c,
              streamingOutput: prev.streamingOutput,
              result: prev.result ?? c.result,
              running: prev.running,
            };
          });
          msgs[targetIdx] = {
            ...target,
            content,
            text: derived.text,
            thinking: derived.thinking || undefined,
            toolCalls: mergedCalls,
            streaming: true,
          };
          commit();
        }
        break;
      }

      case "message_end": {
        const msg = event.message as { role?: string } | undefined;
        if (msg?.role === "assistant") {
          const target = lastStreamingAssistant(msgs);
          if (target) {
            const idx = msgs.lastIndexOf(target);
            msgs[idx] = { ...target, streaming: false };
            commit();
          }
        } else if (msg?.role === "toolResult") {
          const tr = msg as {
            toolCallId?: string;
            toolName?: string;
            content?: unknown;
            isError?: boolean;
          };
          const idx = msgs.findIndex(
            (m) =>
              m.role === "toolResult" &&
              m.toolCallId === tr.toolCallId
          );
          const text = extractTextContent(tr.content);
          if (idx >= 0) {
            msgs[idx] = { ...msgs[idx], text, toolName: tr.toolName };
          } else {
            msgs.push({
              id: nextId(),
              role: "toolResult",
              text,
              toolCallId: tr.toolCallId,
              toolName: tr.toolName,
            });
          }
          commit();
        } else if (msg?.role === "bashExecution") {
          const be = msg as {
            command?: string;
            output?: string;
            exitCode?: number;
            cancelled?: boolean;
            truncated?: boolean;
            fullOutputPath?: string;
          };
          msgs.push({
            id: nextId(),
            role: "bashExecution",
            text: be.output ?? "",
            command: be.command,
            exitCode: be.exitCode,
          });
          commit();
        }
        break;
      }

      case "tool_execution_start": {
        const id = String(event.toolCallId ?? "");
        if (!id) break;
        const loc = locateToolCall(msgs, id);
        if (loc) {
          const { msgIdx, toolIdx } = loc;
          const calls = msgs[msgIdx].toolCalls!.slice();
          calls[toolIdx] = { ...calls[toolIdx], running: true };
          msgs[msgIdx] = { ...msgs[msgIdx], toolCalls: calls };
          commit();
        }
        break;
      }

      case "tool_execution_update": {
        const id = String(event.toolCallId ?? "");
        if (!id) break;
        const partialResult = event.partialResult as
          | {
              content?: unknown;
              details?: {
                truncation?: { truncated?: boolean } | null;
                fullOutputPath?: string | null;
              };
            }
          | undefined;
        const text = extractTextContent(partialResult?.content);
        const truncation = partialResult?.details?.truncation;
        const truncated = Boolean(truncation && truncation.truncated);
        const fullOutputPath =
          partialResult?.details?.fullOutputPath ?? undefined;
        const loc = locateToolCall(msgs, id);
        if (loc) {
          const { msgIdx, toolIdx } = loc;
          const calls = msgs[msgIdx].toolCalls!.slice();
          calls[toolIdx] = {
            ...calls[toolIdx],
            streamingOutput: text,
            truncated,
            fullOutputPath,
            running: true,
          };
          msgs[msgIdx] = { ...msgs[msgIdx], toolCalls: calls };
          commit();
        }
        break;
      }

      case "tool_execution_end": {
        const id = String(event.toolCallId ?? "");
        if (!id) break;
        const result = event.result as
          | {
              content?: unknown;
              details?: {
                truncation?: { truncated?: boolean } | null;
                fullOutputPath?: string | null;
              };
            }
          | undefined;
        const text = extractTextContent(result?.content);
        const truncation = result?.details?.truncation;
        const truncated = Boolean(truncation && truncation.truncated);
        const fullOutputPath = result?.details?.fullOutputPath ?? undefined;
        const loc = locateToolCall(msgs, id);
        if (loc) {
          const { msgIdx, toolIdx } = loc;
          const calls = msgs[msgIdx].toolCalls!.slice();
          calls[toolIdx] = {
            ...calls[toolIdx],
            result: text,
            streamingOutput: undefined,
            truncated,
            fullOutputPath,
            isError: Boolean(event.isError),
            running: false,
          };
          msgs[msgIdx] = { ...msgs[msgIdx], toolCalls: calls };
          commit();
        } else {
          msgs.push({
            id: nextId(),
            role: "toolResult",
            text,
            toolCallId: id,
            toolName: String(event.toolName ?? "tool"),
          });
          commit();
        }
        break;
      }

      case "auto_retry_start":
      case "auto_retry_end":
      case "compaction_end":
      case "queue_update":
      case "agent_start":
      case "agent_end":
      case "agent_settled":
      case "turn_start":
      case "turn_end":
      case "extension_error":
        break;
    }
  },

  setPersistedSessions: (list) => set({ persistedSessions: list }),

  importMessages: (sessionId, msgs) =>
    set((s) => {
      const existing = s.messagesBySession[sessionId] ?? [];
      const existingIds = new Set(existing.map((m) => m.id));
      const fresh = msgs.filter((m) => !existingIds.has(m.id));
      if (fresh.length === 0) return {};
      bumpSeqForIds(existing.map((m) => m.id), msgs.map((m) => m.id));
      const imported: Msg[] = fresh.map((m) => ({
        ...m,
        toolCalls: m.toolCalls?.map((tc) => ({ ...tc, running: false })),
      }));
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...imported, ...existing],
        },
      };
    }),

  resolvePersistedSession: (id) =>
    set((s) => ({
      persistedSessions: s.persistedSessions.filter((p) => p.id !== id),
      activePersistedId: s.activePersistedId === id ? null : s.activePersistedId,
    })),

  setPlugins: (type, list) =>
    set((s) => ({ plugins: { ...s.plugins, [type]: list } })),

  upsertPlugin: (type, meta) =>
    set((s) => {
      const list = s.plugins[type].slice();
      const idx = list.findIndex((x) => x.name === meta.name);
      if (idx >= 0) list[idx] = meta;
      else {
        list.push(meta);
        list.sort((a, b) => a.name.localeCompare(b.name));
      }
      return { plugins: { ...s.plugins, [type]: list } };
    }),

  removePlugin: (type, name) =>
    set((s) => ({
      plugins: {
        ...s.plugins,
        [type]: s.plugins[type].filter((x) => x.name !== name),
      },
    })),

  setNotice: (text) => set({ lastNotice: text }),

  setAgents: (list) =>
    set((s) => ({
      agents: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
    })),

  upsertAgent: (meta) =>
    set((s) => {
      const idx = s.agents.findIndex((x) => x.name === meta.name);
      const list =
        idx === -1
          ? [...s.agents, meta]
          : s.agents.map((x) => (x.name === meta.name ? meta : x));
      list.sort((a, b) => a.name.localeCompare(b.name));
      return { agents: list };
    }),

  removeAgent: (name) =>
    set((s) => ({ agents: s.agents.filter((x) => x.name !== name) })),

  // ── 偏好 actions ──
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    set({ theme: next });
  },

  setSidebarSearch: (q) => set({ sidebarSearch: q }),

  toggleStoppedGroup: () => set((s) => ({ showStoppedGroup: !s.showStoppedGroup })),

  // ── Issues / 视图切换（阶段 1） ──
  viewMode: "kanban",
  setViewMode: (mode) =>
    set({
      viewMode: mode,
      activePanel: "chat",
      activeId:
        mode === "session"
          ? (get().activeSessionId ?? get().activePersistedId)
          : `__kanban__`,
    }),

  issues: [],
  activeIssueId: null,
  commentsByIssue: {},
  tasks: [],
  appSettings: { ...DEFAULT_APP_SETTINGS },

  setIssues: (list) =>
    set((s) => {
      const nextActive = s.activeIssueId ?? list[0]?.id ?? null;
      return { issues: list, activeIssueId: nextActive };
    }),

  upsertIssue: (i) =>
    set((s) => {
      const idx = s.issues.findIndex((x) => x.id === i.id);
      const issues =
        idx === -1
          ? [...s.issues, i]
          : s.issues.map((x) => (x.id === i.id ? i : x));
      const isNew = idx === -1;
      return {
        issues,
        activeIssueId: s.activeIssueId ?? (isNew ? i.id : s.activeIssueId),
      };
    }),

  removeIssue: (id) =>
    set((s) => {
      const { [id]: _drop, ...restComments } = s.commentsByIssue;
      const issues = s.issues.filter((x) => x.id !== id);
      return {
        issues,
        activeIssueId: s.activeIssueId === id ? issues[0]?.id ?? null : s.activeIssueId,
        commentsByIssue: restComments,
      };
    }),

  setActiveIssue: (id) =>
    set((s) => ({
      activeIssueId: id,
      // null = 返回看板；非 null = 打开详情
      viewMode: id == null ? "kanban" : "list",
      activePanel: "chat",
      activeId: id == null ? `__kanban__` : `__issue__`,
    })),

  setCommentsForIssue: (issueId, list) =>
    set((s) => ({
      commentsByIssue: { ...s.commentsByIssue, [issueId]: list },
    })),

  appendComment: (c) =>
    set((s) => {
      const prev = s.commentsByIssue[c.issueId] ?? [];
      const idx = prev.findIndex((x) => x.id === c.id);
      const next =
        idx === -1
          ? [...prev, c]
          : prev.map((x) => (x.id === c.id ? c : x));
      return { commentsByIssue: { ...s.commentsByIssue, [c.issueId]: next } };
    }),

  removeCommentById: (commentId) =>
    set((s) => {
      const next: Record<string, Comment[]> = {};
      for (const [k, arr] of Object.entries(s.commentsByIssue)) {
        next[k] = arr.filter((c) => c.id !== commentId);
      }
      return { commentsByIssue: next };
    }),

  setTasks: (list) => set({ tasks: list }),

  upsertTask: (t) =>
    set((s) => {
      const idx = s.tasks.findIndex((x) => x.id === t.id);
      const tasks =
        idx === -1
          ? [...s.tasks, t]
          : s.tasks.map((x) => (x.id === t.id ? t : x));
      return { tasks };
    }),

  setAppSettings: (appSettings) => set({ appSettings }),

  squads: [],
  setSquads: (list) => set({ squads: list }),
  upsertSquad: (sq) =>
    set((s) => {
      if (sq.archived) {
        return { squads: s.squads.filter((x) => x.id !== sq.id) };
      }
      const idx = s.squads.findIndex((x) => x.id === sq.id);
      const squads =
        idx === -1
          ? [...s.squads, sq]
          : s.squads.map((x) => (x.id === sq.id ? sq : x));
      return { squads };
    }),
  removeSquad: (id) =>
    set((s) => ({ squads: s.squads.filter((x) => x.id !== id) })),

  projects: [],
  projectFilterId: null,
  setProjects: (list) => set({ projects: list }),
  upsertProject: (p) =>
    set((s) => {
      const idx = s.projects.findIndex((x) => x.id === p.id);
      const projects =
        idx === -1
          ? [...s.projects, p]
          : s.projects.map((x) => (x.id === p.id ? p : x));
      return { projects };
    }),
  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((x) => x.id !== id),
      projectFilterId: s.projectFilterId === id ? null : s.projectFilterId,
    })),
  setProjectFilterId: (id) => set({ projectFilterId: id }),
}));

// ── 派生 getters（阶段 1） ────────────────────────────────────────

/**
 * Dev-only：把 zustand store 挂到 window，方便验收测试时注入 mock data。
 * 生产构建由 electron-vite tree-shake 移除（if (import.meta.env.DEV) 分支）。
 */
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { useStoreDevtools: typeof useStore }).useStoreDevtools =
    useStore;
}

/** 状态枚举的固定展示顺序，对应看板 7 列。 */
export const ISSUE_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

/** 某 issue 是否有 active task（queued/dispatched/running）。 */
export function issueHasActiveTask(tasks: Task[], issueId: string): boolean {
  return tasks.some(
    (t) =>
      t.issueId === issueId &&
      (t.status === "queued" ||
        t.status === "dispatched" ||
        t.status === "running")
  );
}

/** 按 status 分组（每组内按 updatedAt 倒序）。 */
export function groupByStatus(
  issues: Issue[]
): Record<IssueStatus, Issue[]> {
  const map = Object.fromEntries(
    ISSUE_STATUSES.map((s) => [s, [] as Issue[]])
  ) as Record<IssueStatus, Issue[]>;
  for (const i of issues) (map[i.status] ??= []).push(i);
  for (const s of ISSUE_STATUSES) {
    map[s].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return map;
}

export function issueByKey(issues: Issue[], key: string): Issue | undefined {
  return issues.find((i) => i.key === key);
}

export function issuesAssignedToAgent(
  issues: Issue[],
  agentName: string
): Issue[] {
  return issues.filter(
    (i) => i.assignee.kind === "agent" && i.assignee.id === agentName
  );
}

export function dueIssues(issues: Issue[], now = Date.now()): Issue[] {
  return issues.filter((i) => i.dueDate !== undefined && i.dueDate < now);
}