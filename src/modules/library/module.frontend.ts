import { lazy } from "react";
import manifest from "./manifest.json";
import type { FrontendModuleEntry } from "../../core/contracts/modules/frontend-entry";

const entry: FrontendModuleEntry = {
  manifest,
  Space: lazy(async () => {
    const mod = await import("./frontend");
    return { default: mod.LibrarySpace };
  }),
};

export default entry;
