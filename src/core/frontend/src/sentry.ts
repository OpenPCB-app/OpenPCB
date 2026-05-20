// Renderer-side Sentry init. DSN, release, and environment are configured by
// the main process; passing them here is a no-op. We only configure
// renderer-specific integrations.
import * as Sentry from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";

let initialized = false;

export function initRendererSentry(): void {
  if (initialized) return;
  if (typeof window !== "undefined" && !window.electronAPI) return;
  initialized = true;

  Sentry.init(
    {
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: false,
          blockAllMedia: false,
        }),
        // Renderer-side ANR detection: 1s threshold, captures stack trace via
        // visibility-state-aware heartbeat.
        Sentry.eventLoopBlockIntegration({ threshold: 1000 }),
      ],
      tracesSampleRate: 0.1,
      // Session-replay only on errors; no continuous recording.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
    },
    // Cast: @sentry/electron's BrowserOptions superset includes the electron
    // event-loop-block integration which is not in @sentry/react's typing.
    // Runtime behavior is identical.
    (opts) => {
      reactInit(opts as Parameters<typeof reactInit>[0]);
    },
  );
}

export { Sentry };
