// Outbound + inbound sync of the user's CUSTOM component library to OpenPCB
// Cloud. Push: pack custom components (cloud-pack-builder) → multipart upload to
// cloud-api → record state. Pull: download the workspace's latest .opclib →
// import via the existing opclib importer. The bearer token + API URL are
// passed per-request (x-cloud-bearer / x-cloud-api-url) and never stored.
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { buildUserLibraryPack } from "./cloud-pack-builder";
import { getDb } from "./queries";
import { cloudSync } from "./schema";
import { readOpclibFromBytes } from "./sync/opclib-reader";
import { importOpclib } from "./sync/opclib-importer";
import type { LibraryCloudSyncState } from "./cloud-sync-types";

type Db = BetterSQLite3Database<Record<string, unknown>>;
type Logger = {
  info: (m: string, x?: unknown) => void;
  warn: (m: string, x?: unknown) => void;
  error: (m: string, x?: unknown) => void;
};

const STATE_ID = "default";

export interface CloudCreds {
  bearer: string;
  apiUrl: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readState(db: Db): typeof cloudSync.$inferSelect | null {
  return (
    db.select().from(cloudSync).where(eq(cloudSync.id, STATE_ID)).get() ?? null
  );
}

function upsertState(
  db: Db,
  fields: Partial<typeof cloudSync.$inferInsert>,
): void {
  const existing = readState(db);
  if (existing) {
    db.update(cloudSync).set(fields).where(eq(cloudSync.id, STATE_ID)).run();
  } else {
    db.insert(cloudSync)
      .values({ id: STATE_ID, componentCount: 0, failedAttempts: 0, ...fields })
      .run();
  }
}

export function getLibrarySyncState(db: Db): LibraryCloudSyncState {
  const row = readState(db);
  return {
    lastSyncedPackId: row?.lastPackId ?? null,
    lastSyncedPackSha256: row?.lastPackageSha256 ?? null,
    lastSyncedAt: row?.lastSyncedAt ?? null,
    failedAttempts: row?.failedAttempts ?? 0,
    lastError: row?.lastError ?? null,
  };
}

async function resolvePersonalWorkspace(creds: CloudCreds): Promise<string> {
  const res = await fetch(`${creds.apiUrl}/v1/workspaces/me/personal`, {
    headers: { authorization: `Bearer ${creds.bearer}` },
  });
  if (!res.ok) {
    throw new Error(
      `workspace resolve failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
}

export interface SyncResult {
  componentCount: number;
  uploaded: boolean;
  packId?: string;
  packageSha256?: string;
}

/** Push all custom components to the user's personal cloud workspace. */
export async function syncCustomLibrary(
  db: Db,
  logger: Logger,
  creds: CloudCreds,
): Promise<SyncResult> {
  const built = await buildUserLibraryPack(db, nowIso());
  if (!built) {
    upsertState(db, {
      componentCount: 0,
      lastSyncedAt: nowIso(),
      failedAttempts: 0,
      lastError: null,
    });
    return { componentCount: 0, uploaded: false };
  }

  try {
    const workspaceId = await resolvePersonalWorkspace(creds);
    const form = new FormData();
    form.append("manifest", JSON.stringify(built.result.manifest));
    form.append(
      "package",
      new Blob([built.result.bytes], { type: "application/zip" }),
      "custom-library.opclib",
    );
    const res = await fetch(
      `${creds.apiUrl}/v1/library/workspaces/${workspaceId}/packs`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${creds.bearer}` },
        body: form,
      },
    );
    if (!res.ok) {
      throw new Error(
        `upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const body = (await res.json()) as { pack: { packId: string } };
    upsertState(db, {
      cloudWorkspaceId: workspaceId,
      lastPackId: body.pack.packId,
      lastPackageSha256: built.result.packageSha256,
      componentCount: built.componentCount,
      lastSyncedAt: nowIso(),
      failedAttempts: 0,
      lastError: null,
    });
    logger.info("library cloud-sync: uploaded", {
      workspaceId,
      packId: body.pack.packId,
      componentCount: built.componentCount,
    });
    return {
      componentCount: built.componentCount,
      uploaded: true,
      packId: body.pack.packId,
      packageSha256: built.result.packageSha256,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const prior = readState(db);
    upsertState(db, {
      failedAttempts: (prior?.failedAttempts ?? 0) + 1,
      lastError: message,
    });
    logger.error("library cloud-sync: failed", { error: message });
    throw err;
  }
}

export interface PullResult {
  imported: boolean;
  components: number;
}

/** Pull the workspace's latest custom-library pack and import it locally. */
export async function pullCustomLibrary(
  ctx: CoreBackendModuleContext,
  creds: CloudCreds,
): Promise<PullResult> {
  const workspaceId = await resolvePersonalWorkspace(creds);
  const listRes = await fetch(
    `${creds.apiUrl}/v1/library/workspaces/${workspaceId}/packs`,
    { headers: { authorization: `Bearer ${creds.bearer}` } },
  );
  if (!listRes.ok) {
    throw new Error(
      `list packs failed: ${listRes.status} ${(await listRes.text()).slice(0, 200)}`,
    );
  }
  const { packs } = (await listRes.json()) as {
    packs: Array<{ packId: string }>;
  };
  if (packs.length === 0) return { imported: false, components: 0 };

  const latest = packs[0]!; // cloud returns newest-first
  const dlRes = await fetch(
    `${creds.apiUrl}/v1/library/workspaces/${workspaceId}/packs/${latest.packId}/download`,
    { headers: { authorization: `Bearer ${creds.bearer}` } },
  );
  if (!dlRes.ok) {
    throw new Error(
      `download failed: ${dlRes.status} ${(await dlRes.text()).slice(0, 200)}`,
    );
  }
  const { url } = (await dlRes.json()) as { url: string };
  const blobRes = await fetch(url);
  if (!blobRes.ok) {
    throw new Error(`storage fetch failed: ${blobRes.status}`);
  }
  const bytes = new Uint8Array(await blobRes.arrayBuffer());
  const pkg = readOpclibFromBytes(bytes);
  // User libraries are unsigned and locally trusted (the user authored them).
  const result = await importOpclib(ctx, pkg, {
    installOrigin: "sync",
    requireSignature: false,
  });
  const components = result.inserted.components + result.updated.components;
  ctx.logger.info("library cloud-sync: pulled", {
    workspaceId,
    packId: latest.packId,
    components,
  });
  return { imported: true, components };
}
