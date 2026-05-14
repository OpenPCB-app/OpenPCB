import manifest from "./manifest.json";
import { AssistantSpace } from "./frontend";
import type { FrontendModuleEntry } from "../../core/contracts/modules/frontend-entry";
import type { ModuleManifest } from "../../core/contracts/modules/manifest";

const entry: FrontendModuleEntry = {
  manifest: manifest as ModuleManifest,
  Space: AssistantSpace,
};

export default entry;
