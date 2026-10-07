import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// OPENPCB-113 requires separate owner approval before adopting DevKit code.
const restricted = /(?:@siwc(?:\/|%2f)|sign-in-with-chatgpt-devkit)/i;
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function restrictedDependencies(manifest) {
  const found = [];
  for (const field of dependencyFields) {
    for (const [name, source] of Object.entries(manifest[field] ?? {})) {
      if (restricted.test(name) || restricted.test(String(source))) found.push(`${field}:${name}`);
    }
  }
  for (const [location, entry] of Object.entries(manifest.packages ?? {})) {
    if (restricted.test(location) || restricted.test(entry.name ?? "") || restricted.test(entry.resolved ?? "")) {
      found.push(`packages:${location}`);
    }
    for (const field of dependencyFields) {
      for (const [name, source] of Object.entries(entry[field] ?? {})) {
        if (restricted.test(name) || restricted.test(String(source))) found.push(`${location}:${field}:${name}`);
      }
    }
  }
  return found;
}

export async function checkDistribution(root) {
  const files = ["package.json", "package-lock.json", "electron/package.json",
    "src/core/backend/package.json", "src/core/frontend/package.json"];
  const failures = [];
  for (const file of files) {
    const manifest = JSON.parse(await readFile(resolve(root, file), "utf8"));
    failures.push(...restrictedDependencies(manifest).map((item) => `${file}:${item}`));
  }
  if (failures.length) throw new Error(`SIWC adoption is blocked by OPENPCB-113: ${failures.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkDistribution(fileURLToPath(new URL("..", import.meta.url)));
  console.log("SIWC distribution guard: no unapproved DevKit dependencies.");
}
