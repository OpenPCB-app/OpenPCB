// OpenPCB-owned assistant DTOs compose AgentKit's canonical generic contracts.
import type {
  AiChatRole,
  AiContextBinding as AgentKitContextBinding,
  AiContextBindingRole,
  AiContextBindingStatus,
  AiContextSizePreference,
  AiProviderCapabilities,
  AiProviderKind,
  AiSourceRef as AgentKitSourceRef,
  AiToolStatus,
} from "agentkit/contracts";
import type { DesignerDispatchResult } from "../designer/types";

export type {
  AiContextBindingRole,
  AiContextBindingStatus,
  AiContextSizePreference,
  AiProviderCapabilities,
  AiProviderKind,
  AiToolStatus,
};

export type AiContextBindingKind =
  | "design"
  | "library-component"
  | "symbol"
  | "footprint"
  | "file"
  | "selection"
  | "net"
  | "part";

export type AiContextBinding = AgentKitContextBinding<AiContextBindingKind>;

export type AiSourceRefKind =
  | "design"
  | "schematic"
  | "pcb"
  | "net"
  | "part"
  | "library-component"
  | "symbol"
  | "footprint"
  | "file"
  | "tool"
  | "external";

export type AiSourceRef = AgentKitSourceRef<AiSourceRefKind>;

export type AssistantProviderId = string;
/** @deprecated Use AiProviderKind. Re-exported here for backward compatibility. */
export type AssistantProviderKind = AiProviderKind;
export type AssistantRole = AiChatRole;

export type AssistantPromptPresetId =
  | "strict-grounded"
  | "friendly-tutorial"
  | "minimal-concise";

export type AssistantToolExecutionPolicy =
  | "auto_readonly_confirm_writes"
  | "confirm_all_writes"
  | "auto_all";

export interface AssistantPromptPreset {
  id: AssistantPromptPresetId;
  label: string;
  description: string;
}

