#!/usr/bin/env node
// Upload source maps for the renderer (Vite) and Electron main+preload bundles
// to Sentry. Reads SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT from env.
// Release name follows openpcb@<package.json version>.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const pkg = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const release = `openpcb@${pkg.version}`;

const org = process.env.SENTRY_ORG;
const project = process.env.SENTRY_PROJECT;
const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) {
  console.error("[sourcemaps] SENTRY_AUTH_TOKEN not set; skipping upload.");
  process.exit(0);
}
if (!org || !project) {
  console.error(
    "[sourcemaps] SENTRY_ORG and SENTRY_PROJECT must be set; skipping upload.",
  );
  process.exit(0);
}

const targets = [
  join(repoRoot, "src", "core", "frontend", "dist"),
  join(repoRoot, "electron", "dist"),
];

function run(cmd) {
  console.log(`[sourcemaps] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: repoRoot });
}

run(`npx --yes @sentry/cli releases new "${release}"`);
for (const dir of targets) {
  if (!existsSync(dir)) {
    console.warn(`[sourcemaps] skip missing dir: ${dir}`);
    continue;
  }
  run(
    `npx --yes @sentry/cli sourcemaps upload --org "${org}" --project "${project}" --release "${release}" "${dir}"`,
  );
}
run(`npx --yes @sentry/cli releases finalize "${release}"`);
console.log(`[sourcemaps] uploaded for release ${release}`);
