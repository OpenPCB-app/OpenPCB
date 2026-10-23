/**
 * Copper patch classifier — the single source of created/modified/deleted PCB
 * geometry per command, read from the SAME history patches that mutate the DB.
 *
 * Why patches and not dispatch results: `pcb_add_trace_via` returns only the via
 * id as `createdEntityId` (command-executor.ts) — the trace id is dropped — and
 * modifications/deletions return no ids at all. Forward/inverse patch pairing is
 * exact: forward `component.set` + inverse `entity.delete` ⇒ created; forward
 * `component.set` + inverse `component.set` ⇒ modified; forward `entity.delete`
 * (inverse `entity.restore` carries the payload, incl. netId) ⇒ deleted.
 * Reference-only repair carriers count as modifications without replacing
 * geometry; their strict reader owns the directional reference delta.
 */

import type { EcsPatch } from "../../../../shared/domain/commands";
import { readNetRebindHistoryDelta } from "../net-identity/rebind-history-patches";
import type { RawNetRebindDelta } from "../net-identity/rebind-history-types";
import type { DesignerWorldComponent } from "../projection-world";

const TRACE_PREFIX = "pcb:trace:";
const VIA_PREFIX = "pcb:via:";

export interface CopperGeometryRef {
  geometryId: string;
  kind: "trace" | "via";
  netId: string | null;
}

export interface ClassifiedCopperPatches {
  created: CopperGeometryRef[];
  modified: CopperGeometryRef[];
  deleted: CopperGeometryRef[];
}

function copperKey(entityId: string): { kind: "trace" | "via"; id: string } | null {
  if (entityId.startsWith(TRACE_PREFIX)) {
    return { kind: "trace", id: entityId.slice(TRACE_PREFIX.length) };
  }
  if (entityId.startsWith(VIA_PREFIX)) {
    return { kind: "via", id: entityId.slice(VIA_PREFIX.length) };
  }
  return null;
}

function netIdFromComponent(component: unknown): string | null {
  if (component && typeof component === "object" && "payload" in component) {
    const payload = (component as { payload?: unknown }).payload;
    if (payload && typeof payload === "object" && "netId" in payload) {
      const netId = (payload as { netId?: unknown }).netId;
      if (typeof netId === "string") return netId;
    }
  }
  return null;
}

function netIdFromRestore(components: unknown): string | null {
  if (!components || typeof components !== "object") return null;
  for (const component of Object.values(components)) {
    const netId = netIdFromComponent(component);
    if (netId) return netId;
  }
  return null;
}

function ownDataField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function rebindDelta(patches: readonly EcsPatch[]): RawNetRebindDelta | null {
  for (const patch of patches) {
    const component = ownDataField(patch, "component");
    const entityId = ownDataField(patch, "entityId");
    if (
      ownDataField(component, "type") !== "designer.net_reference_rebind" &&
      !(typeof entityId === "string" && entityId.startsWith("pcb:net-reference-rebind:"))
    ) continue;
    const designId = ownDataField(ownDataField(component, "payload"), "designId");
    // The strict reader owns the carrier contract; validate the whole set so
    // mixed or malformed repair patches cannot invent ordinary copper edits.
    return readNetRebindHistoryDelta(
      typeof designId === "string" ? designId : "",
      "pcb_rebind_net_references",
      patches as readonly EcsPatch<DesignerWorldComponent>[],
    );
  }
  return null;
}

function repairedCopper(delta: RawNetRebindDelta): CopperGeometryRef[] {
  return delta.rows.flatMap((row) => {
    if ((row.kind !== "trace" && row.kind !== "via") || row.payloadId === null) return [];
    const after = row.fields.find((field) => field.key === "netId")?.after;
    return [{
      geometryId: row.payloadId,
      kind: row.kind,
      netId: after?.exists && typeof after.value === "string" ? after.value : null,
    }];
  });
}

export function classifyCopperPatches(
  forward: readonly EcsPatch[],
  inverse: readonly EcsPatch[],
): ClassifiedCopperPatches {
  const repair = rebindDelta(forward);
  if (repair) return { created: [], modified: repairedCopper(repair), deleted: [] };
  const inverseByEntity = new Map<string, EcsPatch[]>();
  for (const patch of inverse as readonly EcsPatch[]) {
    if ("entityId" in patch) {
      const list = inverseByEntity.get(patch.entityId as string) ?? [];
      list.push(patch);
      inverseByEntity.set(patch.entityId as string, list);
    }
  }

  const result: ClassifiedCopperPatches = { created: [], modified: [], deleted: [] };
  for (const patch of forward as readonly EcsPatch[]) {
    if (!("entityId" in patch)) continue;
    const copper = copperKey(patch.entityId as string);
    if (!copper) continue;
    const inversePatches = inverseByEntity.get(patch.entityId as string) ?? [];

    if (patch.kind === "component.set") {
      const ref: CopperGeometryRef = {
        geometryId: copper.id,
        kind: copper.kind,
        netId: netIdFromComponent(patch.component),
      };
      // Inverse of a set on a NEW entity is component.remove (or entity.delete);
      // inverse of a modify is component.set carrying the previous payload.
      if (
        inversePatches.some(
          (p) => p.kind === "entity.delete" || p.kind === "component.remove",
        )
      ) {
        result.created.push(ref);
      } else {
        result.modified.push(ref);
      }
    } else if (patch.kind === "entity.delete") {
      const restore = inversePatches.find((p) => p.kind === "entity.restore");
      result.deleted.push({
        geometryId: copper.id,
        kind: copper.kind,
        netId: restore ? netIdFromRestore((restore as { components?: unknown }).components) : null,
      });
    }
  }
  return result;
}
