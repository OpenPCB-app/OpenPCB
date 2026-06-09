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

// Cloud accepts desktop's exact command shape (positionNm in nanometers,
// rotationDeg, entityKind, etc.). The translation layer collapses to:
//   - forward command verbatim
//   - enrich place_part with resolved.pins from the library detail (desktop's
//     command schema lacks pins; cloud's handler accepts them as an optional
//     adapter-injected field)
// See feedback_source_of_truth memory for the architectural rationale.

const SCHEMATIC_COMMAND_TYPES = new Set([
  "place_part",
  "move_part",
  "rotate_part",
  "mirror_part",
  "update_part_properties",
  "update_parts_properties",
  "upsert_label",
  "create_wire",
  "create_wire_junction",
  "delete_entity",
  "place_gnd_port",
  "place_pwr_port",
  "place_net_portal",
  "move_primitive",
  "rotate_primitive",
  "update_primitive_text",
]);

interface CloudCommand {
  type: string;
  [k: string]: unknown;
}

function enrichCommand(
  desktopCmd: { type: string; [k: string]: unknown },
  placeComponentDetail: LibraryComponentPlacementDetail | null,
): CloudCommand | null {
  // PCB and other non-schematic commands not synced this phase.
  if (!SCHEMATIC_COMMAND_TYPES.has(desktopCmd.type)) return null;

  if (desktopCmd.type === "place_part" && placeComponentDetail) {
    return {
      ...desktopCmd,
      resolved: {
        pins: placeComponentDetail.symbol.pins.map((p, i) => ({
          id: p.number ?? p.name ?? `pin-${i}`,
          number: p.number ?? String(i + 1),
          name: p.name ?? p.number ?? `pin-${i}`,
          // Desktop's symbol pins use mm; convert to nm to match Cloud's
          // (desktop's) projection shape.
          localPositionNm: {
            x: Math.round(p.localPositionMm.x * 1_000_000),
            y: Math.round(p.localPositionMm.y * 1_000_000),
          },
        })),
      },
    };
  }
  return desktopCmd as CloudCommand;
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
    return;
  }
  // Accumulate the failure count (the previous implementation always reset it
  // to 1, masking repeated failures).
  const cur = db
    .select({ failedAttempts: cloudLink.failedAttempts })
    .from(cloudLink)
    .where(eq(cloudLink.designId, designId))
    .get();
  db.update(cloudLink)
    .set({
      failedAttempts: (cur?.failedAttempts ?? 0) + 1,
      lastError: err ?? "unknown",
    })
    .where(eq(cloudLink.designId, designId))
    .run();
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

  const cloudCommand = enrichCommand(
    opts.envelope.command as unknown as { type: string; [k: string]: unknown },
    opts.placeComponentDetail,
  );
  if (!cloudCommand) {
    logger.info("cloud-sync: skipping non-schematic command", {
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
    // A 409 means the cloud design has diverged from local (e.g. edited from
    // another device). Tag it distinctly so the UI can prompt a reconcile
    // rather than showing a generic error.
    const detail =
      res.status === 409
        ? "REVISION_CONFLICT (409): cloud design has diverged — reopen it from cloud to reconcile"
        : `${res.status} ${body.slice(0, 200)}`;
    recordSyncOutcome(db, opts.designId, false, opts.newRevision, detail);
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

/**
 * Remove the cloud link for a design (stop mirroring). The remote cloud design
 * is left intact; this only severs the local→cloud association.
 */
export function unlinkDesign(db: DbClient, designId: string): void {
  db.delete(cloudLink).where(eq(cloudLink.designId, designId)).run();
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
