/**
 * Runtime install entry: accept .opclib bytes (uploaded file or fetched URL)
 * and route them through the same importer that bootstrap uses.
 *
 * Policy:
 *  - File uploads: trust caller, but still verify signature; warn-only in dev
 *    unless OPENPCB_REQUIRE_SIGNED_OPCLIB=1.
 *  - URL installs: only https:// allowed, hostname allowlist from env
 *    OPENPCB_LIBRARY_INSTALL_ALLOWLIST (comma-separated). Defaults to
 *    `github.com,objects.githubusercontent.com,api.github.com`.
 */
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { ValidationError } from "../../../../core/contracts/errors";
import { readOpclibFromBytes } from "./opclib-reader";
import { importOpclib } from "./opclib-importer";
import type { ImportResult, InstallOrigin } from "./types";

const DEFAULT_ALLOWLIST = [
  "github.com",
  "objects.githubusercontent.com",
  "api.github.com",
];

function getAllowlist(): string[] {
  const env = process.env.OPENPCB_LIBRARY_INSTALL_ALLOWLIST;
  if (!env) return DEFAULT_ALLOWLIST;
  return env
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const MAX_OPCLIB_BYTES = 256 * 1024 * 1024; // 256 MB

export interface InstallFromBytesInput {
  bytes: Uint8Array;
  installOrigin?: InstallOrigin;
}

export async function installOpclibFromBytes(
  ctx: CoreBackendModuleContext,
  input: InstallFromBytesInput,
): Promise<ImportResult> {
  if (input.bytes.byteLength === 0) {
    throw new ValidationError("empty .opclib payload");
  }
  if (input.bytes.byteLength > MAX_OPCLIB_BYTES) {
    throw new ValidationError(`.opclib exceeds ${MAX_OPCLIB_BYTES} byte limit`);
  }
  let pkg;
  try {
    pkg = readOpclibFromBytes(input.bytes);
  } catch (err) {
    throw new ValidationError(`invalid .opclib: ${(err as Error).message}`);
  }
  return importOpclib(ctx, pkg, {
    installOrigin: input.installOrigin ?? "manual-import",
  });
}

export async function installOpclibFromUrl(
  ctx: CoreBackendModuleContext,
  url: string,
): Promise<ImportResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`invalid url: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new ValidationError("only https:// URLs are accepted");
  }
  const allowlist = getAllowlist();
  if (!allowlist.includes(parsed.hostname.toLowerCase())) {
    throw new ValidationError(
      `host not in allowlist: ${parsed.hostname}. Configure OPENPCB_LIBRARY_INSTALL_ALLOWLIST to add hosts.`,
    );
  }

  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (err) {
    throw new ValidationError(
      `failed to fetch ${url}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new ValidationError(`fetch ${url} returned HTTP ${res.status}`);
  }
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_OPCLIB_BYTES) {
    throw new ValidationError(`.opclib exceeds ${MAX_OPCLIB_BYTES} byte limit`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return installOpclibFromBytes(ctx, {
    bytes: buf,
    installOrigin: "sync",
  });
}
