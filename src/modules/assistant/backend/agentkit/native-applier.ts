import type { ApplyOutcome, ApplyProposalInput, AssistantStore, ProposalApplier, ProposalRecord } from "agentkit/host";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS, type DesignerSDK, type DesignerCommandEnvelope,
  type DesignerOperationIdentity, type DesignerOperationReceipt, type AssistantPlacementProposal } from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import { applyDesignerPlaceComponentsProposal, applySchematicProposalOperations,
  type SchematicProposalEnvelope } from "../tools/designer-tools";
import { applyCompiledPlan } from "../compiler/apply";
import type { CompiledPlan } from "../compiler/lowering";
import { authorizeNativeProposal, commandRisk, nativeIdentity } from "./native-identity";
import { nativeScope } from "./native-stage";

export interface NativeProposalApplierOptions {
  context: CoreBackendModuleContext;
  store: AssistantStore;
  actorScope: string;
  contextResolver?: ContextResolver;
  readOnly?: boolean;
  authorize?: (proposal: ProposalRecord) => boolean;
}

export function createNativeProposalApplier(options: NativeProposalApplierOptions): ProposalApplier {
  const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  if (!designer) throw new Error("Designer module not available.");
  return new NativeProposalApplier(options, designer);
}

class NativeProposalApplier implements ProposalApplier {
  constructor(private readonly options: NativeProposalApplierOptions, private readonly designer: DesignerSDK) {}

  async currentRevision(scopeKey: string): Promise<string | null> {
    const prefix = `${this.options.actorScope}:chat:`;
    const marker = scopeKey.lastIndexOf(":design:");
    if (!scopeKey.startsWith(prefix) || marker <= prefix.length) return null;
    const chatId = scopeKey.slice(prefix.length, marker);
    if (!await this.options.store.conversations.getChat(chatId)) return null;
    const design = await this.designer.getDesign(scopeKey.slice(marker + 8));
    return design ? String(design.head.revision) : null;
  }

  async apply(input: ApplyProposalInput): Promise<ApplyOutcome> {
    const { proposal, operationId, signal } = input;
    if (this.options.authorize?.(proposal) === false || !authorizeNativeProposal(proposal, this.options.actorScope, this.options.readOnly)) return failure("ACTOR_SCOPE_DENIED");
    if (operationId !== `native:${proposal.id}` || proposal.scopeKey !==
        nativeScope(this.options.actorScope, String(proposal.envelope.designId), proposal.chatId)) return failure("OPERATION_IDENTITY_CONFLICT");
    try { if (proposal.risk !== commandRisk(proposal.operations)) return failure("PROPOSAL_RISK_CONFLICT"); }
    catch { return failure("UNKNOWN_NATIVE_OPERATION"); }
    const identity = this.identityOf(proposal, operationId);
    const previousReceipts = (await this.designer.listOperationReceipts(this.options.actorScope, operationId)).sort((a, b) => unitOf(a.commandId) - unitOf(b.commandId));
    const previousCreations = await this.designer.listDesignCreationReceipts(this.options.actorScope, operationId);
    const priorIdentity = previousReceipts[0]?.identity ?? previousCreations[0]?.identity;
    if (priorIdentity && !identityEquals(priorIdentity, identity)) return failure("OPERATION_IDENTITY_CONFLICT");
    const previous = await this.getOutcome(operationId);
    if (previous) return previous;
    const errors: ApplyOutcome["failedOps"] = [];
    let unitIndex = 0;
    const dispatchCommand = async (envelope: DesignerCommandEnvelope) => {
      signal?.throwIfAborted();
      if (this.options.authorize?.(proposal) === false) throw new Error("ACTOR_SCOPE_DENIED");
      const index = unitIndex++;
      const commandId = `native:${operationId}:${index}`;
      const result = await this.designer.dispatchOperation(identity.designId, { ...envelope, commandId }, { ...identity, expectedRevision: envelope.baseRevision }, { actor: "assistant", groupId: operationId });
      if (!result.ok) {
        errors.push({ opIndex: index, error: result.code });
        if (result.code === "OPERATION_IDENTITY_CONFLICT" || result.code === "REVISION_CONFLICT") throw new Error(result.code);
      }
      return result;
    };
    try {
      signal?.throwIfAborted();
      await this.applyDomain(proposal, identity, dispatchCommand);
    } catch (error) {
      const message = signal?.aborted ? "CANCELLED" : error instanceof Error ? error.message : String(error);
      if (errors.at(-1)?.error !== message) errors.push({ opIndex: unitIndex, error: message });
    }
    const outcome = await this.receiptOutcome(proposal, identity, errors);
    return outcome ?? { status: "failed", appliedOps: 0, failedOps: errors.length ? errors : [{ opIndex: 0, error: "No operation committed." }] };
  }

  async getOutcome(operationId: string): Promise<ApplyOutcome | null> {
    if (!operationId.startsWith("native:")) return null;
    const proposal = await this.options.store.proposals.get(operationId.slice("native:".length));
    if (!proposal) return null;
    if (nativeIdentity(proposal).actorScope !== this.options.actorScope || proposal.scopeKey !==
        nativeScope(this.options.actorScope, String(proposal.envelope.designId), proposal.chatId)) return failure("OPERATION_IDENTITY_CONFLICT");
    const expected = this.identityOf(proposal, operationId);
    return this.receiptOutcome(proposal, expected, []);
  }

