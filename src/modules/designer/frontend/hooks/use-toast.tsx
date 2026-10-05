import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  type ReactNode,
} from "react";
import {
  toast,
  useToastStore,
  type ToastTone,
} from "@shared/frontend/ui/toast";

export interface Toast {
  id: string;
  message: string;
  variant?: "info" | "success" | "warning" | "error";
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast(
    message: string,
    variant?: Toast["variant"],
    duration?: number,
  ): void;
  removeToast(id: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const prefix = `designer-${useId()}-`;
  const sharedToasts = useToastStore((state) => state.toasts);
  const toasts = useMemo(
    () =>
      sharedToasts
        .filter((item) => item.id.startsWith(prefix))
        .map((item) => ({
          id: item.id,
          message: item.message,
          variant: item.tone === "danger" ? ("error" as const) : item.tone,
          duration: item.durationMs ?? undefined,
        })),
    [sharedToasts, prefix],
  );
  const addToast = useCallback(
    (
      message: string,
      variant: Toast["variant"] = "info",
      duration?: number,
    ) => {
      const tone: ToastTone = variant === "error" ? "danger" : variant;
      toast.show({
        id: `${prefix}${crypto.randomUUID()}`,
        tone,
        message,
        // Handled operation failures remain visible until explicitly dismissed.
        durationMs: variant === "error" ? null : duration,
      });
    },
    [prefix],
  );
  const removeToast = useCallback(
    (id: string) => {
      if (id.startsWith(prefix)) toast.dismiss(id);
    },
    [prefix],
  );
  const value = useMemo(
    () => ({ toasts, addToast, removeToast }),
    [toasts, addToast, removeToast],
  );
  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
