import { lazy } from "react";
import manifest from "./manifest.json";
import type { FrontendModuleEntry } from "../../core/contracts/modules/frontend-entry";
import type { ModuleManifest } from "../../core/contracts/modules/manifest";

const entry: FrontendModuleEntry = {
  manifest: manifest as ModuleManifest,
  Space: lazy(async () => {
    const mod = await import("./frontend");
    return { default: mod.TasksSpace };
  }),
};

export default entry;
