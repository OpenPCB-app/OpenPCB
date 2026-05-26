import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const electronRoot = path.join(repoRoot, "electron");
const electronBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const rootBetterSqlite = path.join(repoRoot, "node_modules", "better-sqlite3");
const electronBetterSqlite = path.join(
  electronRoot,
  "node_modules",
  "better-sqlite3",
);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function readPackageVersion(packageDir) {
  const raw = readFileSync(path.join(packageDir, "package.json"), "utf8");
  return JSON.parse(raw).version;
}

function ensureElectronLocalBetterSqlite() {
  if (!existsSync(rootBetterSqlite)) {
    throw new Error(
      `better-sqlite3 not found at ${rootBetterSqlite}. Run npm install first.`,
    );
  }

  const rootVersion = readPackageVersion(rootBetterSqlite);
  const electronVersion = existsSync(electronBetterSqlite)
    ? readPackageVersion(electronBetterSqlite)
    : null;
  if (electronVersion === rootVersion) return;

  mkdirSync(path.dirname(electronBetterSqlite), { recursive: true });
  rmSync(electronBetterSqlite, { recursive: true, force: true });
  cpSync(rootBetterSqlite, electronBetterSqlite, {
    recursive: true,
    dereference: true,
  });
}

function requireWithElectron() {
  return run(
    electronBin,
    [
      "-e",
      "const Database = require('better-sqlite3'); new Database(':memory:').close(); console.log(process.versions.modules)",
    ],
    { cwd: electronRoot, env: { ELECTRON_RUN_AS_NODE: "1" } },
  );
}

function requireWithHostNode() {
  return run(
    process.execPath,
    [
      "-e",
      "const Database = require('better-sqlite3'); new Database(':memory:').close()",
    ],
    { cwd: repoRoot },
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

ensureElectronLocalBetterSqlite();

const probe = requireWithElectron();
if (probe.status === 0) {
  console.log(
    `[electron-native] better-sqlite3 already matches Electron ${electronVersion} ABI ${probe.stdout.trim()}`,
  );
} else {
  console.warn("[electron-native] better-sqlite3 ABI mismatch detected.");
  if (probe.stderr) process.stderr.write(probe.stderr);
  console.warn(
    `[electron-native] Rebuilding better-sqlite3 for Electron ${electronVersion}...`,
  );

  const rebuild = run(
    npmBin,
    [
      "run",
      "build-release",
      "--",
      `--runtime=electron`,
      `--target=${electronVersion}`,
      "--disturl=https://electronjs.org/headers",
    ],
    { cwd: electronBetterSqlite, stdio: "inherit" },
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
}

const hostProbe = requireWithHostNode();
if (hostProbe.status !== 0) {
  console.warn("[electron-native] Restoring root better-sqlite3 for host Node...");
  const hostRebuild = run(
    npmBin,
    ["rebuild", "better-sqlite3", "--build-from-source"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (hostRebuild.status !== 0) {
    throw new Error(`host better-sqlite3 rebuild failed (${hostRebuild.status}).`);
  }
}
