import * as Sentry from "@sentry/node";

// Public Sentry DSN. Override per-process via OPENPCB_SENTRY_DSN.
const DEFAULT_DSN =
  "https://a30180048da6429c99b78ab406ec7cca@o4511388241887232.ingest.de.sentry.io/4511388243329104";

let initialized = false;

export function initBackendSentry(): boolean {
  if (initialized) return true;

  const dsn = process.env.OPENPCB_SENTRY_DSN ?? DEFAULT_DSN;
  if (!dsn) return false;

  const release =
    process.env.OPENPCB_SENTRY_RELEASE ??
    `openpcb-backend@${process.env.npm_package_version ?? "0.0.0"}`;
  const environment =
    process.env.OPENPCB_SENTRY_ENV ??
    (process.env.NODE_ENV === "production" ? "production" : "development");

  Sentry.init({
    dsn,
    release,
    environment,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });

  initialized = true;
  return true;
}

export function captureBackendException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export { Sentry };