export interface AssistantChat {
  id: string;
  title: string;
  providerConfigId: string;
  model: string;
  promptPresetId: AssistantPromptPresetId;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface AssistantToolCallSummary {
  toolCallId: string;
  toolName: string;
  status: AiToolStatus;
  sourceCount: number;
  truncated: boolean;
  warnings: string[];
}

export interface AssistantMessageMetadata {
  ai?: {
    toolCallSummaries?: AssistantToolCallSummary[];
    totalSources?: number;
    internal?: boolean;
    /** Chain-of-thought from reasoning models; surfaced in a collapsed disclosure. */
    reasoning?: string;
    /** The turn finished with finish_reason=length (answer may be cut off). */
    truncated?: boolean;
    /** The run completed with no visible answer (drives the retry affordance). */
    emptyResponse?: boolean;
  };
  [key: string]: unknown;
}

export interface AssistantMessage {
  id: string;
  chatId: string;
  role: AssistantRole;
  content: string;
  toolCallId: string | null;
  toolCallsJson: string | null;
  toolName: string | null;
  taskId: string | null;
  metadata: AssistantMessageMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantContextBindingDto extends AiContextBinding {
  chatId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantToolEventDto {
  id: string;
  chatId: string;
  taskId: string | null;
  messageId: string | null;
  toolCallId: string;
  toolName: string;
  status: AiToolStatus;
  argumentsJson: string;
  resultJson: string | null;
  errorJson: string | null;
  sources: AiSourceRef[];
  createdAt: string;
  updatedAt: string;
}

export type AssistantWriteProposalKind =
  | "designer_place_components"
  | "designer_schematic_edits"
  | "designer_schematic_wires"
  | "designer_schematic_updates"
  | "designer_schematic_deletions"
  // Cloud-copilot PCB batches (S5/S8): staged by the auto-layout orchestration
  // tools; always high-risk, never auto-applied (desktop stays DRC authority).
  | "designer_pcb_place_batch"
  | "designer_pcb_route_batch"
  | (string & {});
export type AssistantWriteProposalStatus =
  | "pending"
  | "applied"
  | "partial"
  | "rejected"
  | "failed";

export type AssistantWriteRiskLevel = "low" | "medium" | "high" | "destructive";

export type AssistantWriteOperationStatus =
  | "pending"
  | "applied"
  | "skipped"
  | "failed";

export interface AssistantWriteOperation {
  id: string;
  kind: string;
  title: string;
  summary: string;
  riskLevel: AssistantWriteRiskLevel;
  payload: unknown;
  sources?: AiSourceRef[];
  warnings?: string[];
}

export interface AssistantWriteOperationResult {
  operationId: string;
  status: AssistantWriteOperationStatus;
  commandId?: string;
  revisionBefore?: number | null;
  revisionAfter?: number;
  createdEntityId?: string | null;
  error?: string;
  result?: unknown;
}

export interface AssistantWriteApplyResult {
  proposalId?: string;
  status: "applied" | "partial" | "failed";
  designId?: string;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  stoppedAtOperationId?: string;
  operations: AssistantWriteOperationResult[];
  message: string;
}

export interface AssistantWriteProposalEnvelope<TPayload = unknown> {
  id: string;
  kind: AssistantWriteProposalKind;
  toolName: string;
  title: string;
  summary: string;
  riskLevel: AssistantWriteRiskLevel;
  designId: string | null;
  baseRevision: number | null;
  operations: AssistantWriteOperation[];
  payload: TPayload;
  sources: AiSourceRef[];
  warnings: string[];
  createdByToolCallId?: string;
}

export interface AssistantWriteProposalDto {
  id: string;
  chatId: string;
  toolEventId: string | null;
  kind: AssistantWriteProposalKind;
  status: AssistantWriteProposalStatus;
  designId: string;
  baseRevision: number | null;
  toolName?: string | null;
  title?: string | null;
  summary?: string | null;
  riskLevel?: AssistantWriteRiskLevel | null;
  operations?: AssistantWriteOperation[];
  sources?: AiSourceRef[];
  warnings?: string[];
  proposal: unknown;
  envelope?: AssistantWriteProposalEnvelope | null;
  applyResult: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantPlacementProposalPlacement {
  componentId: string;
  componentName: string;
  positionNm: { x: number; y: number };
  rotationDeg: 0 | 90 | 180 | 270;
  mirrored: boolean;
  value?: string;
  properties?: Record<string, string>;
  warnings: string[];
}

export interface AssistantPlacementProposalSkipped {
  componentId: string;
  reason: string;
}

export interface AssistantPlacementProposal {
  proposalId: string;
  status: "pending_approval";
  design: { id: string; name: string; revision: number };
  placements: AssistantPlacementProposalPlacement[];
  skipped: AssistantPlacementProposalSkipped[];
  requiresPartialConfirmation: boolean;
}

export interface AssistantPlacementApplyResult {
  proposalId: string;
  status: "applied";
  designId: string;
  applied: Array<{
    componentId: string;
    componentName: string;
    partId: string | null;
    revision: number;
  }>;
  skipped: AssistantPlacementProposalSkipped[];
  results: DesignerDispatchResult[];
}

export interface AssistantSettings {
  defaultProviderId: string;
  defaultPromptPresetId: AssistantPromptPresetId;
  contextSizePreference: AiContextSizePreference;
  allowRawToolData: boolean;
  toolExecutionPolicy: AssistantToolExecutionPolicy;
  /** Serve the MCP endpoint to external clients. */
  mcpEnabled: boolean;
  /** Advertise write tools to MCP clients. */
  mcpAllowWrites: boolean;
}

export interface AssistantProviderConfig {
  id: string;
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  isBuiltin: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  capabilities: AiProviderCapabilities | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantProviderConfigInput {
  label?: string;
  kind?: AiProviderKind;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  defaultModel?: string;
  enabled?: boolean;
}

export interface AssistantProviderModel {
  providerId: string;
  modelId: string;
  displayName: string | null;
  fetchedAt: string;
}

export interface ProviderTestResult {
  ok: boolean;
  checkedAt: string;
  modelsAvailable: number;
  completionTested: boolean;
  toolCallSupported: boolean;
  message: string;
}
