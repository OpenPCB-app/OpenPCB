import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StdioServerConfig } from "./mcp-launcher-content.js";

/**
 * What OpenPCB registered with Claude Code, kept next to the generated
 * marketplace (`<userData>/claude-code/registration.json`).
 *
 * It is the ownership record for the one-click setup: Disconnect / Update
 * only touch a Claude Code registration whose command and arguments match
 * what this installation registered (or would register now) — never one that
 * merely has the same name or a similar-looking path. It also carries the
 * exact server entry, so an app that moved (Windows portable, reinstall
 * elsewhere) sees that Claude Code still points at the old binary.
 *
 * No `electron` import; Bun tests use a temp dir.
 */
export interface ClaudeRegistration {
  /** Stable per user-data dir, created on first connect. */
  installationId: string;
  mode: "plugin" | "server";
  serverName: string;
  scope: "user";
  /** The server entry registered (server mode) or baked into the plugin. */
  config: StdioServerConfig;
  pluginId?: string;
  marketplaceDir?: string;
  appVersion: string;
  registeredAt: string;
}

function dirOf(appDataDir: string): string {
  return join(appDataDir, "claude-code");
}

function fileOf(appDataDir: string): string {
  return join(dirOf(appDataDir), "registration.json");
}

export function readRegistration(appDataDir: string): ClaudeRegistration | null {
  try {
    const parsed = JSON.parse(readFileSync(fileOf(appDataDir), "utf8")) as ClaudeRegistration;
    if (!parsed || typeof parsed.installationId !== "string" || !parsed.config) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRegistration(
  appDataDir: string,
  record: Omit<ClaudeRegistration, "installationId" | "registeredAt">,
  now: () => Date = () => new Date(),
): ClaudeRegistration {
  const previous = readRegistration(appDataDir);
  const full: ClaudeRegistration = {
    ...record,
    installationId: previous?.installationId ?? randomUUID(),
    registeredAt: now().toISOString(),
  };
  mkdirSync(dirOf(appDataDir), { recursive: true });
  const target = fileOf(appDataDir);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  renameSync(tmp, target);
  return full;
}

export function clearRegistration(appDataDir: string): void {
  rmSync(fileOf(appDataDir), { force: true });
}
