import { MODULE_SDK_TOKENS } from "../../../../sdks";
import type { DesignerPcbProjection } from "../../../../sdks/designer";
import type { LibrarySDK } from "../../../../sdks/library";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { RawFootprintLookup } from "./courtyard";

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
 */
export async function buildRawFootprintLookup(
  ctx: CoreBackendModuleContext,
  projection: DesignerPcbProjection,
): Promise<RawFootprintLookup | undefined> {
  const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  if (!library) return undefined;
  const ids = new Set<string>();
  for (const placement of projection.placements) {
    const id = placement.footprint?.footprintId;
    if (id) ids.add(id);
  }
  if (ids.size === 0) return undefined;
  const byId = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    // A library read must never fail the DRC run: without the raw data the
    // extent falls back to the preview bounds, which is still a superset.
    try {
      const footprint = await library.getFootprint(id);
      if (footprint?.data) byId.set(id, footprint.data);
    } catch {
      // ignore — this footprint contributes no courtyard
    }
  }
  return (footprintId: string) => byId.get(footprintId) ?? null;
}
