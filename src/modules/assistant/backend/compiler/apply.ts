/**
 * Apply a CompiledPlan to a live design (P1.2b).
 *
 * The design-integrity-sensitive step. `place_part` assigns the reference + pin
 * ids itself (types.ts:1069), so a compiled wire cannot be pre-resolved — we
 * place first, collect each `createdEntityId`, re-read the projection to learn
 * the real pin ids, then resolve every symbolic {handle, pin} and dispatch the
 * wires. All commands share one `groupId` (dataset-capture attribution — history
 * grouping is NOT wired to it yet, so undo is per-command) and run under the
 * shared UI history session, so the user can step back through a compiled
 * circuit with normal undo. Revision is threaded through every dispatch
 * (optimistic concurrency); a mid-run conflict aborts the remaining wiring.
 */

import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerSchematicProjection,
  DesignerSDK,
} from "../../../../sdks";
import { planNetConnect } from "../tools/schematic-targeting";
import type { NetlistPin } from "./ir";
import type { CompiledPlan } from "./lowering";

// Designer history is per-session; the UI and every assistant write tool share
// this id (designer-tools.ts AI_DESIGNER_SESSION_ID / useDesignerWorkspace.ts).
// A private session here would make compiled circuits invisible to UI undo.
const COMPILER_SESSION_ID = "designer-ui-session";

/** Narrow slice of the DesignerSDK the compiler apply path needs. */
export type DesignerApplyPort = Pick<
  DesignerSDK,
  "getDesign" | "getSchematicProjection" | "dispatchCommand"
>;

export interface ApplyCompiledPlanInput {
  designer: DesignerApplyPort;
  designId: string;
  baseRevision: number | null;
  plan: CompiledPlan;
  dispatchCommand?: (envelope: DesignerCommandEnvelope) => ReturnType<DesignerSDK["dispatchCommand"]>;
}

export interface ApplyCompiledPlanResult {
  status: "applied" | "partial" | "failed";
  designId: string;
  revision: number;
  placedCount: number;
  wiredCount: number;
  portCount: number;
  handleToPartId: Record<string, string>;
  errors: string[];
}

