import type {
  AiJsonSchemaObject,
  AiTool,
  AiToolExecutionContext,
  AiToolRegistry,
  AiToolResult,
} from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import {
  AI_DESIGNER_SESSION_ID,
  finalizeAndMaybeApply,
  mcpActorOf,
  resolveDesignForTool,
  type SchematicProposalEnvelope,
} from "./designer-tools";

/**
 * Design management and history for MCP clients: rename, delete (waits for
 * approval), focus a design in the UI, read history, undo / redo.
 *
 * Undo and redo act on `designer-ui-session`, the undo session the UI, the
 * in-app assistant and MCP clients share — which is what lets the user
 * Ctrl+Z an agent's edit. The flip side is that an agent's undo could revert
 * the USER's last edit, so `designer_undo` / `designer_redo` only act when
 * the entry on top of the stack is a command this SESSION applied (matched by
 * command id against the proposals whose actor is this client key + instance
 * id). Anything else — the user's edit, or another session's — is not its to
 * undo.
 */

type Limits = AiToolResult["limits"];

function failed(message: string, limits: Limits): AiToolResult<null> {
  return {
    ok: false,
    data: null,
    summary: message,
    sources: [],
    warnings: [message],
    truncated: false,
    limits,
  };
}

function ok(summary: string, data: unknown, limits: Limits): AiToolResult<unknown> {
  return { ok: true, data, summary, sources: [], warnings: [], truncated: false, limits };
}

const DESIGN_ID: AiJsonSchemaObject = {
  type: "string",
  description: "Target design. Omit to use the pinned or focused design.",
};

function designerOf(ctx: CoreBackendModuleContext): DesignerSDK | undefined {
  return ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER) ?? undefined;
}

function targetDesign(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  execCtx: AiToolExecutionContext,
  requested: string | undefined,
): { designer: DesignerSDK; designId: string } | string {
  const designer = designerOf(ctx);
  if (!designer) return "Designer module is not available.";
  const resolved = resolveDesignForTool({
    chatId: execCtx.chatId,
    requestedDesignId: requested,
    contextResolver,
  });
  return resolved.ok ? { designer, designId: resolved.designId } : resolved.warning;
}

