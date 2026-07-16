import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Msg, ToolCallView } from "../store";

function ToolCallBlock({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`bubble-tool ${call.isError ? "toolcall-error" : ""}`}>
      <button className="toolcall-head" onClick={() => setOpen((v) => !v)}>
        <span className="toolcall-icon">
          {call.running ? "⏳" : call.isError ? "✖" : "🛠"}
        </span>
        <span className="toolcall-name">{call.name}</span>
        <span className="toolcall-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="toolcall-body">
          {call.args != null && (
            <pre className="toolcall-args">
              {typeof call.args === "string"
                ? call.args
                : JSON.stringify(call.args, null, 2)}
            </pre>
          )}
          {call.result != null && (
            <pre className="toolcall-result">{call.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bubble-thinking">
      <button className="thinking-head" onClick={() => setOpen((v) => !v)}>
        <span>💭 思考过程</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && <pre className="thinking-body">{text}</pre>}
    </div>
  );
}

export function MessageItem({ msg }: { msg: Msg }) {
  // thinking 与工具调用作为独立气泡渲染在助手气泡之前
  if (msg.role === "user") {
    return (
      <div className={`bubble bubble-user${msg.pending ? " bubble-pending" : ""}`}>
        <div className="bubble-role">你</div>
        <div className="plaintext">{msg.text}</div>
      </div>
    );
  }

  return (
    <>
      {msg.thinking && <Thinking text={msg.thinking} />}
      {msg.toolCalls?.map((c) => (
        <ToolCallBlock key={c.id} call={c} />
      ))}
      <div className="bubble bubble-text">
        <div className="bubble-role">Pi</div>
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {msg.text || (msg.streaming ? "▌" : "")}
          </ReactMarkdown>
        </div>
        {msg.streaming && msg.text && <span className="cursor">▌</span>}
      </div>
    </>
  );
}
