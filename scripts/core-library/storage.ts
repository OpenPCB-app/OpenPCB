import { constants } from "node:fs";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ZIP_LIMITS } from "@openpcb/opclib-pack";
import type { ReleasePin } from "./policy";
import { sha256, type ReleaseFiles } from "./verify";

export function safeDirectory(
  repoRoot: string,
  directory: string,
  create = false,
): void {
  const relative = path.relative(repoRoot, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("directory escapes repository");
  let current = repoRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(`unsafe artifact directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (create) mkdirSync(current);
    }
  }
}

function readRegularFile(filename: string, maxBytes: number): Buffer {
  const descriptor = openSync(
    filename,
    // Refuse special files without blocking on a poisoned FIFO cache entry.
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error(`unsafe or oversized release file: ${filename}`);
    const bytes = readFileSync(descriptor);
    if (bytes.length > maxBytes)
      throw new Error(`oversized release file: ${filename}`);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export function readReleaseFiles(
  directory: string,
  pin: ReleasePin,
): ReleaseFiles {
  return {
    artifact: readRegularFile(
      path.join(directory, pin.artifact),
      ZIP_LIMITS.maxArchiveBytes,
    ),
    sums: readRegularFile(
      path.join(directory, "SHA256SUMS"),
      1024 * 1024,
    ).toString("utf8"),
    publicKey: readRegularFile(
      path.join(directory, "openpcb-core.pub"),
      16 * 1024,
    ),
  };
}

export function checkDestination(
  repoRoot: string,
  directory: string,
  pin: ReleasePin,
): void {
  safeDirectory(repoRoot, directory);
  if (!existsSync(directory)) return;
  for (const filename of readdirSync(directory)) {
    if (
      !filename.endsWith(".opclib") &&
      filename !== "SHA256SUMS" &&
      filename !== "openpcb-core.pub"
    )
      continue;
    const target = path.join(directory, filename);
    if (!lstatSync(target).isFile())
      throw new Error(`unsafe artifact destination: ${target}`);
    if (
      filename === pin.artifact &&
      sha256(readRegularFile(target, ZIP_LIMITS.maxArchiveBytes)) !== pin.sha256
    ) {
      throw new Error(
        `poisoned artifact destination: ${target}; remove it explicitly and fetch again`,
      );
    }
  }
}

interface StagedDirectory {
  directory: string;
  stage: string;
  filenames: string[];
}

function stageFiles(
  repoRoot: string,
  directory: string,
  files: ReleaseFiles,
  pin: ReleasePin,
  cache: boolean,
): StagedDirectory {
  safeDirectory(repoRoot, directory, true);
  const stage = mkdtempSync(path.join(directory, ".verified-"));
  const payloads: Array<[string, Uint8Array | string]> = [
    [pin.artifact, files.artifact],
    ["SHA256SUMS", files.sums],
  ];
  if (cache) payloads.push(["openpcb-core.pub", files.publicKey]);
  try {
    for (const [filename, bytes] of payloads)
      writeFileSync(path.join(stage, filename), bytes, {
        flag: "wx",
        mode: 0o644,
      });
    return {
      directory,
      stage,
      filenames: payloads.map(([filename]) => filename),
    };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function publishVerified(
  repoRoot: string,
  destinations: string[],
  cacheDirectory: string | null,
  files: ReleaseFiles,
  pin: ReleasePin,
): void {
  const targets = cacheDirectory
    ? [cacheDirectory, ...destinations]
    : destinations;
  for (const target of targets) checkDestination(repoRoot, target, pin);
  const staged: StagedDirectory[] = [];
  try {
    for (const target of targets)
      staged.push(
        stageFiles(repoRoot, target, files, pin, target === cacheDirectory),
      );
    for (const entry of staged) {
      for (const filename of entry.filenames)
        renameSync(
          path.join(entry.stage, filename),
          path.join(entry.directory, filename),
        );
    }
    for (const target of destinations) {
      for (const filename of readdirSync(target)) {
        if (filename.endsWith(".opclib") && filename !== pin.artifact)
          rmSync(path.join(target, filename));
      }
    }
  } finally {
    for (const entry of staged)
      rmSync(entry.stage, { recursive: true, force: true });
  }
}
