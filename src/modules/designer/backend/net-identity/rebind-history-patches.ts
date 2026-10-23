import type { EcsPatch } from "../../../../shared/domain/commands";
import { asEntityId } from "../../../../shared/domain/ecs";
import type { DesignerWorldComponent } from "../projection-world";
import { invertRawNetRebindDelta } from "./rebind-history";
import type { RawNetRebindDelta } from "./rebind-history-types";
import { rawNetRebindConflict, validateRawNetRebindDelta } from "./rebind-history-validation";

const PREFIX = "pcb:net-reference-rebind:";
const COMPONENT = "designer.net_reference_rebind";
const COMMAND = "pcb_rebind_net_references";
type Patch = EcsPatch<DesignerWorldComponent>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) rawNetRebindConflict("History carrier must be a plain object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) rawNetRebindConflict("History carrier must be a plain object");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      rawNetRebindConflict("History carrier must contain enumerable data fields only");
    }
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) {
    rawNetRebindConflict("History patches must be a dense plain array");
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) rawNetRebindConflict("History arrays must contain data fields only");
  }
  return value;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    rawNetRebindConflict("History carrier has unsupported or missing fields");
  }
}

// History normally comes from JSON; direct callers must not execute accessors while validating it.
function assertPlainData(value: unknown): void {
  const pending = [value], seen = new Set<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const values = Array.isArray(current) ? array(current) : Object.values(object(current));
    for (const entry of values) pending.push(entry);
  }
}

function isReserved(patch: Record<string, unknown>): boolean {
  if (typeof patch.entityId === "string" && patch.entityId.startsWith(PREFIX)) return true;
  if (patch.componentType === COMPONENT) return true;
  if (patch.component !== undefined && object(patch.component).type === COMPONENT) return true;
  if (patch.components !== undefined) {
    const components = object(patch.components);
    if (Object.hasOwn(components, COMPONENT)) return true;
    for (const component of Object.values(components)) if (object(component).type === COMPONENT) return true;
  }
  return false;
}

function carrier(delta: RawNetRebindDelta): Patch {
  return { kind: "component.set", entityId: asEntityId(`${PREFIX}${delta.designId}`),
    component: { type: COMPONENT, payload: delta } };
}

export function buildNetRebindHistoryPatchSet(delta: RawNetRebindDelta): { forwardPatches: Patch[]; inversePatches: Patch[] } {
  assertPlainData(delta);
  const designId = object(delta).designId;
  if (typeof designId !== "string") rawNetRebindConflict("History delta requires an owning design");
  const validated = validateRawNetRebindDelta(delta, designId);
  if (!validated.rows.length) return { forwardPatches: [], inversePatches: [] };
  return { forwardPatches: [carrier(validated)], inversePatches: [carrier(invertRawNetRebindDelta(validated))] };
}

export function readNetRebindHistoryDelta(designId: string, commandType: string, patches: readonly Patch[]): RawNetRebindDelta | null {
  const entries = array(patches).map(object);
  const reserved = entries.map(isReserved);
  if (commandType !== COMMAND) {
    if (reserved.some(Boolean)) rawNetRebindConflict("Reserved net rebind history belongs only to its repair command");
    return null;
  }
  if (entries.length !== 1) rawNetRebindConflict("Net rebind history requires exactly one carrier patch");
  const patch = entries[0]!;
  exact(patch, ["kind", "entityId", "component"]);
  if (patch.kind !== "component.set" || patch.entityId !== `${PREFIX}${designId}`) rawNetRebindConflict("Net rebind carrier kind or entity does not match");
  const component = object(patch.component);
  exact(component, ["type", "payload"]);
  if (component.type !== COMPONENT) rawNetRebindConflict("Net rebind carrier component does not match");
  assertPlainData(component.payload);
  const delta = validateRawNetRebindDelta(component.payload, designId);
  if (!delta.rows.length) rawNetRebindConflict("Net rebind history requires a nonempty raw delta");
  return delta;
}
