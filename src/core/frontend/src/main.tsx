import { initRendererSentry } from "./sentry";

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { configureBundledEdaText, disposeBundledEdaText } from "./eda-text-config";

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

// Not awaited: the canvas package stays off the bootstrap chunk, no canvas
// exists before a module space loads, and labels re-render on configuration.
void import("@openpcb/r3f-eda-canvas")
  .then((canvas) => {
    if (!configureBundledEdaText(canvas)) return;
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) disposeBundledEdaText(canvas);
    });
  })
  .catch((error: unknown) => {
    console.error("EDA text configuration failed", error);
  });

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

createRoot(rootElement).render(<App />);
