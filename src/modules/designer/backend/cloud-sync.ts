// Outbound sync: mirror locally-applied designer commands to the Cloud Hono
// backend. Fire-and-forget — failures don't block the local write. The link
// row tracks last_synced_revision + failed_attempts for diagnostics; future
// retry/queue logic uses these.
//
// The token + Cloud API URL come from the request that triggered the command
// (renderer passes `x-cloud-bearer` + `x-cloud-api-url`). Backend never stores
// the token.

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  LibraryComponentPlacementDetail,
} from "../../../sdks";
import { cloudLink } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

export interface CloudSyncContext {
  cloudBearer?: string;
  cloudApiUrl?: string;
}

interface MirrorOptions {
  designId: string;
  envelope: DesignerCommandEnvelope;
  newRevision: number;
  createdEntityId: string | null;
  placeComponentDetail: LibraryComponentPlacementDetail | null;
  ctx: CloudSyncContext;
}

// Desktop uses nanometers everywhere; Cloud's schematic projection is in mm.
function nmToMm(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x / 1_000_000, y: p.y / 1_000_000 };
}

interface CloudCommand {
  type: string;
  [k: string]: unknown;
}

// Map a desktop-shaped command to the Cloud handler shape. Returns null when
// the command is not (yet) sync-supported — caller skips mirror in that case.
function translateCommand(
  desktopCmd: { type: string; [k: string]: unknown },
  newRevision: number,
  createdEntityId: string | null,
  placeComponentDetail: LibraryComponentPlacementDetail | null,
): CloudCommand | null {
  switch (desktopCmd.type) {
    case "place_part": {
      const partId = createdEntityId;
      if (!partId) return null;
      const positionNm = desktopCmd.positionNm as { x: number; y: number };
      const componentId = String(desktopCmd.componentId);
      if (!placeComponentDetail) return null;
      const pins = placeComponentDetail.symbol.pins.map((p, i) => ({
        id: p.number ?? p.name ?? `pin-${i}`,
        name: p.name ?? p.number ?? `pin-${i}`,
        localPosition: nmToMm({
          x: p.localPositionMm.x * 1_000_000,
          y: p.localPositionMm.y * 1_000_000,
        }),
      }));
      return {
        type: "place_part",
        partId,
        componentId,
        componentVersionId: componentId,
        position: nmToMm(positionNm),
        rotation: (desktopCmd.rotationDeg as number) ?? 0,
        mirrored: desktopCmd.mirrored === true,
        resolved: { pins },
      };
    }
    case "move_part": {
      const positionNm = desktopCmd.positionNm as { x: number; y: number };
      return {
        type: "move_part",
        partId: String(desktopCmd.partId),
        position: nmToMm(positionNm),
      };
    }
    case "upsert_label": {
      const labelId =
        (desktopCmd.labelId as string | undefined) ?? createdEntityId;
      if (!labelId) return null;
      const positionNm = desktopCmd.positionNm as { x: number; y: number };
      return {
        type: "create_label",
        labelId,
        text: String(desktopCmd.text),
        position: nmToMm(positionNm),
      };
    }
    case "delete_entity": {
      // Desktop entityKind = "part" | "wire" | "label" | …
      const kind = String(desktopCmd.entityKind);
      const id = String(desktopCmd.entityId);
      if (kind === "part") {
        return { type: "delete_part", partId: id };
      }
      // wire/label deletes not yet wired on Cloud — skip cleanly.
      return null;
    }
    default:
      return null;
  }
  void newRevision;
}

