import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
import type { AssistantWriteProposalDto } from "../../../../sdks";
import type { ConversationStore } from "../conversation-store";
import type { AssistantEventBus } from "../events";
import type { McpConnection } from "./connections";
import { failureResult, toCallToolResult } from "./result-envelope";
import { withHeartbeat, type McpRequestCtx } from "./tool-projection";

/**
 * The MCP side of the approval round-trip.
 *
 * Destructive writes from an external agent stay pending until the user
 * approves them in OpenPCB's assistant panel — one approval surface, the one
 * the user already trusts. What an MCP client lacked was any way to learn the
 * outcome, so it either stopped or re-sent the write. These tools close that
 * loop: look a proposal up, list what is waiting, or block until the user
 * decides (bounded, with heartbeat progress so the client's idle timeout does
 * not fire while the user reads the card).
 *
 * Connection-scoped (registered per request next to `designer_use_design`),
 * and limited to proposals this session proposed (the actor columns).
 */

/** Upper bound for one await; Claude Code aborts idle HTTP calls at 5 min. */
export const MAX_AWAIT_SECONDS = 240;
const DEFAULT_AWAIT_SECONDS = 120;

export interface ProposalToolDeps {
  conversation: ConversationStore;
  events: AssistantEventBus;
}

/**
 * A proposal belongs to the session that proposed it — client key AND
 * instance id from its actor columns. Another Claude Code session of the same
 * client must not see, await or react to it; the chat it lives in is
 * presentation only.
 */
function ownedBy(connection: McpConnection, record: AssistantWriteProposalDto): boolean {
  return (
    record.actor?.clientKey === connection.clientKey &&
    record.actor.instanceId === connection.instanceId
  );
}

interface ApplyResultView {
  status?: string;
  appliedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  message?: string;
  code?: string;
  expectedRevision?: number;
  currentRevision?: number;
}

function describe(record: AssistantWriteProposalDto): Record<string, unknown> {
  const apply = record.applyResult as ApplyResultView | null;
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    riskLevel: record.riskLevel,
    designId: record.designId,
    title: record.title,
    summary: record.summary,
    operationCount: record.operations?.length ?? 0,
    applyResult: apply
      ? {
          status: apply.status ?? null,
          appliedCount: apply.appliedCount ?? null,
          failedCount: apply.failedCount ?? null,
          skippedCount: apply.skippedCount ?? null,
          message: apply.message ?? null,
          code: apply.code ?? null,
          ...(apply.code === "STALE_PROPOSAL"
            ? {
                expectedRevision: apply.expectedRevision ?? null,
                currentRevision: apply.currentRevision ?? null,
              }
            : {}),
        }
      : null,
  };
}

function outcomeLine(record: AssistantWriteProposalDto): string {
  switch (record.status) {
    case "pending":
      return `Proposal ${record.id} is still waiting for the user in OpenPCB's assistant panel.`;
    case "applied":
      return `The user approved proposal ${record.id}; it was applied.`;
    case "partial":
      return `The user approved proposal ${record.id}; it was partially applied — re-read the design before continuing.`;
    case "rejected":
      return `The user rejected proposal ${record.id}. Do not re-send it; ask the user what they want instead.`;
    case "failed": {
      const apply = record.applyResult as ApplyResultView | null;
      if (apply?.code === "STALE_PROPOSAL") {
        return `Proposal ${record.id} was NOT applied: the design changed after it was proposed (revision ${apply.expectedRevision ?? "?"} → ${apply.currentRevision ?? "?"}). Re-read the design and, if it is still wanted, propose again with a new action_id.`;
      }
      return `Proposal ${record.id} failed${apply?.message ? `: ${apply.message}` : ""}. Re-read the design before trying again, with a new action_id.`;
    }
    default:
      return `Proposal ${record.id} is ${record.status}.`;
  }
}

function lookup(
  deps: ProposalToolDeps,
  connection: McpConnection,
  proposalId: string,
): AssistantWriteProposalDto | null {
  const record = deps.conversation.getWriteProposalById(proposalId);
  if (!record || !ownedBy(connection, record)) return null;
  return record;
}

