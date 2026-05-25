import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { ValidationError } from "../../../../core/contracts/errors";
import { getDb } from "../queries";
import { components, releases } from "../schema";
import { importOpclib } from "./opclib-importer";
import { locateBundledOpclib } from "./package-locator";
import { readOpclibFromBytes, readOpclibFromPath } from "./opclib-reader";
import type { ImportResult, OpclibManifest } from "./types";
import { compareSemverVersions, isPrereleaseVersion } from "./semver";

const CORE_SOURCE_ID = "openpcb.core";
const MAX_OPCLIB_BYTES = 256 * 1024 * 1024;
const DEFAULT_MIN_CORE_COMPONENTS = 10;

export type CoreLibraryUpdateState =
  | "missing"
  | "up_to_date"
  | "bundled_update_available"
  | "error";

export interface CoreLibraryReleaseSummary {
  sourceId: string;
  version: string;
  channel: string;
  packageSha256: string;
  signatureValid: boolean;
  installedAt: string;
  componentCount: number;
}

export interface CoreLibraryPackageSummary {
  path: string;
  version: string;
  channel: string;
  packageSha256: string;
  signaturePresent: boolean;
  keyId: string | null;
  componentCount: number;
  generatedAt: string;
}

export interface CoreLibraryStatus {
  sourceId: typeof CORE_SOURCE_ID;
  state: CoreLibraryUpdateState;
  installed: CoreLibraryReleaseSummary | null;
  bundled: CoreLibraryPackageSummary | null;
  error: string | null;
}

export interface CoreLibraryStatusOptions {
  repoRoot?: string;
  electronResources?: string | null;
  nodeEnv?: string;
}

export type CoreLibraryCheckState =
  | CoreLibraryUpdateState
  | "remote_update_available";

export interface CoreLibraryRemoteReleaseSummary {
  version: string;
  tagName: string;
  releaseUrl: string;
  opclibAssetUrl: string;
  opclibAssetName: string;
  sha256SumsAssetUrl: string | null;
  publishedAt: string | null;
}

export interface CoreLibraryCheckResult {
  sourceId: typeof CORE_SOURCE_ID;
  state: CoreLibraryCheckState;
  installed: CoreLibraryReleaseSummary | null;
  bundled: CoreLibraryPackageSummary | null;
  remote: CoreLibraryRemoteReleaseSummary | null;
  error: string | null;
}

export interface CoreLibraryCheckOptions extends CoreLibraryStatusOptions {
  fetchImpl?: FetchLike;
  repoOwner?: string;
  repoName?: string;
}

export interface CoreLibraryUpdateOptions extends CoreLibraryCheckOptions {
  minComponentCount?: number;
}

