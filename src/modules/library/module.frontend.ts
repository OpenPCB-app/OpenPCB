import manifest from "./manifest.json";
import { LibrarySpace } from "./frontend";
import * as edaCanvas from "../../shared/frontend/canvas";
import { installBundledEdaText } from "../../shared/frontend/canvas/eda-text-config";
import type { FrontendModuleEntry } from "../../core/contracts/modules/frontend-entry";
import type { ModuleManifest } from "../../core/contracts/modules/manifest";

installBundledEdaText(edaCanvas);

const entry: FrontendModuleEntry = {
  manifest: manifest as ModuleManifest,
  Space: LibrarySpace,
};

export default entry;