const PROPOSAL_ID_SCHEMA = {
  type: "string",
  description: "The proposal id from a write tool's result (structuredContent.proposal.id).",
};

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerProposalTools(
  server: McpServer,
  connection: McpConnection,
  deps: ProposalToolDeps,
): void {
  server.registerTool(
    "assistant_get_proposal",
    {
      description:
        "Status of a write proposal this session created: pending (waiting for the user in OpenPCB), applied, partial, rejected or failed, plus the apply result.",
      inputSchema: fromJsonSchema<{ proposalId: string }>({
        type: "object",
        properties: { proposalId: PROPOSAL_ID_SCHEMA },
        required: ["proposalId"],
      }),
      annotations: READ_ONLY,
    },
    async (input: { proposalId: string }) => {
      const record = lookup(deps, connection, input.proposalId);
      if (!record) {
        return failureResult(`No proposal '${input.proposalId}' from this session.`);
      }
      return toCallToolResult({
        ok: true,
        status: "ok",
        summary: outcomeLine(record),
        warnings: [],
        truncated: false,
        data: describe(record),
      });
    },
  );

  server.registerTool(
    "assistant_list_pending_proposals",
    {
      description:
        "Write proposals from this session that are still waiting for the user's approval in OpenPCB, newest first. Optionally filter by designId.",
      inputSchema: fromJsonSchema<{ designId?: string }>({
        type: "object",
        properties: { designId: { type: "string" } },
      }),
      annotations: READ_ONLY,
    },
    async (input: { designId?: string } | undefined) => {
      const pending = deps.conversation.listWriteProposalsByActor(connection, {
        status: "pending",
        designId: input?.designId || undefined,
      });
      return toCallToolResult({
        ok: true,
        status: "ok",
        summary:
          pending.length === 0
            ? "Nothing is waiting for approval."
            : `${pending.length} proposal(s) waiting for the user in OpenPCB.`,
        warnings: [],
        truncated: false,
        data: { proposals: pending.map(describe) },
      });
    },
  );

  server.registerTool(
    "assistant_await_proposal",
    {
      description: `Wait until the user approves or rejects a pending proposal in OpenPCB's assistant panel, up to timeoutSeconds (default ${DEFAULT_AWAIT_SECONDS}, max ${MAX_AWAIT_SECONDS}). Returns immediately if it is already decided. On timeout it returns status "pending": remind the user and call again, or move on.`,
      inputSchema: fromJsonSchema<{ proposalId: string; timeoutSeconds?: number }>({
        type: "object",
        properties: {
          proposalId: PROPOSAL_ID_SCHEMA,
          timeoutSeconds: {
            type: "integer",
            minimum: 1,
            maximum: MAX_AWAIT_SECONDS,
          },
        },
        required: ["proposalId"],
      }),
      annotations: READ_ONLY,
    },
    async (
      input: { proposalId: string; timeoutSeconds?: number },
      ctx: unknown,
    ) => {
      const requestCtx = ctx as McpRequestCtx;
      let record = lookup(deps, connection, input.proposalId);
      if (!record) {
        return failureResult(`No proposal '${input.proposalId}' from this session.`);
      }
      if (record.status === "pending") {
        const timeoutMs =
          Math.min(
            Math.max(1, Math.floor(input.timeoutSeconds ?? DEFAULT_AWAIT_SECONDS)),
            MAX_AWAIT_SECONDS,
          ) * 1000;
        await withHeartbeat(requestCtx, "waiting for the user's approval", () =>
          deps.events.waitForProposal(
            input.proposalId,
            (status) => status !== "pending",
            { timeoutMs, signal: requestCtx?.mcpReq?.signal },
          ),
        );
        record = lookup(deps, connection, input.proposalId) ?? record;
      }
      return toCallToolResult({
        ok: true,
        status: "ok",
        summary: outcomeLine(record),
        warnings: [],
        truncated: false,
        data: describe(record),
      });
    },
  );
}