interface LinkRow {
  designId: string;
  cloudDesignId: string;
  lastSyncedRevision: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readLink(db: DbClient, designId: string): LinkRow | null {
  const row = db
    .select({
      designId: cloudLink.designId,
      cloudDesignId: cloudLink.cloudDesignId,
      lastSyncedRevision: cloudLink.lastSyncedRevision,
    })
    .from(cloudLink)
    .where(eq(cloudLink.designId, designId))
    .get();
  return row ?? null;
}

async function recordSyncOutcome(
  db: DbClient,
  designId: string,
  ok: boolean,
  revision: number,
  err?: string,
): Promise<void> {
  if (ok) {
    db.update(cloudLink)
      .set({ lastSyncedRevision: revision, failedAttempts: 0, lastError: null })
      .where(eq(cloudLink.designId, designId))
      .run();
  } else {
    const cur = readLink(db, designId);
    db.update(cloudLink)
      .set({
        failedAttempts: (cur ? 0 : 0) + 1,
        lastError: err ?? "unknown",
      })
      .where(eq(cloudLink.designId, designId))
      .run();
  }
}

export async function mirrorCommand(
  db: DbClient,
  logger: {
    info: (m: string, x?: unknown) => void;
    warn: (m: string, x?: unknown) => void;
    error: (m: string, x?: unknown) => void;
  },
  opts: MirrorOptions,
): Promise<void> {
  const link = readLink(db, opts.designId);
  if (!link) return; // not linked → nothing to mirror

  const bearer = opts.ctx.cloudBearer;
  const apiUrl = opts.ctx.cloudApiUrl;
  if (!bearer || !apiUrl) {
    logger.warn("cloud-sync: link exists but no bearer/apiUrl on request", {
      designId: opts.designId,
    });
    return;
  }

  const cloudCommand = translateCommand(
    opts.envelope.command as unknown as { type: string; [k: string]: unknown },
    opts.newRevision,
    opts.createdEntityId,
    opts.placeComponentDetail,
  );
  if (!cloudCommand) {
    logger.info("cloud-sync: skipping unsupported command", {
      type: opts.envelope.command.type,
    });
    return;
  }

  const cloudEnvelope = {
    commandId: opts.envelope.commandId,
    sessionId: opts.envelope.sessionId,
    aggregateId: link.cloudDesignId,
    baseRevision: opts.newRevision - 1,
    issuedAt: opts.envelope.issuedAt,
    command: cloudCommand,
  };

  try {
    const res = await fetch(
      `${apiUrl}/v1/designs/${link.cloudDesignId}/commands`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(cloudEnvelope),
      },
    );
    if (res.ok) {
      recordSyncOutcome(db, opts.designId, true, opts.newRevision);
      logger.info("cloud-sync: mirrored", {
        designId: opts.designId,
        cloudDesignId: link.cloudDesignId,
        revision: opts.newRevision,
      });
      return;
    }
    const body = await res.text();
    logger.warn("cloud-sync: cloud rejected", {
      status: res.status,
      body: body.slice(0, 300),
    });
    recordSyncOutcome(
      db,
      opts.designId,
      false,
      opts.newRevision,
      `${res.status} ${body.slice(0, 200)}`,
    );
  } catch (err) {
    logger.error("cloud-sync: network error", {
      err: err instanceof Error ? err.message : String(err),
    });
    recordSyncOutcome(
      db,
      opts.designId,
      false,
      opts.newRevision,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface LinkParams {
  designId: string;
  designName: string;
  bearer: string;
  apiUrl: string;
  // If provided, link to this existing cloud design instead of creating one.
  // Used by the import-from-cloud flow.
  existingCloudDesignId?: string;
  lastSyncedRevision?: number;
}

export async function linkDesignToCloud(
  db: DbClient,
  params: LinkParams,
): Promise<{ cloudDesignId: string; workspaceId: string; userId: string }> {
  const existing = readLink(db, params.designId);
  if (existing) {
    return {
      cloudDesignId: existing.cloudDesignId,
      workspaceId: "",
      userId: "",
    };
  }

  // 1) Resolve user's personal workspace.
  const wsRes = await fetch(`${params.apiUrl}/v1/workspaces/me/personal`, {
    headers: { authorization: `Bearer ${params.bearer}` },
  });
  if (!wsRes.ok) {
    throw new Error(
      `cloud-link: workspace fetch failed: ${wsRes.status} ${await wsRes.text()}`,
    );
  }
  const wsBody = (await wsRes.json()) as { id: string };

  // 2) Get current user id via /v1/me.
  const meRes = await fetch(`${params.apiUrl}/v1/me`, {
    headers: { authorization: `Bearer ${params.bearer}` },
  });
  if (!meRes.ok) {
    throw new Error(
      `cloud-link: /v1/me failed: ${meRes.status} ${await meRes.text()}`,
    );
  }
  const meBody = (await meRes.json()) as { id: string };

  // 3) Create the cloud design — unless we're linking to an existing one.
  let cloudDesignId: string;
  if (params.existingCloudDesignId) {
    cloudDesignId = params.existingCloudDesignId;
  } else {
    const designRes = await fetch(
      `${params.apiUrl}/v1/designs/workspaces/${wsBody.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${params.bearer}`,
        },
        body: JSON.stringify({ name: params.designName }),
      },
    );
    if (!designRes.ok) {
      throw new Error(
        `cloud-link: create-design failed: ${designRes.status} ${await designRes.text()}`,
      );
    }
    cloudDesignId = ((await designRes.json()) as { id: string }).id;
  }
  const designBody = { id: cloudDesignId };

  // 4) Persist the link.
  db.insert(cloudLink)
    .values({
      designId: params.designId,
      cloudDesignId: designBody.id,
      cloudWorkspaceId: wsBody.id,
      cloudUserId: meBody.id,
      lastSyncedRevision: params.lastSyncedRevision ?? -1,
      linkedAt: nowIso(),
      failedAttempts: 0,
      lastError: null,
    })
    .run();

  return {
    cloudDesignId: designBody.id,
    workspaceId: wsBody.id,
    userId: meBody.id,
  };
}

export function readLinkPublic(
  db: DbClient,
  designId: string,
): {
  cloudDesignId: string;
  workspaceId: string;
  userId: string;
  lastSyncedRevision: number;
  linkedAt: string;
  failedAttempts: number;
  lastError: string | null;
} | null {
  const row = db
    .select()
    .from(cloudLink)
    .where(eq(cloudLink.designId, designId))
    .get();
  if (!row) return null;
  return {
    cloudDesignId: row.cloudDesignId,
    workspaceId: row.cloudWorkspaceId,
    userId: row.cloudUserId,
    lastSyncedRevision: row.lastSyncedRevision,
    linkedAt: row.linkedAt,
    failedAttempts: row.failedAttempts,
    lastError: row.lastError,
  };
}