export async function applyCompiledPlan(
  input: ApplyCompiledPlanInput,
): Promise<ApplyCompiledPlanResult> {
  const { designer, designId, plan } = input;
  const design = await designer.getDesign(designId);
  if (!design) throw new Error(`Design not found: ${designId}`);
  if (input.baseRevision !== null && design.head.revision !== input.baseRevision) {
    throw new Error(
      `Design changed since the circuit was compiled (expected revision ${input.baseRevision}, current ${design.head.revision}). Recompile.`,
    );
  }

  const errors: string[] = [];
  // Installed-parts-only guardrail: never place a partial circuit with a
  // wrong/substitute part — abort and let the caller flag/import the missing role.
  if (plan.unresolvedRoles.length > 0) {
    return {
      status: "failed",
      designId,
      revision: design.head.revision,
      placedCount: 0,
      wiredCount: 0,
      portCount: 0,
      handleToPartId: {},
      errors: [`Unresolved part role(s): ${[...new Set(plan.unresolvedRoles)].join(", ")}.`],
    };
  }

  const groupId = crypto.randomUUID();
  let revision = design.head.revision;
  const dispatch = async (command: DesignerCommand) => {
    const envelope: DesignerCommandEnvelope = {
      commandId: crypto.randomUUID(),
      sessionId: COMPILER_SESSION_ID,
      aggregateId: designId,
      baseRevision: revision,
      issuedAt: Date.now(),
      command,
    };
    const result = await (input.dispatchCommand ? input.dispatchCommand(envelope)
      : designer.dispatchCommand(designId, envelope, { actor: "assistant", groupId }));
    if (result.ok) revision = result.revision;
    return result;
  };

  // 1. Place every part, remembering handle → created part id.
  const handleToPartId: Record<string, string> = {};
  for (const p of plan.placements) {
    const res = await dispatch({
      type: "place_part",
      componentId: p.componentId,
      positionNm: p.positionNm,
    });
    if (!res.ok) {
      errors.push(`place ${p.handle}: ${res.code}`);
      continue;
    }
    if (res.createdEntityId) handleToPartId[p.handle] = res.createdEntityId;
    if (p.value && res.createdEntityId) {
      const upd = await dispatch({
        type: "update_part_properties",
        partId: res.createdEntityId,
        value: p.value,
      });
      if (!upd.ok) errors.push(`value ${p.handle}: ${upd.code}`);
    }
  }
  const placedCount = Object.keys(handleToPartId).length;

  // 2. Re-read the now-committed projection to learn real pin ids. Reused for
  // the power-port planning below too: wires dispatched in between don't move
  // pins, and planNetConnect only needs pin worldPosition + owner part.
  const projection = await designer.getSchematicProjection(designId);
  if (!projection) {
    errors.push("Schematic projection unavailable after placement.");
    return finalize(designId, revision, placedCount, 0, 0, handleToPartId, errors);
  }
  const resolvePin = makePinResolver(projection, handleToPartId);

  // 3. Wire non-power nets (chain consecutive pins; net inference unions them).
  let wiredCount = 0;
  for (const wire of plan.wires) {
    const pinIds = wire.pins.map(resolvePin);
    for (let i = 0; i < pinIds.length - 1; i++) {
      const a = pinIds[i];
      const b = pinIds[i + 1];
      if (!a || !b) {
        errors.push(`wire ${wire.net}: unresolved pin ${describePin(wire.pins, i, a)}`);
        continue;
      }
      const res = await dispatch({ type: "create_wire", sourcePinId: a, targetPinId: b });
      if (res.ok) wiredCount++;
      else {
        errors.push(`wire ${wire.net}: ${res.code}`);
        if (res.code === "REVISION_CONFLICT") return finalize(designId, revision, placedCount, wiredCount, 0, handleToPartId, errors);
      }
    }
  }

  // 4. Tie power-rail pins to gnd/pwr port primitives.
  let portCount = 0;
  for (const port of plan.powerPorts) {
    for (const pinRef of port.pins) {
      const pinId = resolvePin(pinRef);
      if (!pinId) {
        errors.push(`rail ${port.net}: unresolved pin ${pinRef.handle}.${pinRef.pin}`);
        continue;
      }
      const planned = planNetConnect(projection, pinId, port.net);
      if (!planned.ok) {
        errors.push(`rail ${port.net}: ${planned.error}`);
        continue;
      }
      const prim = await dispatch(planned.plan.primitiveCommand);
      if (!prim.ok || !prim.createdEntityId) {
        errors.push(`rail ${port.net}: port ${prim.ok ? "no id" : prim.code}`);
        continue;
      }
      const wired = await dispatch({
        type: "create_wire",
        sourcePinId: planned.plan.sourcePinId,
        targetPinId: `primitive:${prim.createdEntityId}`,
      });
      if (wired.ok) portCount++;
      else errors.push(`rail ${port.net}: wire ${wired.code}`);
    }
  }

  return finalize(designId, revision, placedCount, wiredCount, portCount, handleToPartId, errors);
}

function makePinResolver(
  projection: DesignerSchematicProjection,
  handleToPartId: Record<string, string>,
): (ref: NetlistPin) => string | null {
  const partsById = new Map(projection.parts.map((part) => [part.id, part]));
  return (ref) => {
    const partId = handleToPartId[ref.handle];
    if (!partId) return null;
    const part = partsById.get(partId);
    if (!part) return null;
    const needle = ref.pin.toLowerCase();
    const pin = part.pins.find(
      (p) => (p.number ?? "").toLowerCase() === needle || p.name.toLowerCase() === needle,
    );
    return pin?.id ?? null;
  };
}

function describePin(pins: NetlistPin[], i: number, a: string | null | undefined): string {
  const pin = !a ? pins[i]! : pins[i + 1]!;
  return `${pin.handle}.${pin.pin}`;
}

function finalize(
  designId: string,
  revision: number,
  placedCount: number,
  wiredCount: number,
  portCount: number,
  handleToPartId: Record<string, string>,
  errors: string[],
): ApplyCompiledPlanResult {
  const status: ApplyCompiledPlanResult["status"] =
    placedCount === 0 ? "failed" : errors.length > 0 ? "partial" : "applied";
  return { status, designId, revision, placedCount, wiredCount, portCount, handleToPartId, errors };
}
