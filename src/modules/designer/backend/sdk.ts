import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import type { DesignerSDK } from "../../../sdks/designer";
import type { LibrarySDK } from "../../../sdks/library";
import { runDrc } from "./drc/drc-engine";
import { runErc } from "./erc/erc-engine";
import {
  commitKicadProjectImport,
  inspectKicadProjectFromBytes,
} from "./import/kicad-project/commit";
import { createDesignerStore } from "./store";

export function buildDesignerSdk(ctx: CoreBackendModuleContext): DesignerSDK {
  const store = createDesignerStore(ctx);

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
    getDesign: (designId) => store.getDesign(designId),
    updateDesign: (designId, input) => store.updateDesign(designId, input),
    getSchematicProjection: (designId) =>
      store.getSchematicProjection(designId),
    getPcbProjection: (designId) => store.getPcbProjection(designId),
    searchLibraryComponents: (params) => store.searchLibraryComponents(params),
    resolveLibraryComponentForPlacement: (componentId) =>
      store.resolveLibraryComponentForPlacement(componentId),
    dispatchCommand: (designId, envelope) =>
      store.dispatchCommand(designId, envelope),
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
      const projection = await store.getPcbProjection(designId);
      if (!projection) return null;
      const view = projection.board.viewState;
      const options = {
        ignoredRuleClasses: view?.drcIgnoredRuleClasses ?? [],
        waivedIds: view?.drcWaivedViolationIds ?? [],
      };
      const report = runDrc(projection, options);
      await store.saveDrcResult(designId, report, options);
      return report;
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
  };
}
