import { create } from "zustand";
import type { SessionSnapshot, PiEvent } from "../shared/types";

export interface ToolCallView {
  id: string;
  name: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  running: boolean;
}

export interface Msg {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  thinking?: string;
  toolCalls?: ToolCallView[];
  streaming?: boolean;
  /** true 表示该消息仅在 UI 乐观插入、尚未经服务端确认；失败时由 Composer 回滚。 */
  pending?: boolean;
}

interface StoreState {
  sessions: SessionSnapshot[];
  activeId: string | null;
  messagesBySession: Record<string, Msg[]>;
  draftBySession: Record<string, string>;

  setActive: (id: string | null) => void;
  upsertSession: (snap: SessionSnapshot) => void;
  removeSession: (id: string) => void;
  setSessions: (list: SessionSnapshot[]) => void;
  setDraft: (id: string, text: string) => void;

  addUserMessage: (sessionId: string, text: string) => string;
  removeMessage: (sessionId: string, msgId: string) => void;
  markMessageConfirmed: (sessionId: string, msgId: string) => void;
  applyEvent: (sessionId: string, event: PiEvent) => void;
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

export const useStore = create<StoreState>((set, get) => ({
  sessions: [],
  activeId: null,
  messagesBySession: {},
  draftBySession: {},

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
      return {
        sessions,
        activeId: s.activeId ?? snap.id,
        messagesBySession: s.messagesBySession[snap.id]
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
    // 以副本就地修改，末尾用新引用触发 React 更新。
    const msgs = list.slice();

    const commit = () =>
      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
      }));

    switch (event.type) {
      case "message_start": {
        const msg = event.message as { role?: string } | undefined;
        if (msg?.role === "assistant") {
          msgs.push({
            id: nextId(),
            role: "assistant",
            text: "",
            streaming: true,
          });
          commit();
        } else if (msg?.role === "user") {
          // 服务端回声 user 消息：确认我们乐观插入的那条（避免重复）
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "user" && msgs[i].pending) {
              msgs[i] = { ...msgs[i], pending: false };
              commit();
              break;
            }
          }
        }
        break;
      }
      case "message_update": {
        const ame = event.assistantMessageEvent as
          | { type: string; delta?: string; toolCall?: Record<string, unknown> }
          | undefined;
        if (!ame) break;
        let target = lastStreamingAssistant(msgs);
        if (!target) {
          target = { id: nextId(), role: "assistant", text: "", streaming: true };
          msgs.push(target);
        }
        // 复制目标以形成新引用
        const updated: Msg = { ...target };
        const targetIdx = msgs.lastIndexOf(target);
        if (ame.type === "text_delta") {
          updated.text += ame.delta ?? "";
        } else if (ame.type === "thinking_delta") {
          updated.thinking = (updated.thinking ?? "") + (ame.delta ?? "");
        } else if (ame.type === "toolcall_end" && ame.toolCall) {
          const tc = ame.toolCall as {
            id?: string;
            name?: string;
            arguments?: unknown;
          };
          const calls = (updated.toolCalls ?? []).slice();
          calls.push({
            id: String(tc.id ?? nextId()),
            name: String(tc.name ?? "tool"),
            args: tc.arguments,
            running: true,
          });
          updated.toolCalls = calls;
        }
        msgs[targetIdx] = updated;
        commit();
        break;
      }
      case "message_end": {
        const target = lastStreamingAssistant(msgs);
        if (target) {
          const idx = msgs.lastIndexOf(target);
          msgs[idx] = { ...target, streaming: false };
          commit();
        }
        break;
      }
      case "tool_execution_start": {
        // 已在 toolcall_end 建卡；此处标记 running（幂等）
        break;
      }
      case "tool_execution_end": {
        const toolCallId = String(event.toolCallId ?? "");
        const result = event.result as
          | { content?: Array<{ type: string; text?: string }> }
          | undefined;
        const text =
          result?.content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n") ?? "";
        // 找到含该 toolCall 的 assistant 消息更新其结果
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.toolCalls?.some((c) => c.id === toolCallId)) {
            const calls = m.toolCalls.map((c) =>
              c.id === toolCallId
                ? {
                    ...c,
                    result: text,
                    isError: Boolean(event.isError),
                    running: false,
                  }
                : c
            );
            msgs[i] = { ...m, toolCalls: calls };
            commit();
            break;
          }
        }
        break;
      }
    }
  },
}));
