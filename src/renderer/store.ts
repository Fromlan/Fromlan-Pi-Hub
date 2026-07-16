import { create } from "zustand";
import type { SessionSnapshot, PiEvent, MsgData, ToolCallData } from "../shared/types";

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
  sessions: SessionSnapshot[];
  activeId: string | null;
  messagesBySession: Record<string, Msg[]>;
  draftBySession: Record<string, string>;
  persistedSessions: SessionSnapshot[];

  setActive: (id: string | null) => void;
  upsertSession: (snap: SessionSnapshot) => void;
  removeSession: (id: string) => void;
  setSessions: (list: SessionSnapshot[]) => void;
  setDraft: (id: string, text: string) => void;

  addUserMessage: (sessionId: string, text: string) => string;
  removeMessage: (sessionId: string, msgId: string) => void;
  markMessageConfirmed: (sessionId: string, msgId: string) => void;
  applyEvent: (sessionId: string, event: PiEvent) => void;

  setPersistedSessions: (list: SessionSnapshot[]) => void;
  importMessages: (sessionId: string, msgs: MsgData[]) => void;
  resolvePersistedSession: (id: string) => void;
}

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

/** 取某会话消息数组的最后一条 assistant 流式消息。 */
function lastStreamingAssistant(msgs: Msg[]): Msg | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") return msgs[i];
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
          result: tc.result,
          isError: tc.isError,
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
  sessions: [],
  activeId: null,
  messagesBySession: {},
  draftBySession: {},
  persistedSessions: [],

  setActive: (id) => set({ activeId: id }),

  setSessions: (list) =>
    set((s) => ({
      sessions: list,
      activeId: s.activeId ?? (list[0]?.id ?? null),
    })),

  upsertSession: (snap) =>
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === snap.id);
      const sessions =
        idx === -1
          ? [...s.sessions, snap]
          : s.sessions.map((x) => (x.id === snap.id ? snap : x));
      const hasMsgs = snap.id in s.messagesBySession;
      return {
        sessions,
        activeId: s.activeId ?? snap.id,
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
      let activeId = s.activeId;
      if (activeId === id) activeId = sessions[0]?.id ?? null;
      return {
        sessions,
        activeId,
        messagesBySession: restMsgs,
        draftBySession: restDraft,
      };
    }),

  setDraft: (id, text) =>
    set((s) => ({ draftBySession: { ...s.draftBySession, [id]: text } })),

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
        messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
      }));

    switch (event.type) {
      case "message_start": {
        const msg = event.message as
          | { role?: string; content?: unknown }
          | undefined;
        if (msg?.role === "assistant") {
          // 用 message.content 初始化（若已是 partial 数组）。
          // 若不是（罕见），从空起步，留给后续 message_update 重建。
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
          // 服务端回声 user 消息：确认乐观插入的那条
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "user" && msgs[i].pending) {
              msgs[i] = { ...msgs[i], pending: false };
              commit();
              break;
            }
          }
        } else if (msg?.role === "bashExecution") {
          // 几乎不会通过 message_start 收到（bash 由 RPC 命令触发，不发 event）
        } else if (msg?.role === "toolResult") {
          // 单独 toolResult message（pi 可能直接发 message_start，也可能在 turn_end 里给完整集合）
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
        // 始终以 partial.content 为真相来源。
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
          // 保留已附加的 result 字段——这些信息来自 tool_execution_end 等其他事件。
          const previousCalls = target.toolCalls ?? [];
          const mergedCalls = derived.toolCalls.map((c) => {
            const prev = previousCalls.find((p) => p.id === c.id);
            return prev ? { ...c, ...prev, running: prev.running } : c;
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
        // 校正（partial 仍为真相；只在 role 缺失时给默认值）。
        const msg = event.message as { role?: string } | undefined;
        if (msg?.role === "assistant") {
          const target = lastStreamingAssistant(msgs);
          if (target) {
            const idx = msgs.lastIndexOf(target);
            msgs[idx] = { ...target, streaming: false };
            commit();
          }
        } else if (msg?.role === "toolResult") {
          // 已存在的 toolResult 消息：补填文本
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
        // 若已存在则标 running=true（幂等）
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
          // 没找到归属的 assistant 消息：建一个孤立的 toolResult 气泡
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
        // 状态机副作用在 SessionManager 中处理；这里无需操作消息流。
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
    })),
}));