export interface CoreLibraryUpdateResult {
  state: CoreLibraryCheckState;
  remote: CoreLibraryRemoteReleaseSummary | null;
  imported: ImportResult | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

interface ReleaseRow {
  version: string;
  channel: string;
  packageSha256: string;
  signatureValid: number;
  installedAt: string;
  manifestJson: string;
}

export async function getCoreLibraryStatus(
  ctx: CoreBackendModuleContext,
  options: CoreLibraryStatusOptions = {},
): Promise<CoreLibraryStatus> {
  const installed = getInstalledCoreRelease(ctx);
  let bundled: CoreLibraryPackageSummary | null = null;
  let error: string | null = null;

  try {
    const bundledPath = await locateBundledOpclib(options);
    if (bundledPath) bundled = await summarizeBundledPackage(bundledPath);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to inspect bundled CoreLibrary";
  }

  return {
    sourceId: CORE_SOURCE_ID,
    state: deriveState(installed, bundled, error),
    installed,
    bundled,
    error,
  };
}

export async function checkCoreLibraryUpdates(
  ctx: CoreBackendModuleContext,
  options: CoreLibraryCheckOptions = {},
): Promise<CoreLibraryCheckResult> {
  const status = await getCoreLibraryStatus(ctx, options);
  let remote: CoreLibraryRemoteReleaseSummary | null = null;
  let error = status.error;
  try {
    remote = await fetchLatestStableRemoteRelease(options);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to check CoreLibrary releases";
  }

  return {
    ...status,
    state: deriveCheckState(status, remote, error),
    remote,
    error,
  };
}

export async function updateCoreLibrary(
  ctx: CoreBackendModuleContext,
  options: CoreLibraryUpdateOptions = {},
): Promise<CoreLibraryUpdateResult> {
  const check = await checkCoreLibraryUpdates(ctx, options);
  if (check.state !== "remote_update_available" || !check.remote) {
    return { state: check.state, remote: check.remote, imported: null };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const opclibBytes = await downloadBytes(fetchImpl, check.remote.opclibAssetUrl);
  if (opclibBytes.byteLength === 0) {
    throw new ValidationError("downloaded CoreLibrary package is empty");
  }
  if (opclibBytes.byteLength > MAX_OPCLIB_BYTES) {
    throw new ValidationError(`CoreLibrary package exceeds ${MAX_OPCLIB_BYTES} byte limit`);
  }
  if (!check.remote.sha256SumsAssetUrl) {
    throw new ValidationError("CoreLibrary release is missing SHA256SUMS asset");
  }
  const sumsBytes = await downloadBytes(fetchImpl, check.remote.sha256SumsAssetUrl);
  verifySha256Sums(
    new TextDecoder().decode(sumsBytes),
    check.remote.opclibAssetName,
    opclibBytes,
  );

  let pkg;
  try {
    pkg = readOpclibFromBytes(opclibBytes);
  } catch (caught) {
    throw new ValidationError(`invalid CoreLibrary package: ${(caught as Error).message}`);
  }
  validateCorePackage(pkg.manifest, check.remote, options);

  const requireSignature = shouldRequireSignature(options.nodeEnv);
  const imported = await importOpclib(ctx, pkg, {
    installOrigin: "sync",
    requireSignature,
  });
  return { state: "remote_update_available", remote: check.remote, imported };
}

function getInstalledCoreRelease(
  ctx: CoreBackendModuleContext,
): CoreLibraryReleaseSummary | null {
  const db = getDb(ctx);
  const rows = db
    .select({
      version: releases.version,
      channel: releases.channel,
      packageSha256: releases.packageSha256,
      signatureValid: releases.signatureValid,
      installedAt: releases.installedAt,
      manifestJson: releases.manifestJson,
    })
    .from(releases)
    .where(eq(releases.sourceId, CORE_SOURCE_ID))
    .all();
  const latest = pickLatestRelease(rows);
  if (!latest) return null;
  return {
    sourceId: CORE_SOURCE_ID,
    version: latest.version,
    channel: latest.channel,
    packageSha256: latest.packageSha256,
    signatureValid: latest.signatureValid === 1,
    installedAt: latest.installedAt,
    componentCount: getCoreComponentCount(ctx),
  };
}

function pickLatestRelease(rows: ReleaseRow[]): ReleaseRow | null {
  let latest: ReleaseRow | null = null;
  for (const row of rows) {
    if (!latest) {
      latest = row;
      continue;
    }
    const versionCompare = compareSemverVersions(row.version, latest.version);
    if (versionCompare > 0) {
      latest = row;
    } else if (
      versionCompare === 0 &&
      row.installedAt.localeCompare(latest.installedAt) > 0
    ) {
      latest = row;
    }
  }
  return latest;
}

function getCoreComponentCount(ctx: CoreBackendModuleContext): number {
  const db = getDb(ctx);
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(components)
    .where(eq(components.sourceId, CORE_SOURCE_ID))
    .get();
  return Number(row?.count ?? 0);
}

async function summarizeBundledPackage(
  packagePath: string,
): Promise<CoreLibraryPackageSummary> {
  const pkg = await readOpclibFromPath(packagePath);
  const manifest = pkg.manifest as OpclibManifest;
  return {
    path: packagePath,
    version: manifest.library.version,
    channel: manifest.library.channel,
    packageSha256: manifest.integrity.packageSha256,
    signaturePresent: Boolean(manifest.signature),
    keyId: manifest.signature?.keyId ?? null,
    componentCount: manifest.components.length,
    generatedAt: manifest.library.generatedAt,
  };
}

function deriveState(
  installed: CoreLibraryReleaseSummary | null,
  bundled: CoreLibraryPackageSummary | null,
  error: string | null,
): CoreLibraryUpdateState {
  if (error) return "error";
  if (!installed && !bundled) return "missing";
  if (!installed && bundled) return "bundled_update_available";
  if (installed && !bundled) return "up_to_date";
  if (!installed || !bundled) return "missing";
  if (
    bundled.version === installed.version &&
    bundled.packageSha256 !== installed.packageSha256
  ) {
    return "bundled_update_available";
  }
  return compareSemverVersions(bundled.version, installed.version) > 0
    ? "bundled_update_available"
    : "up_to_date";
}

async function fetchLatestStableRemoteRelease(
  options: CoreLibraryCheckOptions,
): Promise<CoreLibraryRemoteReleaseSummary | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const owner = options.repoOwner ?? "OpenPCB-app";
  const repo = options.repoName ?? "CoreLibrary";
  const response = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "OpenPCB-CoreLibrary-Updater",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub releases check failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases response must be an array");
  }

