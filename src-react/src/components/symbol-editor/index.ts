/**
 * Symbol Editor Module
 *
 * Components and utilities for the symbol editor in the New Component wizard.
 */

export { SymbolEditorCanvasR3F as SymbolEditorCanvas } from "@/lib/render-engine/adapters/SymbolEditorCanvasR3F";
export { PinPalette, PIN_TEMPLATES, type PinTypeTemplate } from "./PinPalette";
export { PinPropertiesPanel } from "./PinPropertiesPanel";
export { SymbolEditorToolbar } from "./SymbolEditorToolbar";
export { SymbolMetadataEditor } from "./SymbolMetadataEditor";
export {
  useSymbolEditorStore,
  createSymbolEditorStore,
  useSymbolDraft,
  useSymbolChrome,
  useSymbolViewport,
  useSymbolSelection,
  useCanUndo,
  useCanRedo,
  useIsDirty,
} from "./symbol-editor-store";
export * from "./types";
export * from "./viewport";
