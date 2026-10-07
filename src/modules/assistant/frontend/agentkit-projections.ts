import type { ChatDto, MessageDto, ProposalDto, ToolEventDto } from "agentkit/contracts";
import type { AiSourceRef, AssistantChat, AssistantMessage, AssistantPromptPresetId, AssistantToolEventDto, AssistantWriteProposalDto, AssistantWriteProposalEnvelope } from "../../../sdks/assistant";

export type PresentedProposal = AssistantWriteProposalDto & { runId: string | null; canonicalStatus: ProposalDto["status"] };

export interface ProposalPresentation {
  proposalId: string;
  envelope: AssistantWriteProposalEnvelope;
  outcome: { status: "applied" | "partial" | "failed"; appliedOps: number; failedOps: { opIndex: number; error: string }[]; resultJson?: string; revision?: number | string | null } | null;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function presetId(value: unknown): AssistantPromptPresetId {
  return value === "friendly-tutorial" || value === "minimal-concise" ? value : "strict-grounded";
}
export function projectChat(chat: ChatDto): AssistantChat {
  return {
    id: chat.id, title: chat.title ?? "New chat", metadata: chat.metadata,
    providerConfigId: typeof chat.metadata.providerId === "string" ? chat.metadata.providerId : "",
    model: typeof chat.metadata.model === "string" ? chat.metadata.model : "",
    promptPresetId: presetId(chat.metadata.promptPresetId), createdAt: chat.createdAt, updatedAt: chat.updatedAt, lastMessageAt: chat.updatedAt
  };
}
export function projectMessage(message: MessageDto): AssistantMessage {
  const ai = record(message.metadata.ai);
  return {
    id: message.id, chatId: message.chatId, role: message.role,
    content: typeof message.content === "string" ? message.content : message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n"),
    taskId: message.runId ?? null, toolCallId: message.toolCallId ?? null,
    toolCallsJson: message.toolCalls ? JSON.stringify(message.toolCalls) : null, toolName: null,
    metadata: { ...message.metadata, ai: { ...ai, internal: message.metadata.internal === true || ai.internal === true } },
    createdAt: message.createdAt, updatedAt: message.createdAt
  };
}
const sourceKinds = new Set(["design", "schematic", "pcb", "net", "part", "library-component", "symbol", "footprint", "file", "tool", "external"]);
function projectSources(sources: ToolEventDto["sources"]): AiSourceRef[] {
  return (sources ?? []).filter(source => sourceKinds.has(source.kind)) as AiSourceRef[];
}
export function projectToolEvent(event: ToolEventDto, messages: MessageDto[], presentations: Record<string, ProposalPresentation>): AssistantToolEventDto {
  const message = [...messages].reverse().find(item => item.runId === event.runId && item.role === "assistant" && item.metadata.internal !== true);
  let resultJson = event.resultJson ?? null;
  if (resultJson) {
    try {
      const result = record(JSON.parse(resultJson));
      const id = typeof result.proposalId === "string" ? result.proposalId : typeof result.id === "string" ? result.id : null;
      const presentation = id ? presentations[id] : null;
      if (presentation?.envelope.kind === "designer_place_components") {
        resultJson = JSON.stringify({ ...record(presentation.envelope.payload), proposalId: id, status: "pending_approval" });
      }
    } catch { /* Tool details remain available when a result has no domain card. */ }
  }
  return {
    id: event.id, chatId: event.chatId, taskId: event.runId, messageId: message?.id ?? null,
    toolCallId: event.toolCallId, toolName: event.toolName, status: event.status,
    argumentsJson: event.argumentsJson ?? "{}", resultJson,
    errorJson: event.errorMessage ? JSON.stringify({ message: event.errorMessage, code: event.errorCode }) : null,
    sources: projectSources(event.sources), createdAt: event.createdAt, updatedAt: event.createdAt
  };
}
export function projectProposal(proposal: ProposalDto, presentation?: ProposalPresentation, events: ToolEventDto[] = []): PresentedProposal {
  const envelope = presentation?.envelope;
  const outcome = presentation?.outcome;
  const event = events.find(item => { try { const value = record(JSON.parse(item.resultJson ?? "null")); return value.proposalId === proposal.id || value.id === proposal.id; } catch { return false; } });
  const status = outcome?.status ?? (proposal.status === "approved" || proposal.status === "applying" ? "pending" : proposal.status === "invalidated" ? "failed" : proposal.status);
  return {
    runId: proposal.runId ?? null, canonicalStatus: proposal.status, id: proposal.id, chatId: proposal.chatId, toolEventId: event?.id ?? null, kind: proposal.kind,
    status, designId: envelope?.designId ?? "", baseRevision: envelope?.baseRevision ?? null,
    title: envelope?.title ?? proposal.summary ?? proposal.kind, summary: envelope?.summary ?? proposal.summary,
    toolName: proposal.toolName, riskLevel: proposal.risk, operations: envelope?.operations ?? [],
    sources: envelope?.sources ?? [], warnings: [...proposal.warnings, ...(envelope?.warnings ?? [])],
    proposal: envelope?.payload ?? null, envelope: envelope ?? null, applyResult: outcome ?? proposal.outcome ?? null,
    createdAt: proposal.createdAt, updatedAt: proposal.createdAt
  };
}
export function committedChange(presentation: ProposalPresentation | undefined): { designId: string; revision?: number } | null {
  const outcome = presentation?.outcome;
  if (!outcome || outcome.appliedOps < 1) return null;
  let result: Record<string, unknown> = {};
  try { result = record(JSON.parse(outcome.resultJson ?? "{}")); } catch { /* Revision and target still come from the durable receipt presentation. */ }
  const designId = typeof result.designId === "string" ? result.designId : presentation.envelope.designId;
  return designId ? { designId, revision: typeof outcome.revision === "number" ? outcome.revision : typeof outcome.revision === "string" && /^\d+$/.test(outcome.revision) ? Number(outcome.revision) : undefined } : null;
}
