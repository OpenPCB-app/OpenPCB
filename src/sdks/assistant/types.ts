// Mirror @openpcb/contracts AssistantSDK wire types. Single source of truth lives in shared/.
import type {
  AiSourceRef,
  AssistantPlacementApplyResult,
  AssistantSDK as ContractsAssistantSDK,
  AssistantSettings as ContractsAssistantSettings,
  AssistantWriteProposalDto as ContractsAssistantWriteProposalDto,
} from "@openpcb/contracts";

export type {
  AiContextBinding,
  AiContextBindingKind,
  AiContextBindingRole,
  AiContextBindingStatus,
  AiContextSizePreference,
  AiProviderCapabilities,
  AiProviderKind,
  AiSourceRef,
  AiToolStatus,
  AssistantChat,
  AssistantContextBindingDto,
  AssistantMessage,
  AssistantMessageMetadata,
  AssistantMessagesPage,
  AssistantPromptPreset,
  AssistantPromptPresetId,
  AssistantProviderConfig,
  AssistantProviderConfigInput,
  AssistantProviderId,
  AssistantProviderKind,
  AssistantProviderModel,
  AssistantRole,
  AssistantToolCallSummary,
  AssistantToolEventDto,
  AssistantToolExecutionPolicy,
  AssistantPlacementApplyResult,
  AssistantPlacementProposal,
  AssistantPlacementProposalPlacement,
  AssistantPlacementProposalSkipped,
  AssistantWriteProposalKind,
  CreateAssistantChatInput,
  ProviderTestResult,
  SubmitAssistantMessageInput,
  SubmitAssistantMessageResult,
} from "@openpcb/contracts";

/**
 * Local extension of the contracts settings shape. The MCP server's two
 * switches live here rather than in `@openpcb/contracts` so the desktop can
 * ship them without a shared-package tag release; fold them upstream on the
 * next contracts bump.
 */
export type AssistantSettings = ContractsAssistantSettings & {
  /** Serve the MCP endpoint to external clients (Claude Code/Desktop, Codex). */
  mcpEnabled: boolean;
  /** Advertise write tools to MCP clients. Independent of `mcpEnabled`. */
  mcpAllowWrites: boolean;
};

export type AssistantWriteProposalStatus =
  | "pending"
  | "applied"
  | "partial"
  | "rejected"
  | "failed";

/**
 * Who proposed a write, when it came from an external MCP client: the client
 * key plus the per-session instance id. Ownership checks (awaiting a proposal,
 * undoing a change) compare this, never the chat the proposal lives in.
 */
export interface AssistantWriteProposalActor {
  type: "mcp";
  clientKey: string;
  instanceId: string;
}

export type AssistantWriteProposalDto = Omit<
  ContractsAssistantWriteProposalDto,
  "status"
> & {
  status: AssistantWriteProposalStatus;
  /** Set for MCP proposals; null/absent for in-app and cloud ones. */
  actor?: AssistantWriteProposalActor | null;
};

export type AssistantWriteRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "destructive";

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
  kind: string;
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

export interface AssistantSDK
  extends Omit<
    ContractsAssistantSDK,
    "listWriteProposals" | "applyWriteProposal" | "rejectWriteProposal"
  > {
  listWriteProposals(chatId: string): Promise<AssistantWriteProposalDto[]>;
  applyWriteProposal(
    chatId: string,
    proposalId: string,
    input?: { allowPartial?: boolean },
  ): Promise<AssistantPlacementApplyResult | AssistantWriteApplyResult>;
  rejectWriteProposal(
    chatId: string,
    proposalId: string,
  ): Promise<AssistantWriteProposalDto>;
}
