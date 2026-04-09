import type { FrontendModuleEntry } from "../../../core/contracts/modules/frontend-entry";
import { DesignerSpace } from "../react/Space";

const frontendModule: FrontendModuleEntry = {
  id: "designer",
  Space: ({ moduleId, namespace }) => (
    <DesignerSpace moduleId={moduleId} namespace={namespace} />
  ),
};

export default frontendModule;
