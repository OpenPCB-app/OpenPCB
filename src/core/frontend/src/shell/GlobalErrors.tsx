import { useEffect } from "react";
import { toast } from "@shared/frontend/ui/toast";
import { errorDetails } from "@shared/frontend/ui/error-boundary";
import { Sentry } from "../sentry";

export function reportRenderError(error: unknown): void {
  console.error("[OpenPCB] View render failed", error);
  if (Sentry.getClient()) Sentry.captureException(error);
}

async function copyErrorDetails(error: unknown): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(errorDetails(error));
  } catch {
    toast.error(
      "Could not copy error details. Check application diagnostics.",
      {
        id: "runtime-copy-error",
        durationMs: null,
      },
    );
  }
}

export function notifyGlobalError(error: unknown): void {
  toast.error(
    "An operation failed unexpectedly. Check the current view before retrying; unsaved changes may need attention.",
    {
      id: "runtime-unhandled-error",
      title: "Unexpected application error",
      durationMs: null,
      action: {
        label: "Copy details",
        onClick: () => {
          void copyErrorDetails(error);
        },
      },
    },
  );
}

export function GlobalErrors() {
  useEffect(() => {
    const onError = (event: ErrorEvent) =>
      notifyGlobalError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      notifyGlobalError(event.reason);
    // Preserve default diagnostics and the existing opt-in telemetry handlers.
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
