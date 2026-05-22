import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const electronBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function requireWithElectron() {
  return run(
    electronBin,
    [
      "-e",
      "require('better-sqlite3'); console.log(process.versions.modules)",
    ],
    { env: { ELECTRON_RUN_AS_NODE: "1" } },
  );
}

if (!existsSync(electronBin)) {
  throw new Error(
    `Electron binary not found at ${electronBin}. Run npm install first.`,
  );
}

const electronVersionResult = run(
  electronBin,
  ["-p", "process.versions.electron"],
  { env: { ELECTRON_RUN_AS_NODE: "1" } },
);
if (electronVersionResult.status !== 0) {
  process.stderr.write(electronVersionResult.stderr ?? "");
  throw new Error("Unable to resolve Electron version.");
}
const electronVersion = electronVersionResult.stdout.trim();

const probe = requireWithElectron();
if (probe.status === 0) {
  console.log(
    `[electron-native] better-sqlite3 already matches Electron ${electronVersion} ABI ${probe.stdout.trim()}`,
  );
  process.exit(0);
}

console.warn("[electron-native] better-sqlite3 ABI mismatch detected.");
if (probe.stderr) process.stderr.write(probe.stderr);
console.warn(
  `[electron-native] Rebuilding better-sqlite3 for Electron ${electronVersion}...`,
);

const rebuild = run(
  npmBin,
  [
    "rebuild",
    "better-sqlite3",
    `--runtime=electron`,
    `--target=${electronVersion}`,
    "--disturl=https://electronjs.org/headers",
    "--build-from-source",
  ],
  { stdio: "inherit" },
);

if (rebuild.status !== 0) {
  throw new Error(`better-sqlite3 Electron rebuild failed (${rebuild.status}).`);
}

const verify = requireWithElectron();
if (verify.status !== 0) {
  process.stderr.write(verify.stderr ?? "");
  throw new Error("better-sqlite3 still fails under Electron after rebuild.");
}

console.log(
  `[electron-native] better-sqlite3 rebuilt for Electron ${electronVersion} ABI ${verify.stdout.trim()}`,
);
