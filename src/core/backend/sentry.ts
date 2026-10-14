// Backend Sentry is loaded lazily so the bundle does not need to statically
// resolve @sentry/node + the full OpenTelemetry tree at startup. The tree
// uses require-in-the-middle / dynamic-require patterns that conflict with
// bundlers; loading via createRequire at runtime keeps Sentry optional —
// when the dep isn't shipped, the app continues without telemetry.
import { createRequire } from "node:module";
import { TELEMETRY_SCRUB_HOOKS } from "../contracts/credentials/telemetry-scrub";

const lazyRequire = createRequire(import.meta.url);

interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: Record<string, unknown>): void;
}

let SentryAPI: SentryLike | null = null;
let initialized = false;

/**
 * B11 — crash reporting is OPT-IN, and the gate comes first.
 *
 * The desktop already owns one consent decision: `telemetryOptIn`, stored in
 * userData `preferences.json` (default false), honoured by Electron main
 * (`electron/src/main/sentry.ts`) and the renderer (`src/core/frontend/src/main.tsx`),
 * with shipped UI in Settings → Privacy. The backend was the one process that
 * ignored it — it initialised unconditionally against a hardcoded production
 * DSN. Electron propagates the preference here as `OPENPCB_TELEMETRY_OPT_IN`;
 * anything else (headless `bun main.ts`, tests, CI) must opt in explicitly.
 *
 * There is deliberately no hardcoded DSN fallback: no DSN configured means off.
 */
function telemetryOptedIn(): boolean {
  const raw = process.env.OPENPCB_TELEMETRY_OPT_IN?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function initBackendSentry(): boolean {
  if (initialized) return SentryAPI !== null;
  initialized = true;

  if (!telemetryOptedIn()) return false;

  const dsn = process.env.OPENPCB_SENTRY_DSN;
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
    ...TELEMETRY_SCRUB_HOOKS,
  });

  return true;
}

/**
 * Context keys allowed onto a Sentry event. An allowlist, not a denylist: the
 * caller-supplied bag is developer-facing and grows over time, and route paths
 * in particular embed design/component ids (`/api/modules/designer/designs/<id>/…`).
 * Anything not named here is dropped.
 */
const SAFE_CONTEXT_KEYS = new Set(["requestId", "method", "status", "phase"]);

/** Exported for tests — the allowlist is security-relevant, so it is pinned. */
export function scrubContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SAFE_CONTEXT_KEYS.has(key)) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function captureBackendException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!SentryAPI) return;
  const safe = scrubContext(context);
  SentryAPI.captureException(error, safe ? { extra: safe } : undefined);
}

export const Sentry = {
  captureException(error: unknown, hint?: Record<string, unknown>): void {
    SentryAPI?.captureException(error, hint);
  },
};
