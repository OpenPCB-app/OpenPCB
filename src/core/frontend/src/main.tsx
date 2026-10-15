import { initRendererSentry } from "./sentry";

import { createRoot } from "react-dom/client";
import { App } from "./App";

// Fonts are bundled, not fetched — Electron runs offline.
// Imported before index.css so the @font-face rules land before the
// token layer that references them.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

// Sentry is opt-in. Read the preference before init; renderer events route via
// the main process which is also gated, so skipping here is belt-and-braces.
async function bootstrapTelemetry(): Promise<void> {
  const prefs = window.electronAPI?.preferences;
  if (!prefs) return;
  try {
    if (await prefs.getTelemetryOptIn()) initRendererSentry();
  } catch {
    // Preference read failed; default to no telemetry.
  }
}

void bootstrapTelemetry();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

createRoot(rootElement).render(<App />);
