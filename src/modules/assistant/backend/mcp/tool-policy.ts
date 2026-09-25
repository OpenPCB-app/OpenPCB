import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { AiTool } from "@openpcb/ai-core";

/**
 * MCP-side metadata for projected tools that `AiToolDefinition` cannot carry.
 *
 * `@openpcb/ai-core` definitions know `effect` (read | write) but not risk,
 * idempotency or result size, and the in-app registry must not grow fields
 * just for MCP. So the projection keeps its own table, keyed by tool name.
 * `assistant-mcp-tools.test.ts` fails when a write tool is registered without
 * an entry here — a new write tool must decide its annotations explicitly.
 */

export interface McpToolPolicy {
  /** Irreversible or removes user work. Maps to `destructiveHint`. */
  destructive?: boolean;
  /**
   * Repeating the call with the same arguments is a no-op. Writes default to
   * false: their `action_id` idempotency key is optional, so a caller that
   * omits it can double-apply.
   */
  idempotent?: boolean;
  /**
   * Claude Code spills results over ~25k tokens to a file unless the tool
   * declares a larger `anthropic/maxResultSizeChars` (max 500k). Set on tools
   * whose data scales with the design.
   */
  maxResultSizeChars?: number;
}

const LARGE_RESULT = 400_000;

export const MCP_TOOL_POLICIES: Record<string, McpToolPolicy> = {
  // ── reads ────────────────────────────────────────────────────────────
  designer_get_schematic_connectivity: { maxResultSizeChars: LARGE_RESULT },
  designer_get_design_summary: { maxResultSizeChars: LARGE_RESULT },
  designer_run_drc: { maxResultSizeChars: LARGE_RESULT },
  designer_run_erc: { maxResultSizeChars: LARGE_RESULT },
  designer_get_bom: { maxResultSizeChars: LARGE_RESULT },
  designer_get_pcb_layout: { maxResultSizeChars: LARGE_RESULT },
  // ── in-app writes (schematic) ────────────────────────────────────────
  designer_create_design: {},
  designer_place_components: {},
  designer_propose_schematic_edits: {},
  designer_propose_schematic_wires: {},
  designer_propose_schematic_updates: {},
  designer_arrange_schematic: { idempotent: true },
  designer_propose_schematic_deletions: { destructive: true },
  compile_circuit: {},
  // ── MCP-only writes (tools/mcp-pcb-tools.ts, tools/mcp-design-tools.ts) ─
  pcb_place_footprints: {},
  pcb_route: {},
  pcb_delete_routing: { destructive: true },
  pcb_set_board_outline: {},
  // Not undoable; always waits for approval (APPROVAL_REQUIRED_KINDS).
  pcb_set_design_rules: { destructive: true },
  // `action: "delete"` removes the zone/keepout — flag the tool conservatively.
  pcb_manage_zone: { destructive: true },
  pcb_manage_keepout: { destructive: true },
  pcb_set_drc_waivers: { idempotent: true },
  designer_rename_design: { idempotent: true },
  designer_delete_design: { destructive: true },
  designer_focus_design: { idempotent: true },
  designer_undo: {},
  designer_redo: {},
};

export function policyFor(name: string): McpToolPolicy | undefined {
  return MCP_TOOL_POLICIES[name];
}

export function annotationsFor(tool: AiTool): ToolAnnotations {
  const readOnly = tool.definition.effect === "read";
  const policy = policyFor(tool.definition.name) ?? {};
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && policy.destructive === true,
    idempotentHint: readOnly || policy.idempotent === true,
    openWorldHint: false,
  };
}

export function metaFor(tool: AiTool): Record<string, unknown> | undefined {
  const size = policyFor(tool.definition.name)?.maxResultSizeChars;
  return size ? { "anthropic/maxResultSizeChars": size } : undefined;
}

/**
 * Claude Code truncates each tool description at 2,048 characters. Anything
 * past the cap is silently lost, so keep a margin.
 */
export const MAX_DESCRIPTION_CHARS = 2_000;

export function mcpDescription(tool: AiTool): string {
  const description = tool.definition.description;
  if (description.length <= MAX_DESCRIPTION_CHARS) return description;
  return `${description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`;
}
