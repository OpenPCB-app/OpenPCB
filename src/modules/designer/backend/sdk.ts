import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { NotFoundError } from "../../../core/contracts/errors";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { DesignerSDK } from "../../../sdks/designer";
import type { LibrarySDK } from "../../../sdks/library";
import { getActiveDesignId } from "./active-design";
import { buildExportBundle } from "./export";
import { pushCloudSnapshot, readLinkPublic } from "./cloud-sync";
import { buildBoardSnapshot as buildBoardSnapshotFromProjection } from "./pcb/board-snapshot";
import {
  DrcRunCancelledError,
  resolveDrcRunService,
} from "./drc/run-service";
import { runErc } from "./erc/erc-engine";
import {
  commitKicadProjectImport,
  inspectKicadProjectFromBytes,
} from "./import/kicad-project/commit";
import { createDesignerStore } from "./store";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

export function buildDesignerSdk(ctx: CoreBackendModuleContext): DesignerSDK {
  const store = createDesignerStore(ctx);
  // Shared with `registerRoutes` — one registry, one worker (09 §5).
  const drcRuns = resolveDrcRunService(ctx, store);
  // Same module-db unwrap the store uses (store.ts getDb) — cloud-sync helpers
  // take the raw drizzle client.
  const rawDb = (ctx.db as unknown as { db: DbClient }).db;

  // Match a KiCad lib_id ("LibraryName:PartName") against the OpenPCB library.
  // Strict match: requires a component tagged with the exact `kicad-lib-id:<libId>`
  // marker (placed by previous ingestions of this lib_id). The looser
  // part-name search is no longer used because it over-matched generic names
  // (every "R" footprint matched the built-in R component).
  const libraryComponentLookup = async (
    libId: string,
  ): Promise<string | null> => {
    const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
    if (!library) return null;
    const tag = `kicad-lib-id:${libId}`;
    const tagged = await library.searchComponents({ tags: [tag], limit: 1 });
    return tagged[0]?.id ?? null;
  };

  return {
    createDesign: (input) => store.createDesign(input),
    listDesigns: () => store.listDesigns(),
    getActiveDesignId: () => getActiveDesignId(),
    getDesign: (designId) => store.getDesign(designId),
    updateDesign: (designId, input) => store.updateDesign(designId, input),
    getSchematicProjection: (designId) =>
      store.getSchematicProjection(designId),
    getPcbProjection: (designId) => store.getPcbProjection(designId),
    searchLibraryComponents: (params) => store.searchLibraryComponents(params),
    resolveLibraryComponentForPlacement: (componentId) =>
      store.resolveLibraryComponentForPlacement(componentId),
    dispatchCommand: (designId, envelope, capture) =>
      store.dispatchCommand(designId, envelope, undefined, capture),
    getHistory: (designId, sessionId) => store.getHistory(designId, sessionId),
    undo: (designId, sessionId) => store.undo(designId, sessionId),
    redo: (designId, sessionId) => store.redo(designId, sessionId),
    runErc: async (designId) => {
      const projection = await store.getSchematicProjection(designId);
      if (!projection) return null;
      return runErc(projection);
    },
    getProjectionAndErc: async (designId) => {
      // Fetch ONCE so the returned projection and ERC report describe the same
      // revision; the pure runErc closes over this exact object.
      const projection = await store.getSchematicProjection(designId);
      if (!projection) return null;
      return { projection, erc: runErc(projection) };
    },
    runDrc: async (designId) => {
      // The SAME run the HTTP route waits on (execution contract 09 §7): the
      // service is a per-context singleton, so an assistant / MCP read joins a
      // run the UI already started instead of computing a second one, and the
      // report is byte-identical to the route's by construction.
      try {
        return await drcRuns.runAndWait(designId);
      } catch (error) {
        // A missing design stays `null` here, as it always has; so does a
        // run cancelled or superseded under the caller — the assistant's
        // proposal apply reads this AFTER a committed board change, and a
        // report is "reported, never gating" (09 §7).
        if (error instanceof NotFoundError) return null;
        if (error instanceof DrcRunCancelledError) return null;
        throw error;
      }
    },
    inspectKicadProject: async (archiveFileName, archiveBytes) => {
      const { report } = await inspectKicadProjectFromBytes(
        archiveBytes,
        libraryComponentLookup,
      );
      // archiveFileName is kept for future use (e.g. default design name);
      // suppress the unused-param hint without changing the signature.
      void archiveFileName;
      return report;
    },
    commitKicadProject: async (request) =>
      commitKicadProjectImport(ctx, {
        designName: request.designName,
        archiveFileName: request.archiveFileName,
        archiveBytes: request.archiveBytes,
        libraryComponentLookup,
      }),
    getCloudLink: async (designId) => {
      const link = readLinkPublic(rawDb, designId);
      if (!link) return null;
      return {
        cloudDesignId: link.cloudDesignId,
        cloudWorkspaceId: link.workspaceId,
        lastSyncedRevision: link.lastSyncedRevision,
      };
    },
    pushCloudSnapshot: (designId, cloudCtx) =>
      pushCloudSnapshot(rawDb, designId, cloudCtx),
    buildBoardSnapshot: async (designId) => {
      const projection = await store.getPcbProjection(designId);
      if (!projection) return null;
      return buildBoardSnapshotFromProjection(projection);
    },
    getBomProjection: (designId) => store.getBomProjection(designId),
    getManufacturingExportSummary: async (designId, options) => {
      const pcb = await store.getPcbProjection(designId);
      if (!pcb) return null;
      const schematic = await store.getSchematicProjection(designId);
      const overrides = await store.listBomOverrides(designId);
      const bundle = buildExportBundle(
        pcb,
        schematic,
        options ?? {},
        overrides,
        undefined,
        await store.getDesignName(designId),
      );
      // Sizes only — the artifact text stays here. Callers wanting the bytes
      // use the HTTP export route, which streams a ZIP.
      return {
        bundleName: bundle.bundleName,
        warnings: bundle.warnings,
        files: bundle.artifacts.map((artifact) => ({
          kind: artifact.kind,
          fileName: artifact.fileName,
          bytes: artifact.text.length,
        })),
      };
    },
  };
}
