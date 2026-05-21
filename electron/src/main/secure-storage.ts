// Encrypts auth tokens via OS keychain (safeStorage). Falls back to
// base64-only on Linux without a keyring — still better than renderer-visible
// localStorage, but not cryptographically protected.
import { app, safeStorage } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { log } from "./logger.js";

type StoreMap = Record<string, string>;

let store: StoreMap | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function storePath(): string {
  return join(app.getPath("userData"), "secure-store.json");
}

function loadStore(): StoreMap {
  if (store) return store;
  try {
    store = JSON.parse(readFileSync(storePath(), "utf8")) as StoreMap;
  } catch {
    // File missing on first run — start with empty map.
    store = {};
  }
  return store;
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  // Coalesce rapid set/remove calls into one write.
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      writeFileSync(storePath(), JSON.stringify(store ?? {}), "utf8");
    } catch (err) {
      log.error("[secure-storage] flush failed:", err);
    }
  }, 50);
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString("base64");
  }
  // Linux without keyring: base64 only — not secret but not renderer-accessible.
  log.warn(
    "[secure-storage] OS keychain unavailable; storing base64-only (no encryption)",
  );
  return Buffer.from(value).toString("base64");
}

function decrypt(ciphertext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
  }
  return Buffer.from(ciphertext, "base64").toString("utf8");
}

export function getSecureItem(key: string): Promise<string | null> {
  const map = loadStore();
  const raw = map[key];
  if (raw === undefined) return Promise.resolve(null);
  try {
    return Promise.resolve(decrypt(raw));
  } catch (err) {
    log.error(`[secure-storage] decrypt failed for key "${key}":`, err);
    return Promise.resolve(null);
  }
}

export function setSecureItem(key: string, value: string): Promise<void> {
  const map = loadStore();
  map[key] = encrypt(value);
  scheduleFlush();
  return Promise.resolve();
}

export function removeSecureItem(key: string): Promise<void> {
  const map = loadStore();
  delete map[key];
  scheduleFlush();
  return Promise.resolve();
}
