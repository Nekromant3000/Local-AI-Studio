import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import clsx from "clsx";

const widths = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-[min(1180px,94vw)]",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof widths;
  bodyClassName?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = "md",
  bodyClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-[#02050c]/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          "relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-white/10",
          "bg-[#0a101e] shadow-[0_30px_120px_rgba(0,0,0,.65)] animate-fade-up",
          widths[size],
        )}
      >
        <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
          {icon ? (
            <div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-ink-200">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="truncate text-[15px] font-semibold text-white">{title}</h2>
            ) : null}
            {subtitle ? (
              <div className="mt-0.5 text-xs leading-relaxed text-ink-300">{subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn -mr-1 -mt-1"
            aria-label="Закрыть"
          >
            <X size={17} />
          </button>
        </div>
        <div className={clsx("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>
          {children}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] bg-white/[0.015] px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
