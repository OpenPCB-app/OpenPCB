import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
import type { DesignerSDK } from "../../../../sdks";
import type { ConversationStore } from "../conversation-store";
import type { BuildIntentStore } from "../verification/build-intent-store";
import { runDefinitionOfDone } from "../verification/run-dod";
import type { McpConnection, McpConnectionRegistry } from "./connections";
import { failureResult, toCallToolResult } from "./result-envelope";
import { withHeartbeat, type McpRequestCtx } from "./tool-projection";

/**
 * `designer_verify_build` — the in-app Definition-of-Done check, for MCP.
 *
 * In-app, the run loop verifies every build itself (`run-dod.ts`: BOM placed,
 * required nets wired, no dangling power, ERC clean) and runs correction
 * passes. An external agent is its own loop, so it gets the verifier as a
 * tool and the server instructions tell it to call it after a build. The
 * expected BOM comes from this session's last `library_resolve_bom` or
 * `compile_circuit` (captured by the projection); without one, the checks
 * that need it pass and ERC still runs.
 */

/** Task key the MCP path stores build intents under (per design chat); see tool-projection.ts. */
const MCP_INTENT_TASK_ID = "mcp";

export interface VerifyToolDeps {
  connections: McpConnectionRegistry;
  conversation: ConversationStore;
  buildIntents: BuildIntentStore;
  designer: () => DesignerSDK | undefined;
}

export function registerVerifyTool(
  server: McpServer,
  connection: McpConnection,
  deps: VerifyToolDeps,
): void {
  server.registerTool(
    "designer_verify_build",
    {
      description:
        "Verify a finished build the way OpenPCB's own assistant does: every part from the last library_resolve_bom / compile_circuit is placed, required power/ground nets are wired, no power pin is left dangling, and ERC reports no errors. Call it after building; fix what it reports, then call it again.",
      inputSchema: fromJsonSchema<{ designId?: string }>({
        type: "object",
        properties: {
          designId: {
            type: "string",
            description: "Design to verify. Omit to use the pinned or focused design.",
          },
        },
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: { designId?: string } | undefined, ctx: unknown) => {
      const designer = deps.designer();
      if (!designer) return failureResult("Designer module is not available.");
      const target = deps.connections.resolveDesign(connection, input?.designId ?? null);
      if (!target) {
        return failureResult(
          "No design to verify. Pass designId, or open a design in OpenPCB.",
        );
      }
      const chatId = await deps.connections.designChat(connection, target.designId);
      if (!chatId) return failureResult(`Design '${target.designId}' not found.`);

      // Move this session's pending intent (captured before the design
      // existed, e.g. resolve → create → build) onto the design's chat.
      if (connection.buildIntent) {
        try {
          deps.buildIntents.save({
            chatId,
            taskId: MCP_INTENT_TASK_ID,
            ...connection.buildIntent,
          });
          connection.buildIntent = null;
        } catch {
          // Best-effort, like the in-app capture; verification still runs.
        }
      }

      const report = await withHeartbeat(ctx as McpRequestCtx, "verifying the build", () =>
        runDefinitionOfDone({
          designer,
          conversation: deps.conversation,
          buildIntents: deps.buildIntents,
          chatId,
          taskId: MCP_INTENT_TASK_ID,
          designId: target.designId,
        }),
      );
      const failing = report.checks.filter((check) => !check.passed);
      const summary =
        failing.length === 0
          ? "Build verified: all checks pass."
          : `${failing.length} check(s) failing: ${failing.map((c) => `${c.id} — ${c.message}`).join("; ")}`;
      return toCallToolResult({
        ok: true,
        status: failing.length === 0 ? "ok" : "partial",
        summary,
        warnings: target.warning ? [target.warning] : [],
        truncated: false,
        data: { designId: target.designId, ...report },
      });
    },
  );
}