  const candidates = payload
    .map(readStableRelease)
    .filter(
      (release): release is CoreLibraryRemoteReleaseSummary => release !== null,
    );
  candidates.sort((a, b) => compareSemverVersions(b.version, a.version));
  return candidates[0] ?? null;
}

function readStableRelease(
  release: unknown,
): CoreLibraryRemoteReleaseSummary | null {
  if (!isRecord(release)) return null;
  const row = release as GitHubRelease;
  if (row.draft === true || row.prerelease === true) return null;
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const opclib = assets.map(readAsset).find((asset) => asset?.name.endsWith(".opclib"));
  if (!opclib) return null;
  const version = versionFromAssetName(opclib.name) ?? versionFromTag(row.tag_name);
  if (!version || isPrereleaseVersion(version)) return null;
  const sums = assets
    .map(readAsset)
    .find((asset) => asset?.name === "SHA256SUMS");
  return {
    version,
    tagName: typeof row.tag_name === "string" ? row.tag_name : version,
    releaseUrl: typeof row.html_url === "string" ? row.html_url : "",
    opclibAssetUrl: opclib.url,
    opclibAssetName: opclib.name,
    sha256SumsAssetUrl: sums?.url ?? null,
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
  };
}

function readAsset(
  asset: unknown,
): { name: string; url: string } | null {
  if (!isRecord(asset)) return null;
  const row = asset as GitHubReleaseAsset;
  if (typeof row.name !== "string") return null;
  if (typeof row.browser_download_url !== "string") return null;
  return { name: row.name, url: row.browser_download_url };
}

function versionFromAssetName(name: string): string | null {
  const match = name.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.opclib$/);
  return match?.[1] ?? null;
}

function versionFromTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? null;
}

function deriveCheckState(
  status: CoreLibraryStatus,
  remote: CoreLibraryRemoteReleaseSummary | null,
  error: string | null,
): CoreLibraryCheckState {
  if (error) return "error";
  const baseline = status.installed?.version ?? status.bundled?.version ?? null;
  if (remote && (!baseline || compareSemverVersions(remote.version, baseline) > 0)) {
    return "remote_update_available";
  }
  return status.state;
}

async function downloadBytes(
  fetchImpl: FetchLike,
  url: string,
): Promise<Uint8Array> {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) {
    throw new ValidationError(`download failed: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_OPCLIB_BYTES) {
    throw new ValidationError(`download exceeds ${MAX_OPCLIB_BYTES} byte limit`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function verifySha256Sums(
  sumsText: string,
  filename: string,
  bytes: Uint8Array,
): void {
  const expected = sumsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/))
    .find((match) => match?.[2] === filename)?.[1]
    ?.toLowerCase();
  if (!expected) {
    throw new ValidationError(`SHA256SUMS does not contain ${filename}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new ValidationError(
      `CoreLibrary package SHA256 mismatch: expected ${expected} got ${actual}`,
    );
  }
}

function validateCorePackage(
  manifest: OpclibManifest,
  remote: CoreLibraryRemoteReleaseSummary,
  options: CoreLibraryUpdateOptions,
): void {
  if (manifest.library.id !== CORE_SOURCE_ID) {
    throw new ValidationError(`CoreLibrary package has unexpected id ${manifest.library.id}`);
  }
  if (manifest.library.version !== remote.version) {
    throw new ValidationError(
      `CoreLibrary package version ${manifest.library.version} does not match release ${remote.version}`,
    );
  }
  if (manifest.library.channel !== "stable") {
    throw new ValidationError(`CoreLibrary package channel must be stable, got ${manifest.library.channel}`);
  }
  const minCount = options.minComponentCount ?? DEFAULT_MIN_CORE_COMPONENTS;
  if (manifest.components.length < minCount) {
    throw new ValidationError(
      `CoreLibrary package contains only ${manifest.components.length} components; expected at least ${minCount}`,
    );
  }
  if (shouldRequireSignature(options.nodeEnv) && !manifest.signature) {
    throw new ValidationError("CoreLibrary package is unsigned");
  }
}

function shouldRequireSignature(nodeEnv?: string): boolean {
  return (nodeEnv ?? process.env.NODE_ENV) === "production";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
