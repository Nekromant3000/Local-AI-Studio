import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import CopyButton from "./CopyButton";

SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("powershell", powershell);
SyntaxHighlighter.registerLanguage("csharp", csharp);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("cpp", cpp);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("docker", docker);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("php", php);
SyntaxHighlighter.registerLanguage("ruby", ruby);
SyntaxHighlighter.registerLanguage("kotlin", kotlin);
SyntaxHighlighter.registerLanguage("swift", swift);
SyntaxHighlighter.registerLanguage("ini", ini);
SyntaxHighlighter.registerLanguage("toml", toml);

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  html: "markup",
  xml: "markup",
  svg: "markup",
  md: "markdown",
  yml: "yaml",
  ps1: "powershell",
  pwsh: "powershell",
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  golang: "go",
  rs: "rust",
  rb: "ruby",
  kt: "kotlin",
  dockerfile: "docker",
  conf: "ini",
  cfg: "ini",
  text: "markup",
  plaintext: "markup",
};

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  python: "Python",
  bash: "Bash",
  json: "JSON",
  markdown: "Markdown",
  css: "CSS",
  markup: "HTML",
  sql: "SQL",
  powershell: "PowerShell",
  csharp: "C#",
  java: "Java",
  cpp: "C++",
  yaml: "YAML",
  diff: "Diff",
  docker: "Docker",
  go: "Go",
  rust: "Rust",
  php: "PHP",
  ruby: "Ruby",
  kotlin: "Kotlin",
  swift: "Swift",
  ini: "INI",
  toml: "TOML",
};

interface CodeBlockProps {
  code: string;
  language?: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const raw = (language || "").toLowerCase().replace(/^language-/, "").trim();
  const resolved = LANGUAGE_ALIASES[raw] || raw;
  const known = Boolean(LANGUAGE_LABELS[resolved]);
  const label = known ? LANGUAGE_LABELS[resolved] : raw || "Код";

  return (
    <div className="code-block my-3.5 overflow-hidden rounded-xl border border-white/10 bg-[#0a0f1c]">
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.022] px-3.5 py-1.5">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
          {label}
        </span>
        <CopyButton text={code} label="Копировать" />
      </div>
      <div className="max-h-[560px] overflow-auto">
        <SyntaxHighlighter
          language={known ? resolved : "text"}
          style={oneDark}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: "14px 16px",
            background: "transparent",
            fontSize: "12.5px",
            lineHeight: 1.62,
          }}
          codeTagProps={{
            style: {
              fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
              textShadow: "none",
            },
          }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
