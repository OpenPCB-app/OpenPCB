import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const generatedPaths = [
  "src/core/frontend/src/generated/modules.ts",
  "src/core/frontend/src/generated/sdk",
];

export function findGeneratedChanges(cwd, paths = generatedPaths) {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching", "--", ...paths],
    { cwd, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git status failed");
  return result.stdout.trimEnd();
}

export function checkGeneratedClean(cwd) {
  const changes = findGeneratedChanges(cwd);
  if (!changes) return true;
  console.error("Generated files differ from the committed checkout. Run npm run gen and commit all generated files.");
  console.error(changes);
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = checkGeneratedClean(process.cwd()) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
