import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import CodeBlock from "./CodeBlock";

function nodeText(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children);
      return "";
    })
    .join("");
}

const components: Components = {
  pre({ children }) {
    const child = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const className = child.props.className || "";
      const language = /language-([^\s]+)/.exec(className)?.[1] || "";
      return <CodeBlock code={nodeText(child.props.children).replace(/\n$/, "")} language={language} />;
    }
    return <pre>{children}</pre>;
  },
  code({ className, children, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }) {
    const external = Boolean(href && /^https?:\/\//i.test(href));
    return (
      <a
        href={href}
        {...props}
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </a>
    );
  },
  img({ src, alt, ...props }) {
    return <img src={src} alt={alt || ""} loading="lazy" {...props} />;
  },
  table({ children, ...props }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
        <table {...props}>{children}</table>
      </div>
    );
  },
  input({ checked, ...props }) {
    return <input type="checkbox" checked={checked} readOnly {...props} />;
  },
};

interface MarkdownViewProps {
  children: string;
  className?: string;
  compact?: boolean;
}

export default function MarkdownView({ children, className, compact }: MarkdownViewProps) {
  return (
    <div className={clsx(compact ? "prose-compact" : "prose-chat", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
