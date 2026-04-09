import { lazy } from "react";
import manifest from "./manifest.json";
import type { FrontendModuleEntry } from "../../core/contracts/modules/frontend-entry";

/**
 * Vite-side barrel. Loaded lazily by `ModuleSpaceHost` on first navigation.
 * `Space` is itself lazy so the React component code is only fetched
 * after the user enters this module.
 */
const entry: FrontendModuleEntry = {
  manifest,
  Space: lazy(async () => {
    const mod = await import("./frontend");
    return { default: mod.ComponentLibrarySpace };
  }),
};

export default entry;
