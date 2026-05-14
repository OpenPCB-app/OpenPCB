import manifest from "./manifest.json";
import { DesignerSpace } from "./frontend";
import type { FrontendModuleEntry } from "../../core/contracts/modules/frontend-entry";
import type { ModuleManifest } from "../../core/contracts/modules/manifest";

const entry: FrontendModuleEntry = {
  manifest: manifest as ModuleManifest,
  Space: DesignerSpace,
};

export default entry;
