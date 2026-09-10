import { MODULE_SDK_TOKENS } from "../../../../sdks";
import type { DesignerPcbProjection } from "../../../../sdks/designer";
import type { LibrarySDK } from "../../../../sdks/library";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { RawFootprintLookup } from "./courtyard";

/**
 * The raw footprint data one DRC run needs, as plain entries.
 *
 * This is the transferable form: the DRC worker receives these entries and
 * rebuilds the same closure on its side (execution contract 09 §2.2), so
 * `null` here means exactly what `undefined` means for the in-thread lookup —
 * "no lookup at all", not "a lookup that returns null".
 */
export async function buildRawFootprintEntries(
  ctx: CoreBackendModuleContext,
  projection: DesignerPcbProjection,
): Promise<Array<[string, Record<string, unknown>]> | null> {
  const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  if (!library) return null;
  const ids = new Set<string>();
  for (const placement of projection.placements) {
    const id = placement.footprint?.footprintId;
    if (id) ids.add(id);
  }
  if (ids.size === 0) return null;
  const entries: Array<[string, Record<string, unknown>]> = [];
  for (const id of ids) {
    // A library read must never fail the DRC run: without the raw data the
    // extent falls back to the preview bounds, which is still a superset.
    try {
      const footprint = await library.getFootprint(id);
      if (footprint?.data) entries.push([id, footprint.data]);
    } catch {
      // ignore — this footprint contributes no courtyard
    }
  }
  return entries;
}

/**
 * A synchronous raw-footprint lookup for one DRC run.
 *
 * `RawFootprintLookup` is synchronous by contract (the geometry helpers that
 * consume it are pure), while the library SDK is async — so the projection's
 * footprints are fetched ONCE, up front, into a map the closure reads. This is
 * what lets a KiCad-imported placement contribute its real courtyard to the
 * keepout `footprints` extent: the import whitelist drops `F.CrtYd`/`B.CrtYd`
 * before persistence, so the placement's own render model has none, but the
 * parsed footprint survives in `library_footprints.data_json`.
 *
 * Returns `undefined` when the library module is unavailable — the extent then
 * falls back to the preview bounds, which is still a superset of the part.
 *
 * Expressed over `buildRawFootprintEntries` so the in-thread lookup and the
 * worker's rebuilt one cannot drift.
 */
export async function buildRawFootprintLookup(
  ctx: CoreBackendModuleContext,
  projection: DesignerPcbProjection,
): Promise<RawFootprintLookup | undefined> {
  const entries = await buildRawFootprintEntries(ctx, projection);
  if (entries === null) return undefined;
  const byId = new Map(entries);
  return (footprintId: string) => byId.get(footprintId) ?? null;
}
