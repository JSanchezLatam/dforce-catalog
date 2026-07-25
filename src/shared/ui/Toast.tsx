"use client";

import { CheckCircle, Info, X, XCircle } from "lucide-react";

const ICON_MAP = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
};

const BG_MAP = {
  success: "bg-success",
  error: "bg-destructive",
  info: "bg-muted",
};

const FG_MAP = {
  success: "text-success-foreground",
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
        aria-label="Dismiss"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
