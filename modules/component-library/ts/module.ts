import { createModuleV2 } from "@modules/_kit/createModule";
import { ComponentLibrarySpace } from "../react/Space";

/**
 * Component Library Module (V2 wrapper)
 *
 * Real backend routes and SDK registration live in `core/backend-entry.ts`
 * and are mounted via the `CoreBackendModuleDefinition` loader. This file
 * only exists to satisfy the V2 manifest's `ui.moduleEntry` pointer and
 * expose the React space component to the frontend entry glob.
 *
 * Do not add endpoints here — they belong in core/backend-entry.ts so the
 * module has a single canonical backend registration path.
 */
export const componentLibraryModule = createModuleV2("component-library", {
  label: "Component Library",
  namespace: "space.componentlibrary",
  version: "0.1.0",
  kind: "space",
  spaceComponent: ComponentLibrarySpace,

  onActivate: async (ctx) => {
    ctx.logger.info("Component Library module activated (V2 wrapper)");
  },

  onDeactivate: async (ctx) => {
    ctx.logger.info("Component Library module deactivated (V2 wrapper)");
  },
});

export default componentLibraryModule;
