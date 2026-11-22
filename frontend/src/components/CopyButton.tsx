import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import clsx from "clsx";
import { copyText } from "../lib/clipboard";

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
  title?: string;
  iconSize?: number;
}

export default function CopyButton({
  text,
  className,
  label,
  title = "Скопировать",
  iconSize = 14,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors",
        copied ? "text-emerald-300" : "text-ink-300 hover:bg-white/[0.06] hover:text-white",
        className,
      )}
      onClick={() => void handleCopy()}
      title={copied ? "Скопировано" : title}
    >
      {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      {label ? <span>{copied ? "Скопировано" : label}</span> : null}
    </button>
  );
}
