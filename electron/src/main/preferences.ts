import { app } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { log } from "./logger.js";

interface Preferences {
  telemetryOptIn?: boolean;
}

let cache: Preferences | null = null;

function prefsPath(): string {
  return join(app.getPath("userData"), "preferences.json");
}

function load(): Preferences {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(prefsPath(), "utf8")) as Preferences;
  } catch {
    cache = {};
  }
  return cache;
}

export function getTelemetryOptIn(): boolean {
  return load().telemetryOptIn === true;
}

export function setTelemetryOptIn(value: boolean): void {
  const prefs = load();
  prefs.telemetryOptIn = value;
  cache = prefs;
  try {
    writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
  } catch (err) {
    log.error("[preferences] flush failed:", err);
  }
}
