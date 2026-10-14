import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateSharedLock(manifest, lock) {
  const errors = [];
  for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
    if (!name.startsWith("@openpcb/")) continue;
    const packageName = name.slice("@openpcb/".length);
    const prefix = `github:OpenPCB-app/shared#${packageName}-v`;
    if (!specifier.startsWith(prefix)) {
      errors.push(`${name}: expected a published package-specific shared tag`);
      continue;
    }
    const expectedVersion = specifier.slice(prefix.length);
    const entry = lock.packages?.[`node_modules/${name}`];
    if (lock.packages?.[""]?.dependencies?.[name] !== specifier) {
      errors.push(`${name}: root lock declaration differs from package.json`);
    }
    if (entry?.version !== expectedVersion) {
      errors.push(`${name}: locked version ${entry?.version ?? "missing"} differs from tag version ${expectedVersion}`);
    }
    if (!/^git\+ssh:\/\/git@github\.com\/OpenPCB-app\/shared\.git#[a-f0-9]{40}$/.test(entry?.resolved ?? "")) {
      errors.push(`${name}: expected an immutable shared commit SHA in package-lock.json`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const errors = validateSharedLock(manifest, lock);
    for (const error of errors) console.error(error);
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
