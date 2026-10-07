import type { ProviderDto } from "agentkit/contracts";
import type { AssistantProviderConfig } from "./types";

/** Desktop preference status extends the canonical DTO without exposing credential references. */
export type CanonicalProviderDto = ProviderDto &
  Pick<AssistantProviderConfig, "hasApiKey" | "capabilities" | "isBuiltin">;
