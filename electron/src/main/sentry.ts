// Sentry is loaded lazily via dynamic import so that the bundle does not need
// to statically include @sentry/electron + the full OpenTelemetry tree at
// startup. The tree has runtime `require()` patterns (require-in-the-middle)
// that conflict with bundlers; lazy-loading via require() lets Electron's
// loader resolve them from node_modules at runtime when present, and silently
// skip when absent (e.g. trimmed prod bundle).
import { app } from "electron";
import { createRequire } from "node:module";
import { getTelemetryOptIn } from "./preferences.js";

const requireFromHere = createRequire(import.meta.url);

let initialized = false;
let SentryAPI: typeof import("@sentry/electron/main") | null = null;

const DEFAULT_DSN =
  "https://a30180048da6429c99b78ab406ec7cca@o4511388241887232.ingest.de.sentry.io/4511388243329104";

export function initSentry(): boolean {
  if (initialized) return SentryAPI !== null;
  initialized = true;

  // Telemetry is opt-in. Users enable in Settings → Privacy; takes effect on
  // next launch (Sentry init is one-shot per process).
  if (!getTelemetryOptIn()) return false;

  const dsn = process.env.OPENPCB_SENTRY_DSN ?? DEFAULT_DSN;
  if (!dsn) return false;

  try {
    SentryAPI = requireFromHere("@sentry/electron/main");
  } catch {
    return false;
  }

  const env =
    process.env.OPENPCB_SENTRY_ENV ??
    (app.isPackaged ? "production" : "development");

  SentryAPI!.init({
    dsn,
    release: `openpcb@${app.getVersion()}`,
    environment: env,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    enableLogs: true,
  });

  return true;
}

export const Sentry = {
  captureException(err: unknown, hint?: Record<string, unknown>): void {
    SentryAPI?.captureException(err as Error, hint as never);
  },
  captureMessage(msg: string, level?: "error" | "warning" | "info"): void {
    SentryAPI?.captureMessage(msg, level);
  },
};
