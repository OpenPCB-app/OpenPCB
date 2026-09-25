import type { AiToolResult } from "@openpcb/ai-core";

/**
 * The shape every projected tool returns to an MCP client.
 *
 * Why an envelope rather than `modelData` alone: MCP clients disagree about
 * which half of a tool result reaches the model. Claude Code (2.1.27x+)
 * forwards ONLY `structuredContent` when both halves are present; Claude
 * Desktop reads ONLY `content`. So the readable parts — the one-line summary,
 * warnings, the error message, the pending-proposal hint — must live inside
 * `structuredContent` as well as in the text block, or one client family sees
 * a bare object with no explanation (and a failing read becomes `null`).
 */

export interface McpProposalRef {
  id: string;
  kind: string;
  /** Persisted proposal status after the call: pending, applied, partial, rejected, failed. */
  status: string;
  riskLevel: string | null;
  designId: string | null;
  operationCount: number;
  /** Set while the proposal waits for the user; tells the model what to do next. */
  approvalHint?: string;
}

export interface McpToolEnvelope {
  ok: boolean;
  status: "ok" | "partial" | "error";
  summary: string;
  warnings: string[];
  error?: { message: string };
  truncated: boolean;
  proposal?: McpProposalRef;
  data: unknown;
}

export interface McpCallToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

/**
 * Text block budget. Claude Code caps MCP output at 25k tokens by default
 * (≈100k chars) and spills larger results to a file; keeping the text half
 * under that keeps the common case inline. `structuredContent` is not cut —
 * tools whose data can be large declare `anthropic/maxResultSizeChars`.
 */
export const MAX_TEXT_CHARS = 90_000;

function failureMessage(result: AiToolResult): string {
  const fromWarnings = result.warnings.filter((w) => w.trim().length > 0);
  if (fromWarnings.length > 0) return fromWarnings.join(" ");
  if (result.summary && result.summary.trim().length > 0) return result.summary;
  return "The tool failed without a message.";
}

/** Several tools put their human-readable outcome in `data.message`. */
function messageOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0
    ? message.trim()
    : null;
}

export function buildEnvelope(
  result: AiToolResult,
  proposal?: McpProposalRef | null,
): McpToolEnvelope {
  const payload = result.modelData !== undefined ? result.modelData : result.data;
  const status: McpToolEnvelope["status"] = result.ok
    ? result.status === "partial"
      ? "partial"
      : "ok"
    : result.status === "partial"
      ? "partial"
      : "error";
  const summary =
    result.summary && result.summary.trim().length > 0
      ? result.summary
      : result.ok
        ? (messageOf(result.data) ?? "Done.")
        : failureMessage(result);
  const envelope: McpToolEnvelope = {
    ok: result.ok,
    status,
    summary,
    warnings: result.warnings ?? [],
    truncated: result.truncated === true,
    data: payload === undefined ? null : payload,
  };
  if (!result.ok) envelope.error = { message: failureMessage(result) };
  if (proposal) envelope.proposal = proposal;
  return envelope;
}

function renderText(envelope: McpToolEnvelope): string {
  const lines: string[] = [envelope.summary];
  if (envelope.error && envelope.error.message !== envelope.summary) {
    lines.push(`Error: ${envelope.error.message}`);
  }
  for (const warning of envelope.warnings) {
    if (envelope.error?.message.includes(warning)) continue;
    lines.push(`Warning: ${warning}`);
  }
  if (envelope.proposal) {
    const p = envelope.proposal;
    lines.push(
      `Proposal ${p.id} (${p.kind}) is ${p.status}${p.riskLevel ? `, risk ${p.riskLevel}` : ""}.`,
    );
    if (p.approvalHint) lines.push(p.approvalHint);
  }
  if (envelope.truncated) {
    lines.push("Result truncated — narrow the request to see the rest.");
  }
  if (envelope.data !== null && envelope.data !== undefined) {
    let json: string;
    try {
      json = JSON.stringify(envelope.data);
    } catch {
      json = "\"<unserializable result>\"";
    }
    lines.push(json);
  }
  const text = lines.join("\n");
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n… [${text.length - MAX_TEXT_CHARS} chars cut from the text view; the full result is in structuredContent]`;
}

export function toCallToolResult(envelope: McpToolEnvelope): McpCallToolResult {
  return {
    content: [{ type: "text", text: renderText(envelope) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
    isError: !envelope.ok && envelope.status === "error",
  };
}

/** A result for failures that happen around a tool (thrown errors, missing context). */
export function failureResult(message: string): McpCallToolResult {
  return toCallToolResult({
    ok: false,
    status: "error",
    summary: message,
    warnings: [],
    error: { message },
    truncated: false,
    data: null,
  });
}

/**
 * Where a write tool put its proposal id. Schematic/PCB envelopes carry
 * `{id, kind}` (the same shape `MessageCard` keys its proposal cards on);
 * placement proposals carry `proposalId`.
 */
export function extractProposalRef(
  data: unknown,
): { id: string; kind: string } | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { id?: unknown; kind?: unknown; proposalId?: unknown };
  if (typeof record.id === "string" && typeof record.kind === "string") {
    return { id: record.id, kind: record.kind };
  }
  if (typeof record.proposalId === "string") {
    return {
      id: record.proposalId,
      kind:
        typeof record.kind === "string"
          ? record.kind
          : "designer_place_components",
    };
  }
  return null;
}
