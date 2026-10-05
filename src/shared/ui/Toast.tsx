"use client";

import { CheckCircle, Info, X, XCircle } from "lucide-react";

const ICON_MAP = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
};

/**
 * Audit #6: success was white on `bg-success`, under 4.5:1 in both themes. It is
 * now the approved mockup's toast: ink on a pale tint with a border in light,
 * light ink on a deep tint in dark. Measured in the browser, not taken from the
 * palette. `error` is untouched (not in the audit's scope).
 */
const BG_MAP = {
  success: "border border-green-300 bg-green-50 dark:border-green-400/30 dark:bg-green-950",
  error: "bg-destructive",
  info: "bg-muted",
};

const FG_MAP = {
  success: "text-green-800 dark:text-green-300",
  error: "text-destructive-foreground",
  info: "text-muted-foreground",
};

export function Toast({
  toast,
  onDismiss,
}: {
  toast: { type: "success" | "error" | "info"; message: string };
  onDismiss: () => void;
}) {
  const Icon = ICON_MAP[toast.type];

  return (
    <div
      role="status"
      className={`animate-fade-in flex items-center gap-2 rounded-lg px-4 py-3 text-sm shadow-md ${BG_MAP[toast.type]} ${FG_MAP[toast.type]}`}
    >
      <Icon aria-hidden="true" size={18} />
      <span>{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 rounded p-0.5 transition-colors hover:opacity-70"
        aria-label="Cerrar"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
