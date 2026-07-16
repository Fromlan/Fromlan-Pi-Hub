import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { MessageItem } from "./MessageItem";

export function MessageList({ sessionId }: { sessionId: string }) {
  const messages = useStore(
    useShallow((s) => s.messagesBySession[sessionId] ?? [])
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  // 标记本次 effect 是否因切换 session 而触发：切换时即时跳到底，
  // 同 session 累积消息时再平滑滚动，避免视觉错位。
  const lastSessionIdRef = useRef<string>(sessionId);

  useEffect(() => {
    const switched = lastSessionIdRef.current !== sessionId;
    lastSessionIdRef.current = sessionId;
    bottomRef.current?.scrollIntoView({
      behavior: switched ? "auto" : "smooth",
    });
  }, [messages, sessionId]);

  if (messages.length === 0) {
    return <div className="message-stream empty">开始对话吧 —— 在下方输入消息</div>;
  }

  return (
    <div className="message-stream">
      {messages.map((m) => (
        <MessageItem key={m.id} msg={m} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
