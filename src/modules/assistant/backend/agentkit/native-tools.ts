import type { AiTool, AiToolExecutionContext } from "agentkit/core";
import type { AiToolResult } from "agentkit/contracts";
import type { ToolSetContributor } from "agentkit/host";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ContextResolver } from "../context-resolver";
import type { PlacementProposalEnvelope, SchematicProposalEnvelope } from "../tools/designer-tools";
import { buildOpenpcbToolRegistry } from "../tools/openpcb-tool-registry";
import { isValidActionId } from "../tools/action-id";
import { deterministicDesignId, argumentFingerprint } from "./native-identity";
import { findNativeDuplicate, nativeScope, nativeToolFailure, stageNativeProposal, type NativeStageDeps } from "./native-stage";
import type { makeDesignerCompileCircuitTool } from "../compiler/compile-circuit-tool";
import { requiredNetsForItem } from "../verification/required-nets";
import { NativeContextStore } from "./native-context-store";

export interface NativeToolContributorOptions extends NativeStageDeps {
  context: CoreBackendModuleContext;
  contextResolver: ContextResolver;
  contextStore?: NativeContextStore;
}

export function createNativeToolContributor(options: NativeToolContributorOptions): ToolSetContributor {
  options = { ...options, contextStore: options.contextStore ?? new NativeContextStore(options.context) };
  const catalog = buildOpenpcbToolRegistry(options.context, options.contextResolver, undefined, { allowRawToolData: false });
  return {
    namespace: "openpcb",
    async contribute(): Promise<AiTool[]> {
      return catalog.list().map((tool) => ({ definition: tool.definition,
        execute: (context, input) => executeNativeTool(options, tool, context, input) }));
    },
  };
}

async function executeNativeTool(
  options: NativeToolContributorOptions, tool: AiTool, context: AiToolExecutionContext, input: unknown,
): Promise<AiToolResult> {
  if (tool.definition.effect === "write" && options.readOnly) return nativeToolFailure("READ_ONLY: native writes are disabled.", context);
  context.signal?.throwIfAborted();
  if (!context.chatId) return nativeToolFailure("Chat context missing.", context);
  if (tool.definition.name === "designer_create_design") {
    const target = deterministicDesignId(`${options.actorScope}:${context.chatId}:${context.runId}:${argumentFingerprint(input)}`);
    const implicitAction = `native_${argumentFingerprint([options.actorScope, context.chatId, context.runId, tool.definition.name, argumentFingerprint(input)])}`;
    const previous = await findNativeDuplicate(options, context, tool.definition.name, input, nativeScope(options.actorScope, target, context.chatId), implicitAction);
    if (previous) return previous;
  }
  const args = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const designId = typeof args.designId === "string" ? args.designId :
    context.chatId ? options.contextResolver.getPrimaryDesign(context.chatId)?.refId : undefined;
  const actionId = typeof args.action_id === "string" && isValidActionId(args.action_id.trim()) ? args.action_id.trim() : undefined;
  if (actionId && context.chatId) {
    const reservation = options.contextStore?.getAction(options.actorScope, context.chatId, actionId);
    if (reservation && (reservation.designId !== designId || reservation.toolName !== tool.definition.name ||
        reservation.argumentFingerprint !== argumentFingerprint(input))) {
      return nativeToolFailure("OPERATION_IDENTITY_CONFLICT: action_id arguments or target changed.", context);
    }
  }
  if (actionId && designId) {
    const prior = await findNativeDuplicate(options, context, tool.definition.name, input, nativeScope(options.actorScope, designId, context.chatId), actionId);
    if (prior) return prior;
  }
  const registry = buildOpenpcbToolRegistry(options.context, options.contextResolver, undefined, {
    allowRawToolData: false,
    designerTools: {
      stageProposal: (envelope) => stageEnvelope(options, context, input, envelope),
      stageCreateDesign: (name) => stageCreation(options, context, input, name),
    },
    stageCompilation: (compiled) => stageCompilation(options, context, input, compiled),
  });
  const selected = registry.get(tool.definition.name);
  if (!selected) return nativeToolFailure("Native tool missing.", context);
  const result = await selected.execute(context, input);
  if (tool.definition.name === "library_resolve_bom") captureBom(options, context, result.data);
  return result;
}

