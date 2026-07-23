"use client";

import { createContext, useCallback, useContext, useReducer } from "react";
import { createPortal } from "react-dom";

import { Toast } from "./Toast";

type ToastItem = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
};

type State = ToastItem[];

type Action =
  | { type: "add"; toast: ToastItem }
  | { type: "remove"; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "add":
      return [...state, action.toast];
    case "remove":
      return state.filter((t) => t.id !== action.id);
  }
}

type ToastContextValue = {
  addToast: (type: ToastItem["type"], message: string) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const addToast = useCallback((type: ToastItem["type"], message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    dispatch({ type: "add", toast: { id, type, message } });
    setTimeout(() => dispatch({ type: "remove", id }), 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    dispatch({ type: "remove", id });
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
            {toasts.map((t) => (
              <Toast key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
