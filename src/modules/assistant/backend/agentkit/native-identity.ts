import { createHash } from "node:crypto";
import type { ProposalRecord, RiskLevel } from "agentkit/host";

export interface NativeIdentity {
  actorScope: string;
  argumentFingerprint: string;
  expectedUnits: number;
  /** Fingerprint of `dispatchedContent` at staging; apply refuses an envelope that no longer matches. */
  envelopeFingerprint?: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .filter(([, item]) => item !== undefined).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function argumentFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value)) ?? "null").digest("hex");
}

export function deterministicDesignId(key: string): string {
  const hash = argumentFingerprint(key);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function nativeIdentity(proposal: ProposalRecord): NativeIdentity {
  const value = proposal.envelope.nativeIdentity;
  if (!value || typeof value !== "object") throw new Error("NATIVE_IDENTITY_MISSING");
  const identity = value as Partial<NativeIdentity>;
  if (!identity.actorScope || !identity.argumentFingerprint || !Number.isInteger(identity.expectedUnits)) {
    throw new Error("NATIVE_IDENTITY_INVALID");
  }
  return identity as NativeIdentity;
}

const SAFE_COMMANDS = new Set([
  "create_design", "place_part", "create_wire", "create_wire_junction", "auto_arrange_schematic",
  "move_part", "rotate_part", "mirror_part", "update_part_properties", "update_parts_properties",
  "duplicate_part", "set_pin_electrical_intent",
  "upsert_label", "place_gnd_port", "place_pwr_port", "place_net_portal", "move_primitive",
  "rotate_primitive", "update_primitive_text",
]);
const DESTRUCTIVE_COMMANDS = new Set([
  "delete_entity", "pcb_delete_trace", "pcb_delete_via", "pcb_delete_placement", "pcb_delete_free_hole",
  "pcb_delete_free_pad", "pcb_delete_overlay_text", "pcb_delete_overlay_shape", "pcb_delete_zone", "pcb_delete_keepout",
]);

function operationRisk(operation: unknown): RiskLevel {
  if (!operation || typeof operation !== "object") throw new Error("UNKNOWN_NATIVE_OPERATION");
  const item = operation as { payload?: unknown; type?: unknown; kind?: unknown; commands?: unknown[] };
  if (item.type !== undefined) {
    if (item.type === "batch_commands") {
      if (!Array.isArray(item.commands)) throw new Error("UNKNOWN_NATIVE_OPERATION");
      return commandRisk(item.commands);
    }
    if (typeof item.type !== "string") throw new Error("UNKNOWN_NATIVE_OPERATION");
    if (DESTRUCTIVE_COMMANDS.has(item.type)) return "destructive";
    if (!SAFE_COMMANDS.has(item.type)) throw new Error(`UNKNOWN_NATIVE_OPERATION: ${item.type}`);
    return "medium";
  }
  if (item.kind === "designer.place_part" && item.payload && typeof item.payload === "object" &&
      !("type" in item.payload) && "componentId" in item.payload) return "medium";
  if (item.payload && typeof item.payload === "object") return operationRisk(item.payload);
  throw new Error("UNKNOWN_NATIVE_OPERATION");
}

export function commandRisk(operations: unknown[]): RiskLevel {
  const risks = operations.map(operationRisk);
  return risks.includes("destructive") ? "destructive" : "medium";
}

/** The part of a stored envelope the native applier hands to the domain, per proposal kind. */
export function dispatchedContent(kind: string, envelope: Record<string, unknown>): unknown {
  if (kind === "designer_create_design") return { name: envelope.name };
  if (kind === "designer_compile_circuit") return envelope.plan;
  if (kind === "designer_place_components") return envelope.payload;
  return envelope.operations;
}

/** Risk of what the domain will actually execute, not of the proposal's display operations. */
export function dispatchedRisk(kind: string, envelope: Record<string, unknown>): RiskLevel {
  const content = dispatchedContent(kind, envelope);
  if (kind === "designer_create_design") return commandRisk([{ type: "create_design" }]);
  const list = (value: unknown, key: string): unknown[] => {
    const items = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    if (!Array.isArray(items)) throw new Error("UNKNOWN_NATIVE_OPERATION");
    return items;
  };
  if (kind === "designer_compile_circuit") {
    return commandRisk(list(content, "placements").map((item) => ({ type: "place_part", ...(item as object) })));
  }
  if (kind === "designer_place_components") return commandRisk(list(content, "placements").map(() => ({ type: "place_part" })));
  if (!Array.isArray(content)) throw new Error("UNKNOWN_NATIVE_OPERATION");
  return commandRisk(content);
}

export function authorizeNativeProposal(proposal: ProposalRecord, actorScope: string, readOnly = false): boolean {
  if (readOnly) return false;
  try { return nativeIdentity(proposal).actorScope === actorScope; }
  catch { return false; }
}
