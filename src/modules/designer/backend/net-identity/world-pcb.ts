import type { EcsWorld } from "../../../../shared/domain/ecs";
import type { DesignerCombinedState, DesignerWorldComponent } from "../projection-world";

type PcbState = Omit<DesignerCombinedState, "schematic" | "activeNetIdentities" | "identityBinding">;
type PcbRows = Omit<PcbState, "pcb">;
type RowKey = keyof PcbRows;

const COMPONENT_ROWS = [
  ["designer.pcb_placement", "placements"], ["designer.pcb_trace", "traces"],
  ["designer.pcb_via", "vias"], ["designer.pcb_free_hole", "freeHoles"],
  ["designer.pcb_free_pad", "freePads"], ["designer.pcb_overlay_text", "overlayTexts"],
  ["designer.pcb_overlay_shape", "overlayShapes"], ["designer.pcb_zone", "zones"],
  ["designer.pcb_keepout", "keepouts"],
] as const;

function readRows(world: EcsWorld<DesignerWorldComponent>): PcbRows {
  const rows: PcbRows = { placements: [], traces: [], vias: [], freeHoles: [], freePads: [],
    overlayTexts: [], overlayShapes: [], zones: [], keepouts: [] };
  for (const snapshot of world.snapshots()) {
    for (const [type, key] of COMPONENT_ROWS) {
      const component = snapshot.components.get(type);
      if (!component || component.type !== type) continue;
      (rows[key] as Array<{ id: string }>).push(component.payload as unknown as { id: string });
      break;
    }
  }
  for (const key of Object.keys(rows) as RowKey[]) rows[key].sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/** Decode patched PCB rows before the schematic binder takes its dependent census. */
export function pcbStateFromWorld(world: EcsWorld<DesignerWorldComponent>): PcbState {
  const settings = world.snapshots().find((snapshot) => snapshot.id === "pcb:board_settings");
  const component = settings?.components.get("designer.pcb_settings");
  const pcb = (component?.payload ?? {}) as unknown as PcbState["pcb"];
  return { pcb, ...readRows(world) };
}
