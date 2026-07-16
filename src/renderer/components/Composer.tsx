import { useState } from "react";
import { useStore } from "../store";
import type { SessionSnapshot } from "../../shared/types";

export function Composer({ session }: { session: SessionSnapshot }) {
  const draft = useStore((s) => s.draftBySession[session.id] ?? "");
  const setDraft = useStore((s) => s.setDraft);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const removeMessage = useStore((s) => s.removeMessage);
  const markMessageConfirmed = useStore((s) => s.markMessageConfirmed);
  const [sendError, setSendError] = useState<string | null>(null);

  const busy = session.status === "busy" || session.status === "compacting";
  const exited = session.status === "exited";

  const send = async () => {
    const text = draft.trim();
    if (!text || exited) return;
    setSendError(null);
    // 乐观插入用户消息（pending 标记），记下 id 以便失败回滚
    const pendingId = addUserMessage(session.id, text);
    setDraft(session.id, "");
    const r = await window.sessionAPI.prompt(session.id, text);
    if (r.ok) {
      // 立即把该条标记为已确认（避免 message_start 来之前仍显灰）
      markMessageConfirmed(session.id, pendingId);
    } else {
      // 失败：把乐观插入的消息移除并恢复 draft，让用户重试
      removeMessage(session.id, pendingId);
      setDraft(session.id, text);
      setSendError(r.error);
      console.error("prompt failed:", r.error);
    }
  };

  const abort = async () => {
    await window.sessionAPI.abort(session.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        value={draft}
        placeholder={exited ? "会话已退出" : "输入消息，Enter 发送，Shift+Enter 换行"}
        disabled={exited}
        onChange={(e) => {
          setDraft(session.id, e.target.value);
          if (sendError) setSendError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {sendError && <div className="composer-error">{sendError}</div>}
      {busy ? (
        <button className="btn btn-abort" onClick={abort}>
          中止
        </button>
      ) : (
        <button className="btn btn-send" onClick={send} disabled={exited || !draft.trim()}>
          发送
        </button>
      )}
    </div>
  );
}