function stageCreation(options: NativeToolContributorOptions, context: AiToolExecutionContext, input: unknown, name: string): Promise<AiToolResult> {
  const id = crypto.randomUUID();
  const createdId = deterministicDesignId(`${options.actorScope}:${context.chatId}:${context.runId}:${argumentFingerprint(input)}`);
  return stageNativeProposal(options, context, input, {
    id, toolName: "designer_create_design", kind: "designer_create_design", designId: createdId,
    baseRevision: null, operations: [{ type: "create_design", name }], warnings: [], expectedUnits: 1,
    envelope: { id, kind: "designer_create_design", toolName: "designer_create_design", designId: createdId, name },
  });
}

type CompiledStageInput = Parameters<NonNullable<Parameters<typeof makeDesignerCompileCircuitTool>[2]>>[0];

function stageCompilation(options: NativeToolContributorOptions, context: AiToolExecutionContext, input: unknown, compiled: CompiledStageInput): Promise<AiToolResult> {
  const id = crypto.randomUUID();
  if (context.chatId) options.contextStore?.saveBuildIntent({
    chatId: context.chatId, taskId: context.runId, goal: "Compiled circuit",
    items: compiled.bom.map((item) => ({ ...item, requiredNets: requiredNetsForItem(item.role, item.value) })),
  });
  const expectedUnits = compiled.plan.placements.length + compiled.plan.placements.filter((item) => item.value).length +
    compiled.plan.wires.reduce((count, wire) => count + Math.max(0, wire.pins.length - 1), 0) +
    compiled.plan.powerPorts.reduce((count, port) => count + port.pins.length * 2, 0);
  return stageNativeProposal(options, context, input, {
    id, toolName: "compile_circuit", kind: "designer_compile_circuit", designId: compiled.designId,
    baseRevision: compiled.baseRevision, operations: compiled.plan.placements.map((item) => ({ type: "place_part", ...item })), warnings: compiled.warnings,
    expectedUnits, envelope: { ...compiled, id, kind: "designer_compile_circuit", toolName: "compile_circuit" },
  });
}

function stageEnvelope(
  options: NativeToolContributorOptions, context: AiToolExecutionContext, input: unknown,
  envelope: PlacementProposalEnvelope | SchematicProposalEnvelope,
): Promise<AiToolResult> {
  const expectedUnits = envelope.kind === "designer_place_components"
    ? envelope.payload.placements.reduce((count, item) => count + 1 + Number(item.value !== undefined || item.properties !== undefined), 0)
    : envelope.operations.reduce((count, item) => count + 1 + Number(Boolean(item.updatePartAfterCreate)) +
        Number(Boolean(item.linkWireToCreatedPrimitive)), 0);
  return stageNativeProposal(options, context, input, {
    id: envelope.id, toolName: envelope.toolName, kind: envelope.kind, designId: envelope.designId,
    baseRevision: envelope.baseRevision, operations: envelope.operations, warnings: envelope.warnings,
    expectedUnits, actionId: envelope.actionId, envelope: { ...envelope },
  });
}

function captureBom(options: NativeToolContributorOptions, context: AiToolExecutionContext, data: unknown): void {
  if (!context.chatId || !options.contextStore || !data || typeof data !== "object") return;
  const output = data as { goal?: string; items?: Array<{ role: string; quantity: number; value?: string; selected?: { componentId: string } }> };
  options.contextStore.saveBuildIntent({ chatId: context.chatId, taskId: context.runId,
    goal: output.goal ?? "Resolved BOM", items: (output.items ?? []).filter((item) => item.selected).map((item) => ({
      role: item.role, componentId: item.selected!.componentId, quantity: item.quantity,
      ...(item.value ? { value: item.value } : {}), requiredNets: requiredNetsForItem(item.role, item.value),
    })),
  });
}
