import { useCallback, useEffect } from "react";
import type { AssistantAvailability } from "../../../../sdks/assistant/availability";
import { useAgentKitAppCache } from "../../../../shared/frontend/assistant/AgentKitAppProvider";
import { localApiFetch } from "../../../../shared/frontend/http/local-api";

const RESOURCE = "openpcb.availability";

async function readAvailability(base: string): Promise<AssistantAvailability> {
  try {
    const response = await localApiFetch(`${base}/availability`);
    if (response.ok) return await response.json() as AssistantAvailability;
  } catch {
    // Fall through: an unreachable assistant is reported the same way as a missing one.
  }
  return {
    available: false,
    code: "ASSISTANT_RUNTIME_FAILED",
    message: "The assistant service is not running. Designs and libraries are unaffected. Restart OpenPCB; if this persists, check the application log.",
  };
}

/** `null` while unknown, so a healthy assistant renders immediately without a gate. */
export function useAssistantAvailability(): AssistantAvailability | null {
  const cache = useAgentKitAppCache();
  const load = useCallback(() => readAvailability(cache.base), [cache.base]);
  useEffect(() => { void cache.loadResource(RESOURCE, load).catch(() => {}); }, [cache.loadResource, load]);
  return (cache.resources[RESOURCE] as AssistantAvailability | undefined) ?? null;
}
