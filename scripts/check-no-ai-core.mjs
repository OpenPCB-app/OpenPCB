import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@openpcb/ai-core";
const SOURCE_ROOTS = ["src", "electron/src", "scripts", "tests"];
const GENERATED_ROOT = "src/core/frontend/src/generated";
const SKIP_DIRS = new Set(["node_modules", "dist", ".dist", "dev-data"]);
const SCANNED = /\.(?:[cm]?[jt]sx?|d\.[cm]?ts)$/;
// Guards and their fixtures name the package on purpose to refuse it.
const SELF = /^scripts\/check-(?:no-ai-core|agentkit-distribution)(?:\.test)?\.mjs$/;
const SPECIFIER = /['"`]@openpcb\/ai-core(?:\/[^'"`]*)?['"`]/;
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

function walk(root, dir, out) {
  let entries;
  try {
    entries = readdirSync(path.join(root, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

export function scanSources(files) {
  const errors = [];
  for (const { file, text } of files) {
    if (SELF.test(file) || !SCANNED.test(file)) continue;
    text.split("\n").forEach((line, index) => {
      if (SPECIFIER.test(line)) errors.push(`${file}:${index + 1}: references ${PACKAGE}`);
    });
  }
  return errors;
}

export function scanManifests(manifest, lock) {
  const errors = [];
  for (const field of [...DEP_FIELDS, "overrides"]) {
    if (manifest?.[field] && PACKAGE in manifest[field]) errors.push(`package.json: ${field} declares ${PACKAGE}`);
  }
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key.endsWith(`node_modules/${PACKAGE}`) || entry?.name === PACKAGE) {
      errors.push(`package-lock.json: ${key} resolves ${PACKAGE}`);
    }
    for (const field of DEP_FIELDS) {
      if (entry?.[field] && PACKAGE in entry[field]) {
        errors.push(`package-lock.json: ${key || "root"} ${field} depends on ${PACKAGE}`);
      }
    }
  }
  return errors;
}

export function run(root) {
  const files = [...new Set([...SOURCE_ROOTS, GENERATED_ROOT].flatMap((dir) => walk(root, dir, [])))]
    .filter((file) => SCANNED.test(file))
    .map((file) => ({ file, text: readFileSync(path.join(root, file), "utf8") }));
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  return [...scanSources(files), ...scanManifests(manifest, lock)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = run(process.cwd());
    for (const error of errors) console.error(error);
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
