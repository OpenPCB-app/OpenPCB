import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { log as electronLog } from "./logger.js";
import { buildPluginMarketplace } from "./claude-plugin-content.js";

const log = electronLog.scope("mcp");

/**
 * Write the local Claude Code plugin marketplace (see claude-plugin-content.ts)
 * into `<appDataDir>/claude-code/marketplace/`, replacing the previous copy
 * atomically (build in a sibling temp dir, then swap), so a `claude plugin
 * marketplace update` never reads a half-written tree.
 */

function templateDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "claude-plugin", "openpcb")]
    : [join(app.getAppPath(), "resources", "claude-plugin", "openpcb")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full).split("\\").join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

export function writeClaudePluginMarketplace(input: {
  appDataDir: string;
  server: { command: string; args: string[]; env?: Record<string, string> };
}): string | null {
  const template = templateDir();
  if (!template) {
    log.warn("Claude Code plugin template not found; plugin marketplace not written.");
    return null;
  }
  const target = join(input.appDataDir, "claude-code", "marketplace");
  const staging = `${target}.${process.pid}.tmp`;
  try {
    const files = buildPluginMarketplace({
      appVersion: app.getVersion(),
      templateFiles: readTree(template),
      server: input.server,
    });
    rmSync(staging, { recursive: true, force: true });
    for (const [path, contents] of Object.entries(files)) {
      const full = join(staging, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents, "utf8");
    }
    const previous = `${target}.old`;
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(target)) renameSync(target, previous);
    renameSync(staging, target);
    rmSync(previous, { recursive: true, force: true });
    return target;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    log.warn(`Failed to write the Claude Code plugin marketplace: ${String(error)}`);
    return existsSync(target) ? target : null;
  }
}