function makeRenameTool(ctx: CoreBackendModuleContext, contextResolver: ContextResolver): AiTool {
  return {
    definition: {
      name: "designer_rename_design",
      version: "1",
      effect: "write",
      capability: "designer.write.design",
      description: "Rename a design.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          name: { type: "string", minLength: 1, maxLength: 120 },
        },
        required: ["name"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = input as { designId?: string; name: string };
      const target = targetDesign(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const name = args.name.trim();
      if (!name) return failed("The name must not be empty.", execCtx.limits);
      const updated = await target.designer.updateDesign(target.designId, { name });
      if (!updated) return failed(`Design '${target.designId}' not found.`, execCtx.limits);
      return ok(`Renamed the design to "${updated.name}".`, { id: updated.id, name: updated.name }, execCtx.limits);
    },
  };
}

function makeDeleteTool(
  ctx: CoreBackendModuleContext,
  conversation: ConversationStore,
): AiTool {
  return {
    definition: {
      name: "designer_delete_design",
      version: "1",
      effect: "write",
      capability: "designer.write.design.delete",
      description:
        "Delete an entire design — schematic, PCB, history. Irreversible, so it always waits for the user's approval in OpenPCB (then call assistant_await_proposal). designId is required: never delete by default.",
      inputSchema: {
        type: "object",
        properties: { designId: { type: "string" } },
        required: ["designId"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = input as { designId: string };
      const designer = designerOf(ctx);
      if (!designer) return failed("Designer module is not available.", execCtx.limits);
      if (!execCtx.chatId) return failed("Chat context missing.", execCtx.limits);
      const design = await designer.getDesign(designId);
      if (!design) return failed(`Design '${designId}' not found.`, execCtx.limits);
      const proposalId = crypto.randomUUID();
      const sources = [
        { id: `design_${designId}`, kind: "design" as const, refId: designId, label: design.head.name },
      ];
      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_design_delete",
        toolName: "designer_delete_design",
        title: `Delete design "${design.head.name}"`,
        summary: `Delete the whole design "${design.head.name}" (irreversible).`,
        riskLevel: "destructive",
        designId,
        baseRevision: design.head.revision,
        // Descriptive only: approval runs DesignerSDK.deleteDesign
        // (proposal-apply-service `designer_design_delete`); the payload is
        // never dispatched as a command.
        operations: [
          {
            id: `${proposalId}:delete`,
            kind: "designer.delete_design",
            title: `Delete design "${design.head.name}"`,
            summary: "Removes the schematic, PCB and history.",
            riskLevel: "destructive",
            payload: { type: "pcb_set_view_state", patch: {} },
            sources,
            warnings: [],
          },
        ],
        payload: null,
        sources,
        warnings: [],
      };
      // Never auto-applied, not even under a session allowance: deleting a
      // whole design is irreversible, so every one is a fresh decision.
      return (await finalizeAndMaybeApply({
        designer,
        conversation,
        actor: mcpActorOf(execCtx),
        chatId: execCtx.chatId,
        designId,
        baseRevision: design.head.revision,
        envelope,
        warnings: [],
        sources,
        limits: execCtx.limits,
        options: {
          isSessionAutoApplyAllowed: () => false,
        },
      })) as AiToolResult<unknown>;
    },
  };
}

function makeFocusTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_focus_design",
      version: "1",
      effect: "write",
      capability: "designer.ui.focus",
      description:
        "Open and focus a design in the OpenPCB window so the user sees what you are working on. Changes no design data.",
      inputSchema: {
        type: "object",
        properties: { designId: { type: "string" } },
        required: ["designId"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = input as { designId: string };
      const designer = designerOf(ctx);
      if (!designer) return failed("Designer module is not available.", execCtx.limits);
      const design = await designer.getDesign(designId);
      if (!design) return failed(`Design '${designId}' not found.`, execCtx.limits);
      const { delivered } = designer.requestFocus(designId);
      return ok(
        delivered
          ? `Focused "${design.head.name}" in OpenPCB.`
          : `OpenPCB's designer screen is not open, so nothing was focused; the user can open "${design.head.name}" themselves.`,
        { designId, delivered },
        execCtx.limits,
      );
    },
  };
}

function makeHistoryTool(ctx: CoreBackendModuleContext, contextResolver: ContextResolver): AiTool {
  return {
    definition: {
      name: "designer_get_history",
      version: "1",
      effect: "read",
      capability: "designer.read.history",
      description:
        "Undo/redo state of a design (shared by the OpenPCB UI and agents): current revision, depth of each stack, and the command the next undo / redo would affect.",
      inputSchema: { type: "object", properties: { designId: DESIGN_ID } },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = (input ?? {}) as { designId?: string };
      const target = targetDesign(ctx, contextResolver, execCtx, designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const design = await target.designer.getDesign(target.designId);
      if (!design) return failed(`Design '${target.designId}' not found.`, execCtx.limits);
      const history = await target.designer.getHistory(target.designId, AI_DESIGNER_SESSION_ID);
      return ok(
        `Revision ${design.head.revision}: ${history.undoDepth} undoable, ${history.redoDepth} redoable.`,
        { designId: target.designId, revision: design.head.revision, ...history },
        execCtx.limits,
      );
    },
  };
}

function makeUndoRedoTool(
  direction: "undo" | "redo",
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
): AiTool {
  const name = direction === "undo" ? "designer_undo" : "designer_redo";
  return {
    definition: {
      name,
      version: "1",
      effect: "write",
      capability: "designer.write.history",
      description:
        direction === "undo"
          ? "Undo the most recent change IF this session made it (OpenPCB refuses to undo the user's own edits — they undo those in the app). Pass expectedRevision from your last read to also refuse if anything changed since."
          : "Redo the most recently undone change IF this session made it. Pass expectedRevision to refuse if anything changed since.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          expectedRevision: { type: "integer", minimum: 0 },
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as { designId?: string; expectedRevision?: number };
      const target = targetDesign(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const design = await target.designer.getDesign(target.designId);
      if (!design) return failed(`Design '${target.designId}' not found.`, execCtx.limits);
      if (
        args.expectedRevision !== undefined &&
        design.head.revision !== args.expectedRevision
      ) {
        return failed(
          `The design moved to revision ${design.head.revision} since revision ${args.expectedRevision} — someone else edited it. Re-read it before ${direction === "undo" ? "undoing" : "redoing"}.`,
          execCtx.limits,
        );
      }
      const history = await target.designer.getHistory(target.designId, AI_DESIGNER_SESSION_ID);
      const next = direction === "undo" ? history.nextUndo : history.nextRedo;
      if (!next) return failed(`Nothing to ${direction}.`, execCtx.limits);
      // Ownership is the proposing session (actor columns on its applied
      // proposals), not the chat: another Claude Code session of the same
      // client is "another agent" here too.
      const actor = mcpActorOf(execCtx);
      if (
        !actor ||
        !conversation.commandIdsAppliedByActor(actor, target.designId).has(next.commandId)
      ) {
        return failed(
          `The next ${direction} (${next.commandType}) was not made by this session — it is the user's or another agent's change. Ask the user to ${direction} it in OpenPCB if they want to.`,
          execCtx.limits,
        );
      }
      const result =
        direction === "undo"
          ? await target.designer.undo(target.designId, AI_DESIGNER_SESSION_ID)
          : await target.designer.redo(target.designId, AI_DESIGNER_SESSION_ID);
      if (!result.ok) return failed(`Nothing to ${direction}.`, execCtx.limits);
      return ok(
        `${direction === "undo" ? "Undid" : "Redid"} ${next.commandType}; the design is at revision ${result.revision}.`,
        { designId: target.designId, revision: result.revision, history: result.history },
        execCtx.limits,
      );
    },
  };
}

export function registerMcpDesignTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
): void {
  registry.register(makeRenameTool(ctx, contextResolver));
  registry.register(makeDeleteTool(ctx, conversation));
  registry.register(makeFocusTool(ctx));
  registry.register(makeHistoryTool(ctx, contextResolver));
  registry.register(makeUndoRedoTool("undo", ctx, contextResolver, conversation));
  registry.register(makeUndoRedoTool("redo", ctx, contextResolver, conversation));
}
