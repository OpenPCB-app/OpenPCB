import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Electron has no window.prompt, and window.confirm/alert bypass the mounted
 * DialogHost. Use confirmDialog/promptDialog from @shared/frontend/ui/dialog-host-store.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const NATIVE = /\bwindow\.(?:prompt|confirm|alert)\s*\(/;

const ALLOWLIST = new Set<string>([]);

function roots(): string[] {
  const modules = path.join(repoRoot, "src/modules");
  return [
    path.join(repoRoot, "src/core/frontend/src"),
    path.join(repoRoot, "src/shared/frontend"),
    ...readdirSync(modules)
      .map((name) => path.join(modules, name, "frontend"))
      .filter((dir) => existsSync(dir)),
  ];
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && name !== "dist" && name !== "generated") walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
}

describe("native dialog guard", () => {
  const offenders: string[] = [];
  const files: string[] = [];
  for (const root of roots()) walk(root, files);
  for (const file of files) {
    if (NATIVE.test(readFileSync(file, "utf8"))) {
      offenders.push(path.relative(repoRoot, file).split(path.sep).join("/"));
    }
  }

  it("no new window.prompt/confirm/alert outside the allowlist", () => {
    expect(offenders.filter((f) => !ALLOWLIST.has(f))).toEqual([]);
  });

  it("allowlist has no stale entries", () => {
    expect([...ALLOWLIST].filter((f) => !offenders.includes(f))).toEqual([]);
  });
});
