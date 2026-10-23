import type { DesignerCommand, DesignerDispatchResult, DesignerSchematicProjection, PcbZoneNetRef } from "../../../../sdks";
import { loadPcbZoneRowById } from "../pcb/pcb-store";
import { asRecord } from "../value-guards";
import { createNetReferenceJudge, danglingReference, type NetReferenceJudge } from "./command-reference-id";
import { validateNewRuleReferences } from "./command-rule-references";
import type { NetIdentityDb } from "./state-store";
import type { NetIdentityMode } from "./types";

type Failure = Extract<DesignerDispatchResult, { ok: false }>;
type Result = { ok: true; command: DesignerCommand } | { ok: false; result: Failure };
interface Input {
  command: DesignerCommand;
  projection: DesignerSchematicProjection;
  tx: NetIdentityDb;
  designId: string;
  mode: NetIdentityMode;
}

function idField(value: unknown, field: string, judge: NetReferenceJudge): Failure | null {
  return value === null || typeof value === "string" ? judge(value, field) : null;
}

function routeReferences(value: unknown, prefix: string, judge: NetReferenceJudge): Failure | null {
  const route = asRecord(value);
  if (!route) return null;
  if (route.type === "pcb_add_trace_via") {
    return idField(asRecord(route.trace)?.netId, `${prefix}trace.netId`, judge) ??
      idField(asRecord(route.via)?.netId, `${prefix}via.netId`, judge);
  }
  if (route.type === "pcb_add_trace" || route.type === "pcb_add_via") {
    return idField(route.netId, `${prefix}netId`, judge);
  }
  return null;
}

function copperReferences(command: DesignerCommand, judge: NetReferenceJudge): Failure | null {
  if (command.type === "pcb_commit_route") {
    for (const key of ["traces", "vias"] as const) {
      const rows: unknown = command[key];
      if (!Array.isArray(rows)) continue;
      for (const [index, row] of rows.entries()) {
        const failure = idField(asRecord(row)?.netId, `${key}[${index}].netId`, judge);
        if (failure) return failure;
      }
    }
  } else if (command.type === "pcb_apply_autolayout_candidate") {
    if (!Array.isArray(command.routeOperations)) return null;
    for (const [index, route] of command.routeOperations.entries()) {
      const failure = routeReferences(route, `routeOperations[${index}].`, judge);
      if (failure) return failure;
    }
  } else if (["pcb_add_manual_via", "pcb_add_free_pad", "pcb_update_free_pad"].includes(command.type)) {
    return idField(asRecord(command)?.netId, "netId", judge);
  } else return routeReferences(command, "", judge);
  return null;
}

function resolveZoneNet(
  value: unknown, projection: DesignerSchematicProjection, judge: NetReferenceJudge,
): { net: PcbZoneNetRef } | { failure: Failure } | null {
  const net = asRecord(value);
  if (!net) return null;
  if (typeof net.netId === "string") {
    const failure = judge(net.netId, "net.netId");
    return failure ? { failure } : { net: { netId: net.netId, netName: null } };
  }
  if (net.netId !== null || (net.netName !== null && typeof net.netName !== "string")) return null;
  const name = typeof net.netName === "string" ? net.netName.trim().toUpperCase() : "";
  if (!name) return { net: { netId: null, netName: null } };
  const matches = [...new Set(projection.nets.filter((candidate) =>
    candidate.name.trim().toUpperCase() === name).map((candidate) => candidate.id))].sort();
  if (matches.length > 1) return { failure: {
    ok: false, code: "NET_REFERENCE_AMBIGUOUS", field: "net.netName", netName: net.netName as string,
    candidates: matches, detail: `net.netName: display name ${JSON.stringify(net.netName)} matches several nets.`,
  } };
  const failure = matches.length ? judge(matches[0]!, "net.netName") :
    danglingReference("net.netName", null, "unknown-name");
  return failure ? { failure: { ...failure, netName: net.netName as string } } :
    { net: { netId: matches[0]!, netName: null } };
}

function zoneCommand(input: Input, judge: NetReferenceJudge): Result {
  const { command, tx, designId, projection } = input;
  if (command.type !== "pcb_add_zone" && command.type !== "pcb_update_zone") return { ok: true, command };
  let effective: unknown = command.net;
  if (command.type === "pcb_update_zone" && effective === undefined && command.enabled === true) {
    const existing = loadPcbZoneRowById(tx, designId, command.zoneId);
    if (existing?.zone.enabled === false) effective = existing.zone;
  }
  if (effective === undefined) return { ok: true, command };
  const resolved = resolveZoneNet(effective, projection, judge);
  if (!resolved) return { ok: true, command };
  return "failure" in resolved ? { ok: false, result: resolved.failure } :
    { ok: true, command: { ...command, net: resolved.net } };
}

/** Validates references before handlers persist copper or new rule declarations. */
export function normalizeCommandNetReferences(input: Input): Result {
  const { command, tx, designId, projection, mode } = input;
  if (mode === "legacy") return { ok: true, command };
  const judge = createNetReferenceJudge(tx, designId, projection);
  const failure = command.type === "pcb_set_design_rules"
    ? validateNewRuleReferences(command, tx, designId, judge) : copperReferences(command, judge);
  if (failure) return { ok: false, result: failure };
  return zoneCommand(input, judge);
}