  private identityOf(proposal: ProposalRecord, operationId: string): DesignerOperationIdentity {
    const identity = nativeIdentity(proposal);
    const designId = proposal.envelope.designId;
    if (typeof designId !== "string" || !proposal.actionId) throw new Error("NATIVE_IDENTITY_INVALID");
    return { actorScope: identity.actorScope, operationId, actionId: proposal.actionId,
      toolName: proposal.toolName, argumentFingerprint: identity.argumentFingerprint, designId,
      expectedRevision: proposal.revisionAtCreate === undefined ? null : Number(proposal.revisionAtCreate) };
  }

  private async applyDomain(
    proposal: ProposalRecord, identity: DesignerOperationIdentity,
    dispatchCommand: (envelope: DesignerCommandEnvelope) => ReturnType<DesignerSDK["dispatchCommand"]>,
  ): Promise<void> {
    const envelope = proposal.envelope;
    if (this.options.authorize?.(proposal) === false) throw new Error("ACTOR_SCOPE_DENIED");
    if (proposal.kind === "designer_create_design") {
      const result = await this.designer.createDesignOperation({ name: String(envelope.name) }, identity);
      if (!result.ok) throw new Error(result.code);
      await this.options.contextResolver?.maybeAutoBindDesign(proposal.chatId, result.design.id);
      const chat = await this.options.store.conversations.getChat(proposal.chatId);
      if (chat) await this.options.store.conversations.updateChat(proposal.chatId, {
        metadata: { ...chat.metadata, designId: result.design.id, designName: result.design.name },
      });
      return;
    }
    if (proposal.kind === "designer_compile_circuit") {
      await applyCompiledPlan({ designer: this.designer, designId: identity.designId,
        baseRevision: identity.expectedRevision, plan: envelope.plan as CompiledPlan, dispatchCommand });
      return;
    }
    if (proposal.kind === "designer_place_components") {
      await applyDesignerPlaceComponentsProposal({ designer: this.designer, designId: identity.designId,
        baseRevision: identity.expectedRevision, proposal: envelope.payload as AssistantPlacementProposal,
        allowPartial: true, dispatchCommand });
      return;
    }
    await applySchematicProposalOperations({ designer: this.designer, designId: identity.designId,
      baseRevision: identity.expectedRevision, envelope: envelope as unknown as SchematicProposalEnvelope,
      allowPartial: true, dispatchCommand });
  }

  private async receiptOutcome(
    proposal: ProposalRecord, identity: DesignerOperationIdentity, errors: ApplyOutcome["failedOps"],
  ): Promise<ApplyOutcome | null> {
    const receipts = (await this.designer.listOperationReceipts(identity.actorScope, identity.operationId))
      .sort((a, b) => unitOf(a.commandId) - unitOf(b.commandId));
    const creations = await this.designer.listDesignCreationReceipts(identity.actorScope, identity.operationId);
    if (receipts.length === 0 && creations.length === 0) return null;
    if (!receiptChainMatches(receipts, identity) || creations.some((receipt) => !identityEquals(receipt.identity, identity))) {
      return failure("OPERATION_IDENTITY_CONFLICT");
    }
    const expected = nativeIdentity(proposal).expectedUnits;
    const committed = new Set(receipts.map((receipt) => unitOf(receipt.commandId)));
    if (creations.length) committed.add(0);
    const failedOps = receipts.filter((receipt) => !receipt.result.ok).map((receipt) => ({
      opIndex: unitOf(receipt.commandId), error: receipt.result.ok ? "" : receipt.result.code,
    }));
    for (let opIndex = 0; opIndex < expected; opIndex++) {
      if (!committed.has(opIndex)) failedOps.push({ opIndex,
        error: errors.find((item) => item.opIndex === opIndex)?.error ?? "INTERRUPTED: unit has no committed receipt." });
    }
    for (const error of errors) if (!failedOps.some((item) => item.opIndex === error.opIndex)) failedOps.push(error);
    failedOps.push(...proposal.warnings.map((error, index) => ({ opIndex: expected + index, error })));
    const successes = receipts.filter((receipt) => receipt.result.ok);
    const appliedOps = successes.length + creations.length;
    const revision = Math.max(...successes.map((receipt) => receipt.result.ok ? receipt.result.revision : 0),
      ...creations.map((receipt) => receipt.design.revision), 0);
    return { status: failedOps.length ? appliedOps > 0 ? "partial" : "failed" : "applied", appliedOps, failedOps,
      ...(appliedOps > 0 ? { revision: String(revision) } : {}), resultJson: JSON.stringify({ designId: identity.designId, receipts, creations }) };

  }
}

function failure(error: string): ApplyOutcome {
  return { status: "failed", appliedOps: 0, failedOps: [{ opIndex: 0, error }] };
}

function unitOf(commandId: string): number {
  return Number(commandId.slice(commandId.lastIndexOf(":") + 1));
}

function identityEquals(actual: DesignerOperationIdentity, expected: DesignerOperationIdentity): boolean {
  return Object.keys(expected).every((key) => actual[key as keyof DesignerOperationIdentity] === expected[key as keyof DesignerOperationIdentity]);
}

function receiptChainMatches(receipts: DesignerOperationReceipt[], identity: DesignerOperationIdentity): boolean {
  let revision = identity.expectedRevision;
  for (const receipt of receipts) {
    const expected = { ...identity, expectedRevision: revision };
    if (!identityEquals(receipt.identity, expected) ||
        receipt.commandId !== `native:${identity.operationId}:${unitOf(receipt.commandId)}`) return false;
    if (receipt.result.ok) revision = receipt.result.revision;
  }
  return true;
}
