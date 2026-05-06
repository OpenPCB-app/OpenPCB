import type {
  CoreBackendModuleContext,
} from "../../../core/contracts/modules/backend-module";
import type { DesignerSDK } from "../../../sdks/designer";
import { createDesignerStore } from "./store";

export function buildDesignerSdk(ctx: CoreBackendModuleContext): DesignerSDK {
  const store = createDesignerStore(ctx);
  return {
    createDesign: (input) => store.createDesign(input),
    listDesigns: () => store.listDesigns(),
    getDesign: (designId) => store.getDesign(designId),
    getSchematicProjection: (designId) => store.getSchematicProjection(designId),
    searchLibraryComponents: (params) => store.searchLibraryComponents(params),
    resolveLibraryComponentForPlacement: (componentId) =>
      store.resolveLibraryComponentForPlacement(componentId),
    dispatchCommand: (designId, envelope) =>
      store.dispatchCommand(designId, envelope),
    getHistory: (designId, sessionId) => store.getHistory(designId, sessionId),
    undo: (designId, sessionId) => store.undo(designId, sessionId),
    redo: (designId, sessionId) => store.redo(designId, sessionId),
  };
}
