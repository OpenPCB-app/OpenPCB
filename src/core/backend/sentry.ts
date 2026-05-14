// Backend Sentry is loaded lazily so the bundle does not need to statically
// resolve @sentry/node + the full OpenTelemetry tree at startup. The tree
// uses require-in-the-middle / dynamic-require patterns that conflict with
// bundlers; loading via createRequire at runtime keeps Sentry optional —
// when the dep isn't shipped, the app continues without telemetry.
import { createRequire } from "node:module";

const lazyRequire = createRequire(import.meta.url);

interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: Record<string, unknown>): void;
}

let SentryAPI: SentryLike | null = null;
let initialized = false;

const DEFAULT_DSN =
  "https://a30180048da6429c99b78ab406ec7cca@o4511388241887232.ingest.de.sentry.io/4511388243329104";

export function initBackendSentry(): boolean {
  if (initialized) return SentryAPI !== null;
  initialized = true;

  const dsn = process.env.OPENPCB_SENTRY_DSN ?? DEFAULT_DSN;
  if (!dsn) return false;

  try {
    SentryAPI = lazyRequire("@sentry/node") as SentryLike;
  } catch {
    return false;
  }

  const release =
    process.env.OPENPCB_SENTRY_RELEASE ??
    `openpcb-backend@${process.env.npm_package_version ?? "0.0.0"}`;
  const environment =
    process.env.OPENPCB_SENTRY_ENV ??
    (process.env.NODE_ENV === "production" ? "production" : "development");

  SentryAPI.init({
    dsn,
    release,
    environment,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });

  return true;
}

export function captureBackendException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!SentryAPI) return;
  SentryAPI.captureException(error, context ? { extra: context } : undefined);
}

export const Sentry = {
  captureException(error: unknown, hint?: Record<string, unknown>): void {
    SentryAPI?.captureException(error, hint);
  },
};
