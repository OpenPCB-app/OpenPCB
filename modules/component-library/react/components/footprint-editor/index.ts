/**
 * Footprint Editor Module
 *
 * Components and utilities for the footprint editor in the New Component wizard.
 */

// Types
export * from "./types";

// Viewport utilities
export * from "./viewport";

// Store
export {
  useFootprintEditorStore,
  createFootprintEditorStore,
  useFootprintDraft,
  useFootprintChrome,
  useFootprintViewport,
  useFootprintSelection,
  useCanUndo,
  useCanRedo,
  useIsDirty,
} from "./footprint-editor-store";

// Components
export { FootprintEditorCanvasR3F as FootprintEditorCanvas } from "@/lib/render-engine/adapters/FootprintEditorCanvasR3F";
export { FootprintPresetSelector } from "./FootprintPresetSelector";
export { PresetConfigPanel } from "./PresetConfigPanel";
export { DensitySelector } from "./DensitySelector";
export { PadPropertiesPanel } from "./PadPropertiesPanel";
export { FootprintEditorToolbar } from "./FootprintEditorToolbar";
export { FootprintEditorStep } from "./FootprintEditorStep";

// Utilities
export * from "./preset-utils";
export * from "./import-utils";
