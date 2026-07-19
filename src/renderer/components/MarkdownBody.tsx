import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const components: Components = {
  a({ href, children, ...rest }) {
    if (href?.startsWith("mention://")) {
      return <span className="markdown-mention">{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  },
};

export function MarkdownBody({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const cls = className ? `markdown ${className}` : "markdown";
  return (
    <div className={cls}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
