import { create } from "zustand";

/*
 * App-wide notifications (T-004). Timers live here, not in the viewport, so
 * a toast expires even when it is not among the visible ones or no
 * <Toaster/> is mounted. Hovering/focusing the viewport pauses all timers.
 */

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  tone?: ToastTone;
  title?: string;
  message: string;
  action?: ToastAction;
  /** ms until auto-dismiss; `null` = sticky. Default 8000 danger, 4000 other. */
  durationMs?: number | null;
  /** Stable id: showing the same id again replaces that toast (dedupe). */
  id?: string;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title?: string;
  message: string;
  action?: ToastAction;
  durationMs: number | null;
}

export const TOAST_DEFAULT_MS = 4000;
export const TOAST_ERROR_MS = 8000;
/** Older toasts beyond this are dropped outright. */
const MAX_STORED = 20;

interface ToastState {
  toasts: ToastItem[];
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }));

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

const timers = new Map<string, Timer>();
let paused = false;
let counter = 0;

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
}

function arm(id: string, remaining: number): void {
  const timer: Timer = { handle: null, remaining, startedAt: Date.now() };
  if (!paused) timer.handle = setTimeout(() => dismissToast(id), remaining);
  timers.set(id, timer);
}

export function dismissToast(id: string): void {
  clearTimer(id);
  useToastStore.setState((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id),
  }));
}

export function showToast(options: ToastOptions): string {
  const tone = options.tone ?? "info";
  const id = options.id ?? `toast-${++counter}`;
  const durationMs =
    options.durationMs === undefined
      ? tone === "danger"
        ? TOAST_ERROR_MS
        : TOAST_DEFAULT_MS
      : options.durationMs;
  const item: ToastItem = {
    id,
    tone,
    title: options.title,
    message: options.message,
    action: options.action,
    durationMs,
  };
  clearTimer(id);
  useToastStore.setState((state) => {
    const exists = state.toasts.some((toast) => toast.id === id);
    const next = exists
      ? state.toasts.map((toast) => (toast.id === id ? item : toast))
      : [...state.toasts, item];
    const dropped = next.slice(0, Math.max(0, next.length - MAX_STORED));
    for (const toast of dropped) clearTimer(toast.id);
    return { toasts: next.slice(-MAX_STORED) };
  });
  if (durationMs !== null) arm(id, durationMs);
  return id;
}

/** Freeze every countdown (pointer over / focus inside the viewport). */
export function pauseToasts(): void {
  if (paused) return;
  paused = true;
  const now = Date.now();
  for (const timer of timers.values()) {
    if (timer.handle) clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
  }
}

export function resumeToasts(): void {
  if (!paused) return;
  paused = false;
  for (const [id, timer] of timers) arm(id, timer.remaining);
}

export function clearToasts(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  useToastStore.setState({ toasts: [] });
}

type ToneShortcut = (message: string, options?: Omit<ToastOptions, "message" | "tone">) => string;

function withTone(tone: ToastTone): ToneShortcut {
  return (message, options) => showToast({ ...options, message, tone });
}

/** `toast.error(describeError(err, "save"))`, `toast.show({...})`, … */
export const toast = {
  show: showToast,
  info: withTone("info"),
  success: withTone("success"),
  warning: withTone("warning"),
  error: withTone("danger"),
  dismiss: dismissToast,
  clear: clearToasts,
};
