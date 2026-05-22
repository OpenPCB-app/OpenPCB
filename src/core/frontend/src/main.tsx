import { initRendererSentry } from "./sentry";

import { createRoot } from "react-dom/client";
import { App } from "./App";
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
