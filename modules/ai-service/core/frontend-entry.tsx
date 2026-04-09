import type { FrontendModuleEntry } from "../../../core/contracts/modules/frontend-entry";
import { AiServiceSpace } from "../react/Space";

const frontendModule: FrontendModuleEntry = {
  id: "ai-service",
  Space: ({ moduleId, namespace }) => (
    <AiServiceSpace moduleId={moduleId} namespace={namespace} />
  ),
};

export default frontendModule;
