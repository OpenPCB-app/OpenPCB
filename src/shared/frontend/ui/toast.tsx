import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import {
  dismissToast,
  pauseToasts,
  resumeToasts,
  useToastStore,
  type ToastItem,
  type ToastTone,
} from "./toast-store";

export {
  clearToasts,
  dismissToast,
  showToast,
  toast,
  useToastStore,
  TOAST_DEFAULT_MS,
  TOAST_ERROR_MS,
  type ToastAction,
  type ToastItem,
  type ToastOptions,
  type ToastTone,
} from "./toast-store";

const MAX_VISIBLE = 3;

const TONE: Record<ToastTone, { accent: string; Icon: typeof Info }> = {
  info: { accent: "border-l-status-info text-status-info", Icon: Info },
  success: { accent: "border-l-status-success text-status-success", Icon: CheckCircle2 },
  warning: { accent: "border-l-status-warning text-status-warning", Icon: AlertTriangle },
  danger: { accent: "border-l-status-danger text-status-danger", Icon: OctagonAlert },
};

function ToastCard({ item }: { item: ToastItem }) {
  const { accent, Icon } = TONE[item.tone];
  const danger = item.tone === "danger";
  return (
    <div
      role={danger ? "alert" : "status"}
      aria-live={danger ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-2 rounded-float border border-l-2 border-menu-border",
        "bg-menu-bg px-2.5 py-2 text-xs text-text shadow-float",
        accent,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} className="mt-px h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {item.title ? <div className="font-medium text-text-strong">{item.title}</div> : null}
        <div className="break-words text-text">{item.message}</div>
      </div>
      {item.action ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </Button>
      ) : null}
      <IconButton
        label="Dismiss notification"
        variant="ghost"
        size="sm"
        tooltip={false}
        onClick={() => dismissToast(item.id)}
        className="-mr-1 shrink-0"
      >
        <X strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

/**
 * Notification viewport: bottom-right, above the 22px status bar (never over
 * header controls), newest 3 visible, hover/focus pauses expiry. Mount ONCE
 * near the app root (wave F0b does this).
 */
export function Toaster({ className }: { className?: string }) {
  const toasts = useToastStore((state) => state.toasts);
  const visible = toasts.slice(-MAX_VISIBLE);
  return (
    <section
      aria-label="Notifications"
      onPointerEnter={pauseToasts}
      onPointerLeave={resumeToasts}
      onFocus={pauseToasts}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeToasts();
      }}
      className={cn(
        "pointer-events-none fixed bottom-[30px] right-3 z-70 flex w-[360px] max-w-[calc(100vw-24px)] flex-col gap-2",
        className,
      )}
    >
      {visible.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </section>
  );
}
