import { useEffect, useState } from "react";
import { useStore, exportMessages } from "../store";
import type { SessionSnapshot } from "../../shared/types";

export function Composer({ session }: { session: SessionSnapshot }) {
  const draft = useStore((s) => s.draftBySession[session.id] ?? "");
  const setDraft = useStore((s) => s.setDraft);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const removeMessage = useStore((s) => s.removeMessage);
  const markMessageConfirmed = useStore((s) => s.markMessageConfirmed);
  const resolvePersistedSession = useStore((s) => s.resolvePersistedSession);
  const [sendError, setSendError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const busy = session.status === "busy" || session.status === "compacting";
  const isExited = session.status === "exited";

  // 保存消息（在 message_end 时调用的辅助函数）
  const persistMessages = () => {
    const msgs = useStore.getState().messagesBySession[session.id];
    if (msgs && msgs.length > 0) {
      const data = exportMessages(msgs);
      if (data.length > 0) {
        window.sessionAPI.saveMessages(session.id, data);
      }
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || session.status === "exited") return;
    setSendError(null);
    const pendingId = addUserMessage(session.id, text);
    setDraft(session.id, "");
    const r = await window.sessionAPI.prompt(session.id, text);
    if (r.ok) {
      markMessageConfirmed(session.id, pendingId);
    } else {
      removeMessage(session.id, pendingId);
      setDraft(session.id, text);
      setSendError(r.error);
      console.error("prompt failed:", r.error);
    }
  };

  const resume = async () => {
    setResuming(true);
    setSendError(null);
    try {
      const r = await window.sessionAPI.historyResume(session.id);
      if (r.ok) {
        // 从历史列表中移除
        resolvePersistedSession(session.id);
        // store 中 upsertSession 会由 onChange 事件处理
      } else {
        setSendError(r.error);
      }
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setResuming(false);
    }
  };

  const abort = async () => {
    await window.sessionAPI.abort(session.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (session.status !== "exited") send();
    }
  };

  // 在 message_end 事件后自动保存消息（通过比较消息长度变化）
  useEffect(() => {
    const unsub = window.sessionAPI.onEvent(({ sessionId, event }) => {
      if (sessionId !== session.id) return;
      if (event.type === "message_end") {
        setTimeout(persistMessages, 500);
      }
    });
    return unsub;
  }, [session.id]);

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        value={draft}
        placeholder={isExited ? "会话已停止 · 点击「续对话」恢复" : "输入消息，Enter 发送，Shift+Enter 换行"}
        disabled={isExited}
        onChange={(e) => {
          setDraft(session.id, e.target.value);
          if (sendError) setSendError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {sendError && <div className="composer-error">{sendError}</div>}
      {isExited ? (
        <button className="btn btn-resume" onClick={resume} disabled={resuming}>
          {resuming ? "恢复中…" : "续对话"}
        </button>
      ) : busy ? (
        <button className="btn btn-abort" onClick={abort}>
          中止
        </button>
      ) : (
        <button className="btn btn-send" onClick={send} disabled={!draft.trim()}>
          发送
        </button>
      )}
    </div>
  );
}
