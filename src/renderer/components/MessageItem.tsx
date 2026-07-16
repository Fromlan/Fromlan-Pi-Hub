import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Msg, ToolCallView, ContentPart } from "../store";

/** 把 args 对象压缩成可读单行（隐藏过长的字符串）。 */
function summarizeArgs(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "string") return args;
  if (typeof args !== "object") return String(args);
  const o = args as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") {
      const s = v.length > 200 ? `${v.slice(0, 200)}…` : v;
      parts.push(`${k}: ${JSON.stringify(s)}`);
    } else {
      parts.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  return parts.join(", ");
}

/** 取工具调用参数中最关键的展示字段。 */
function toolSummary(toolName: string, args: unknown): string {
  if (args == null) return "";
  const o = args as Record<string, unknown>;
  if (typeof o !== "object" || o === null) return summarizeArgs(args);
  switch (toolName) {
    case "bash":
      return typeof o.command === "string" ? o.command : summarizeArgs(args);
    case "read":
    case "write":
    case "edit":
      return typeof o.path === "string" ? o.path : summarizeArgs(args);
    case "grep":
    case "rg":
      return [o.pattern, o.path].filter(Boolean).join("  in  ");
    case "fetch":
      return typeof o.url === "string" ? o.url : summarizeArgs(args);
    default:
      return summarizeArgs(args);
  }
}

function ToolCallBlock({
  call,
  footer,
}: {
  call: ToolCallView;
  /** 折叠卡底部额外信息（如截断提示、退出码）。 */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const summary = toolSummary(call.name, call.args);
  const streamingText = call.streamingOutput;
  const finalText = call.result;
  const displayText = streamingText ?? finalText ?? "";
  const stillStreaming = call.running && !finalText && streamingText != null;
  return (
    <div className={`bubble-tool ${call.isError ? "toolcall-error" : ""}`}>
      <button className="toolcall-head" onClick={() => setOpen((v) => !v)}>
        <span className="toolcall-icon">
          {call.running && !finalText ? "⏳" : call.isError ? "✖" : "🛠"}
        </span>
        <span className="toolcall-name">{call.name}</span>
        {summary && <span className="toolcall-summary">{summary}</span>}
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
          {displayText && (
            <pre className={`toolcall-result${stillStreaming ? " toolcall-streaming" : ""}`}>
              {displayText}
              {stillStreaming && <span className="cursor">▌</span>}
            </pre>
          )}
          {call.truncated && (
            <div className="toolcall-meta">
              ⚠ 输出已截断
              {call.fullOutputPath && ` — 完整日志：${call.fullOutputPath}`}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}

/** 独立 bash RPC 命令执行（无 tool_call 包装）的渲染：复用可折叠卡样式。 */
function BashExecutionBlock({
  command,
  output,
  exitCode,
}: {
  command?: string;
  output: string;
  exitCode?: number;
}) {
  const isError = exitCode != null && exitCode !== 0;
  const view: ToolCallView = {
    id: `bash-${command ?? ""}`,
    name: "bash",
    args: command ? { command } : undefined,
    result: output,
    isError,
    running: false,
  };
  return (
    <ToolCallBlock
      call={view}
      footer={
        exitCode != null && exitCode !== 0 ? (
          <div className="toolcall-meta">退出码 {exitCode}</div>
        ) : null
      }
    />
  );
}

/** 独立 toolResult（没有对应 assistant toolCall 段）的兜底渲染。 */
function StandaloneToolResult({
  toolName,
  text,
}: {
  toolName?: string;
  text: string;
}) {
  const view: ToolCallView = {
    id: `result-${toolName ?? ""}`,
    name: toolName ?? "tool",
    result: text,
    running: false,
  };
  return (
    <div className="bubble bubble-result">
      <ToolCallBlock call={view} />
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

/** 把 content 数组按段顺序渲染：thinking、toolCall、text。 */
function renderContent(content: ContentPart[], toolCalls: ToolCallView[] | undefined) {
  const els: React.ReactNode[] = [];
  let textBuf = "";
  // 用 callId → ToolCallView 建索引。
  const callById = new Map<string, ToolCallView>();
  for (const c of toolCalls ?? []) callById.set(c.id, c);
  const usedCalls = new Set<string>();

  content.forEach((part, i) => {
    if (part.type === "thinking") {
      // 提交已累积的 text
      if (textBuf) {
        const t = textBuf;
        els.push(
          <div key={`t-${i}`} className="bubble bubble-text">
            <div className="markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {t}
              </ReactMarkdown>
            </div>
          </div>
        );
        textBuf = "";
      }
      if (part.thinking) {
        els.push(<Thinking key={`th-${i}`} text={part.thinking} />);
      }
    } else if (part.type === "toolCall") {
      // 提交已累积的 text
      if (textBuf) {
        const t = textBuf;
        els.push(
          <div key={`t-${i}`} className="bubble bubble-text">
            <div className="markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {t}
              </ReactMarkdown>
            </div>
          </div>
        );
        textBuf = "";
      }
      const id = part.id ?? "";
      const view = callById.get(id) ?? {
        id: id || `unknown-${i}`,
        name: part.name ?? "tool",
        args: part.arguments,
        running: false,
      };
      usedCalls.add(view.id);
      els.push(<ToolCallBlock key={`tc-${id || i}`} call={view} />);
    } else if (part.type === "text") {
      textBuf += part.text ?? "";
    }
  });

  // 收尾：剩余 text
  if (textBuf) {
    els.push(
      <div key="t-tail" className="bubble bubble-text">
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {textBuf}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // 兜底：content 数组里有 tool_call 但 toolCalls 视图里没有的（极少见）
  for (const c of toolCalls ?? []) {
    if (!usedCalls.has(c.id)) {
      els.push(<ToolCallBlock key={`tc-extra-${c.id}`} call={c} />);
    }
  }
  return els;
}

export function MessageItem({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className={`bubble bubble-user${msg.pending ? " bubble-pending" : ""}`}>
        <div className="bubble-role">你</div>
        <div className="plaintext">{msg.text}</div>
      </div>
    );
  }

  if (msg.role === "toolResult") {
    return (
      <StandaloneToolResult toolName={msg.toolName} text={msg.text} />
    );
  }

  if (msg.role === "bashExecution") {
    return (
      <BashExecutionBlock
        command={msg.command}
        output={msg.text}
        exitCode={msg.exitCode}
      />
    );
  }

  // assistant
  const inner = msg.content && msg.content.length > 0
    ? renderContent(msg.content, msg.toolCalls)
    : (
      // 退化路径：content 缺失时使用派生 text/thinking/toolCalls。
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

  return <>{inner}</>;
}
