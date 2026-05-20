import { eq } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { getDb } from "../queries";
import { releases, sources } from "../schema";
import { readOpclibFromPath } from "./opclib-reader";
import { importOpclib } from "./opclib-importer";
import { locateBundledOpclib } from "./package-locator";
import type { ImportResult, OpclibPackage } from "./types";

export interface BootstrapResult {
  imported: ImportResult | null;
  alreadyInstalled: boolean;
  bundledPath: string | null;
  userLocalSeeded: boolean;
}

const USER_LOCAL_SOURCE_ID = "user.local";

/**
 * Boot-time entry: ensures `openpcb.core` is installed from the bundled
 * `.opclib`, and seeds the `user.local` source row for forks/duplicates.
 *
 * Safe to call repeatedly; idempotent.
 */
export async function bootstrapCoreLibrary(
  ctx: CoreBackendModuleContext,
): Promise<BootstrapResult> {
  const userLocalSeeded = ensureUserLocalSource(ctx);

  const installed = listCoreReleases(ctx);
  const alreadyInstalled = installed.length > 0;
  const bundledPath = await locateBundledOpclib();

  if (alreadyInstalled && !bundledPath) {
    return {
      imported: null,
      alreadyInstalled,
      bundledPath: null,
      userLocalSeeded,
    };
  }

  if (!bundledPath) {
    ctx.logger.warn(
      "core-library: no bundled .opclib found and openpcb.core not installed; library will be empty",
    );
    return {
      imported: null,
      alreadyInstalled,
      bundledPath: null,
      userLocalSeeded,
    };
  }

  ctx.logger.info(
    `core-library: importing bundled package from ${bundledPath}`,
  );
  let pkg: OpclibPackage;
  try {
    pkg = await readOpclibFromPath(bundledPath);
  } catch (error) {
    ctx.logger.error("core-library: bundled .opclib unreadable; falling back", {
      bundledPath,
      error: (error as Error).message,
    });
    return { imported: null, alreadyInstalled, bundledPath, userLocalSeeded };
  }
  const shouldImport = shouldImportBundledRelease(installed, pkg);
  if (!shouldImport) {
    ctx.logger.info("core-library: bundled package already installed; skip");
    return { imported: null, alreadyInstalled, bundledPath, userLocalSeeded };
  }

  let imported: ImportResult;
  try {
    imported = await importOpclib(ctx, pkg, { installOrigin: "bundled" });
  } catch (error) {
    ctx.logger.error("core-library: import failed; falling back", {
      bundledPath,
      error: (error as Error).message,
    });
    return { imported: null, alreadyInstalled, bundledPath, userLocalSeeded };
  }
  ctx.logger.info(
    `core-library: imported ${imported.sourceId}@${imported.version} ` +
      `(symbols=${imported.inserted.symbols}+${imported.updated.symbols} ` +
      `footprints=${imported.inserted.footprints}+${imported.updated.footprints} ` +
      `components=${imported.inserted.components}+${imported.updated.components} ` +
      `variants=${imported.inserted.variants}+${imported.updated.variants})`,
  );
  return { imported, alreadyInstalled: false, bundledPath, userLocalSeeded };
}

interface InstalledRelease {
  version: string;
  packageSha256: string;
}

function listCoreReleases(ctx: CoreBackendModuleContext): InstalledRelease[] {
  const db = getDb(ctx);
  return db
    .select({
      version: releases.version,
      packageSha256: releases.packageSha256,
    })
    .from(releases)
    .where(eq(releases.sourceId, "openpcb.core"))
    .all();
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(value: string): ParsedSemver | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    return null;
  }
  return { major, minor, patch };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function pickLatestSemver(versions: string[]): ParsedSemver | null {
  let latest: ParsedSemver | null = null;
  for (const version of versions) {
    const parsed = parseSemver(version);
    if (!parsed) continue;
    if (!latest || compareSemver(parsed, latest) > 0) {
      latest = parsed;
    }
  }
  return latest;
}

function shouldImportBundledRelease(
  installed: InstalledRelease[],
  pkg: OpclibPackage,
): boolean {
  if (installed.length === 0) return true;
  const bundledVersion = pkg.manifest.library.version;
  const bundledSha = pkg.manifest.integrity.packageSha256;
  const exact = installed.find(
    (row) => row.version === bundledVersion && row.packageSha256 === bundledSha,
  );
  if (exact) return false;

  const sameVersion = installed.find((row) => row.version === bundledVersion);
  if (sameVersion) {
    return sameVersion.packageSha256 !== bundledSha;
  }

  const bundledParsed = parseSemver(bundledVersion);
  const latestInstalled = pickLatestSemver(installed.map((row) => row.version));
  if (bundledParsed && latestInstalled) {
    return compareSemver(bundledParsed, latestInstalled) > 0;
  }

  return true;
}

function ensureUserLocalSource(ctx: CoreBackendModuleContext): boolean {
  const db = getDb(ctx);
  const existing = db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.id, USER_LOCAL_SOURCE_ID))
    .get();
  if (existing) return false;

  db.insert(sources)
    .values({
      id: USER_LOCAL_SOURCE_ID,
      name: "Local Library",
      kind: "user",
      license: null,
      homepage: null,
      isReadOnly: 0,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
  return true;
}
