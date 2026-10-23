import { asEntityId, type EcsWorld } from "../../../../shared/domain/ecs";
import type { DesignerWorldComponent } from "../projection-world";
import { isDurableNetId, type ActiveNetRecord } from "./types";
import { requireValid } from "./validation";

const PREFIX = "net_identity:";

export function writeWorldIdentities(
  world: EcsWorld<DesignerWorldComponent>, active: readonly ActiveNetRecord[],
): void {
  const ids = new Set<string>();
  for (const record of active) {
    if (!isDurableNetId(record.id)) continue;
    requireValid(!ids.has(record.id), "world.netIdentity", "duplicate identity id");
    ids.add(record.id);
    world.setComponent(asEntityId(`${PREFIX}${record.id}`), {
      type: "designer.net_identity", payload: structuredClone(record),
    });
  }
}

export function readWorldIdentities(world: EcsWorld<DesignerWorldComponent>): ActiveNetRecord[] {
  const result: ActiveNetRecord[] = [];
  const ids = new Set<string>();
  for (const snapshot of world.snapshots()) {
    const component = snapshot.components.get("designer.net_identity");
    if (!component || component.type !== "designer.net_identity") continue;
    const record = component.payload;
    requireValid(record && isDurableNetId(record.id), "world.netIdentity", "expected a durable identity record");
    requireValid(snapshot.id === `${PREFIX}${record.id}`, "world.netIdentity", "entity id does not match the identity payload id");
    requireValid(!ids.has(record.id), "world.netIdentity", "duplicate identity id");
    ids.add(record.id);
    result.push(structuredClone(record));
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
