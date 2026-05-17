/**
 * Attach KiCad 3D model files (.step / .stp) bundled in the project ZIP to
 * the matching footprint rows ingested by `commitKicadImport`.
 *
 * KiCad references models from `(model ...)` blocks inside `(footprint ...)`,
 * e.g. `${KIPRJMOD}/3dmodels/foo.step`. We resolve the basename inside the
 * project ZIP — KiCad ZIPs frequently bundle their 3dmodels/ directory next
 * to the .kicad_pcb file, so basename matching is sufficient for v1.
 *
 * The model is content-addressed (sha-256) and written via the existing
 * library `writeSourceStep` helper. A pending `footprint_models` row is then
 * inserted/updated so the frontend converter queue picks it up.
 *
 * Silent skip when:
 *   - The footprint had no model refs.
 *   - The referenced .step/.stp is not bundled (KiCad uses absolute paths
 *     that won't resolve outside the user's machine).
 *   - The library footprint row cannot be resolved (e.g. ingestion reused a
 *     pre-existing component without a footprint).
 */

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  footprintModels,
  components,
} from "../../../../library/backend/schema";
import { writeSourceStep } from "../../../../library/backend/services/footprint-model-store";
import { extractZipEntries } from "../../../../library/backend/import/archive/extract-zip";
import type { ZipEntryContent } from "../../../../library/backend/import/archive/extract-zip";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
import type { CoreBackendModuleContext } from "../../../../../core/contracts/modules/backend-module";
import type { ParsedKicadPcbFootprint } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";
import type { IngestionLogEntry } from "./ingest-library";

type DbClient =
  Parameters<typeof writeSourceStep> extends []
    ? never
    : ReturnType<typeof Object>; // type-only placeholder; we go through ctx.db below

export interface ModelIngestionResult {
  modelsQueued: number;
  modelsSkippedMissing: number;
  warnings: string[];
}

export async function ingestProjectModels(
  ctx: CoreBackendModuleContext,
  params: {
    archiveBytes: Uint8Array;
    pcbFootprints: ParsedKicadPcbFootprint[];
    /** componentId for each refdes after library ingestion. */
    componentByRefdes: Map<string, string>;
    ingestionEntries: IngestionLogEntry[];
  },
): Promise<ModelIngestionResult> {
  const result: ModelIngestionResult = {
    modelsQueued: 0,
    modelsSkippedMissing: 0,
    warnings: [],
  };

  // Build a basename → ZipEntryContent map for .step / .stp candidates.
  const candidates = new Map<string, ZipEntryContent>();
  for (const entry of extractZipEntries(params.archiveBytes)) {
    if (entry.path.startsWith("__MACOSX/")) continue;
    if (entry.baseName.startsWith("._")) continue;
    if (entry.extension !== ".step" && entry.extension !== ".stp") continue;
    if (!candidates.has(entry.baseName.toLowerCase())) {
      candidates.set(entry.baseName.toLowerCase(), entry);
    }
  }
  if (candidates.size === 0) return result;

  // Footprints with model refs that we haven't seen before are de-duped by
  // resolved footprintId so we don't queue the same model twice.
  const seenFootprintIds = new Set<string>();
  const timestamp = new Date().toISOString();
  const db = (ctx.db as { db: typeof footprintModels._.config }).db as any;

  for (const fp of params.pcbFootprints) {
    if (fp.modelRefs.length === 0) continue;
    const componentId = params.componentByRefdes.get(fp.reference);
    if (!componentId) continue;
    const compRow = db
      .select({ footprintId: components.footprintId })
      .from(components)
      .where(eq(components.id, componentId))
      .get();
    const footprintId = compRow?.footprintId;
    if (!footprintId || seenFootprintIds.has(footprintId)) continue;
    seenFootprintIds.add(footprintId);

    // Pick the first model ref whose basename we have in the ZIP.
    let attached: { entry: ZipEntryContent; ref: string } | null = null;
    for (const ref of fp.modelRefs) {
      const basename = ref.replace(/\\/g, "/").split("/").pop() ?? ref;
      const match = candidates.get(basename.toLowerCase());
      if (match) {
        attached = { entry: match, ref };
        break;
      }
    }
    if (!attached) {
      result.modelsSkippedMissing += 1;
      continue;
    }

    const sourceSha256 = sha256(attached.entry.bytes);
    const stored = await writeSourceStep(attached.entry.bytes, sourceSha256);
    db.delete(footprintModels)
      .where(eq(footprintModels.footprintId, footprintId))
      .run();
    db.insert(footprintModels)
      .values({
        footprintId,
        status: "pending_client_conversion",
        glbPath: null,
        glbSha256: null,
        sourceStepPath: stored.relativePath,
        sourceStepSha256: stored.sha256,
        sourceFilename: attached.entry.baseName,
        sourceByteSize: stored.byteSize,
        modelRefJson: JSON.stringify({ ref: attached.ref }),
        tessellationParamsJson: null,
        converterVersion: null,
        byteSize: null,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    result.modelsQueued += 1;
  }

  // Silence the unused-type placeholder; real db typing happens via ctx.db.
  void {} as DbClient;
  return result;
}
