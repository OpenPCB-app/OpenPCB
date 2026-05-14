import * as Sentry from "@sentry/electron/main";
import { eventLoopBlockIntegration } from "@sentry/electron/native";
import { app } from "electron";

// Public Sentry DSN (DSNs are designed to be embedded in client code).
const DEFAULT_DSN =
  "https://a30180048da6429c99b78ab406ec7cca@o4511388241887232.ingest.de.sentry.io/4511388243329104";

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;

  const dsn = process.env.OPENPCB_SENTRY_DSN ?? DEFAULT_DSN;
  if (!dsn) {
    return false;
  }

  const env =
    process.env.OPENPCB_SENTRY_ENV ??
    (app.isPackaged ? "production" : "development");

  Sentry.init({
    dsn,
    release: `openpcb@${app.getVersion()}`,
    environment: env,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    integrations: [eventLoopBlockIntegration({ threshold: 1000 })],
    // Mirror electron-log entries into Sentry's logs product (errors only).
    enableLogs: true,
  });

  initialized = true;
  return true;
}

export { Sentry };
