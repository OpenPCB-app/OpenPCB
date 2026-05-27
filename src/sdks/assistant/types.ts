// Mirror @openpcb/contracts AssistantSDK wire types. Single source of truth lives in shared/.
import type {
  AiSourceRef,
  AssistantPlacementApplyResult,
  AssistantSDK as ContractsAssistantSDK,
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
  AssistantSettings,
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

export type AssistantWriteProposalStatus =
  | "pending"
  | "applied"
  | "partial"
  | "rejected"
  | "failed";

export type AssistantWriteProposalDto = Omit<
  ContractsAssistantWriteProposalDto,
  "status"
> & {
  status: AssistantWriteProposalStatus;
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
