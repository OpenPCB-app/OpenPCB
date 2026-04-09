import type { FrontendModuleEntry } from "../../../core/contracts/modules/frontend-entry";
import { ComponentLibrarySpace } from "../react/Space";

const frontendModule: FrontendModuleEntry = {
  id: "component-library",
  Space: ({ moduleId, namespace, backendURL }) => (
    <ComponentLibrarySpace moduleId={moduleId} namespace={namespace} backendURL={backendURL} />
  ),
};

export default frontendModule;
