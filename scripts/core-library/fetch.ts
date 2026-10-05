import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPolicy, requireRelease, type ReleasePin } from "./policy";
import {
  checkDestination,
  publishVerified,
  readReleaseFiles,
  safeDirectory,
} from "./storage";
import { verifyRelease } from "./verify";

export interface DownloadRequest {
  repository: string;
  pin: ReleasePin;
  directory: string;
}

export interface FetchOptions {
  repoRoot: string;
  args?: string[];
  environment?: Record<string, string | undefined>;
  download?: (request: DownloadRequest) => void | Promise<void>;
}

function requestedTags(args: string[]): string[] {
  const tags: string[] = [];
  for (const argument of args) {
    if (argument === "--offline") continue;
    if (argument.startsWith("--tag=")) tags.push(argument.slice(6));
    else if (!argument.startsWith("--")) tags.push(argument);
    else throw new Error(`unsupported corelib:fetch argument: ${argument}`);
  }
  return tags;
}

function checkOverrides(
  args: string[],
  environment: Record<string, string | undefined>,
  repository: string,
  pin: ReleasePin,
  minimum: number,
): void {
  const tags = requestedTags(args);
  if (environment.OPENPCB_CORELIB_TAG !== undefined)
    tags.push(environment.OPENPCB_CORELIB_TAG);
  if (tags.some((tag) => tag !== pin.tag))
    throw new Error(
      `CoreLibrary tag override refused: only reviewed ${pin.tag} is allowed`,
    );
  if (
    environment.OPENPCB_CORELIB_REPO !== undefined &&
    environment.OPENPCB_CORELIB_REPO !== repository
  ) {
    throw new Error(
      `CoreLibrary repository override refused: only ${repository} is allowed`,
    );
  }
  if (
    environment.OPENPCB_CORELIB_MIN_COMPONENTS !== undefined &&
    environment.OPENPCB_CORELIB_MIN_COMPONENTS !== String(minimum)
  ) {
    throw new Error(
      "CoreLibrary component threshold override refused; review committed policy instead",
    );
  }
}

function ghDownload({ repository, pin, directory }: DownloadRequest): void {
  const result = spawnSync(
    "gh",
    [
      "release",
      "download",
      pin.tag,
      "--repo",
      repository,
      "--pattern",
      pin.artifact,
      "--pattern",
      "SHA256SUMS",
      "--pattern",
      "openpcb-core.pub",
      "--dir",
      directory,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (result.error)
    throw new Error(
      "gh download unavailable; install gh or use --offline with an already verified pinned cache",
    );
  if (result.status !== 0)
    throw new Error(
      `gh release download failed (${result.status}); pinned release unchanged`,
    );
}

async function downloadFiles(
  options: FetchOptions,
  repository: string,
  pin: ReleasePin,
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "openpcb-corelib-"));
  try {
    await (options.download ?? ghDownload)({ repository, pin, directory });
    const expected = new Set([pin.artifact, "SHA256SUMS", "openpcb-core.pub"]);
    const names = readdirSync(directory);
    if (
      names.length !== expected.size ||
      names.some((name) => !expected.has(name))
    ) {
      throw new Error(
        "release download must contain exactly the pinned artifact, SHA256SUMS, and openpcb-core.pub",
      );
    }
    return readReleaseFiles(directory, pin);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function fetchCoreLibrary(options: FetchOptions) {
  const policy = readPolicy(options.repoRoot);
  const pin = requireRelease(policy);
  const args = options.args ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  checkOverrides(
    args,
    environment,
    policy.repository,
    pin,
    policy.minComponents,
  );
  const offline =
    args.includes("--offline") ||
    environment.OPENPCB_SKIP_CORELIB_FETCH === "1";
  const cacheDirectory = path.join(
    options.repoRoot,
    ".build",
    "core-library-cache",
    pin.sha256,
  );
  safeDirectory(options.repoRoot, cacheDirectory);
  const cached = existsSync(cacheDirectory);
  if (offline && !cached)
    throw new Error(
      "offline fetch requires an already verified pinned cache; run corelib:fetch online first",
    );
  const files = cached
    ? readReleaseFiles(cacheDirectory, pin)
    : await downloadFiles(options, policy.repository, pin);
  const summary = verifyRelease(files, policy, pin, options.repoRoot);
  const destinations = [
    path.join(options.repoRoot, ".build", "core-library"),
    path.join(options.repoRoot, "resources", "core-library"),
  ];
  for (const directory of destinations)
    checkDestination(options.repoRoot, directory, pin);
  publishVerified(
    options.repoRoot,
    destinations,
    cached ? null : cacheDirectory,
    files,
    pin,
  );
  return summary;
}
