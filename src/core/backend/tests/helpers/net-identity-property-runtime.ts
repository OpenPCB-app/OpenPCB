import { eq } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../contracts/modules/backend-module";
import type { DesignerPcbProjection, LibraryComponentPlacementDetail } from "../../../../sdks";
import { createDesignerStore } from "../../../../modules/designer/backend/store";
import { pcbEntities } from "../../../../modules/designer/backend/schema";
import { createModuleDb } from "../../db/module-db-factory";
import { getSharedDb } from "../../db/sqlite-client";
import { runDrc } from "../../../../shared/drc/drc-engine";
import { ercPart } from "./erc-fixtures";
import { pad, placement } from "./drc-fixtures";
import { openIdentityRuntime, placed, send, type IdentityRuntime } from "./net-identity-runtime";

function component(): LibraryComponentPlacementDetail {
  const symbol = ercPart([]).symbol;
  return { component: { id: "passive", name: "Passive", description: "", symbolId: "symbol", footprintId: "fp", tags: [], isBuiltin: false },
    symbol: { ...symbol, pins: [{ originPinKey: "1", number: "1", name: "Pin", localPositionMm: { x: 0, y: 0 }, electricalType: "passive", unit: 1 }] },
    footprint: placement("fixture", { pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }).footprint,
    footprintVariants: [], resolvedAt: "2026-10-22T00:00:00.000Z" };
}

function context(runtime: IdentityRuntime): CoreBackendModuleContext {
  const library = { resolveComponentForPlacement: async () => component(), getDefaultFootprintRefs: async () => ({}) };
  return { moduleId: "designer", manifest: { id: "designer", label: "Designer", version: "0.1.0", apiVersion: 2,
    namespace: "openpcb.designer", kind: "space", enabled: true, availability: "all", sidebar: { label: "Designer", icon: "CircuitBoard", order: 1 },
    runtime: { backendEntry: "module.backend.ts", frontendEntry: "module.frontend.ts" }, dependsOn: [], defaultPinned: false },
  db: createModuleDb("designer"), sdk: { has: () => true, get: <T>() => library as unknown as T, registerValue: () => {} },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: (_message, meta) => { runtime.errors.push(meta); } } };
}

/** Reuses the isolated runtime/database lifecycle with a real single-pad footprint. */
export async function openPropertyRuntime(file?: string): Promise<IdentityRuntime> {
  const runtime = await openIdentityRuntime(file);
  return { ...runtime, store: createDesignerStore(context(runtime)) };
}

async function addCopper(runtime: IdentityRuntime, designId: string, netId: string, y: number, full: boolean): Promise<void> {
  await send(runtime, designId, { type: "pcb_add_trace", netId, netClassId: "default", layer: "F.Cu", widthMm: 0.25,
    pointsNm: [{ x: -10_000_000, y: y * 1_000_000 }, { x: 0, y: y * 1_000_000 }], segmentMode: "manhattan-90", legality: "off" }, "fixture");
  if (!full) return;
  await send(runtime, designId, { type: "pcb_add_via", netId, netClassId: "default", centerMm: { x: -5, y }, legality: "off" }, "fixture");
  await send(runtime, designId, { type: "pcb_add_free_pad", netId, centerMm: { x: -5, y }, rotationDeg: 0,
    padType: "smd", shape: "circle", widthMm: 1, heightMm: 1, layer: "F.Cu" }, "fixture");
  await send(runtime, designId, { type: "pcb_add_zone", layer: "F.Cu", net: { netId, netName: null }, enabled: false,
    region: { kind: "polygon", pointsMm: [{ x: -6, y: y - 1 }, { x: -4, y: y - 1 }, { x: -5, y: y + 1 }] } }, "fixture");
}

export async function createRoutedIdentityFixture(fullCopper = false) {
  const runtime = await openPropertyRuntime(), design = await runtime.store.createDesign();
  const pins: Array<Awaited<ReturnType<typeof placed>>> = [];
  for (const [x, y] of [[0, 0], [10, 0], [0, 20], [10, 20]]) pins.push(await placed(runtime, design.id, x! * 1_000_000, y! * 1_000_000));
  const wires: string[] = [];
  for (const [first, second] of [[0, 1], [2, 3]]) wires.push((await send(runtime, design.id,
    { type: "create_wire", sourcePinId: pins[first!]!.pinId, targetPinId: pins[second!]!.pinId }, "fixture")).createdEntityId!);
  const initial = (await runtime.store.getPcbProjection(design.id))!;
  for (const [index, pin] of pins.entries()) {
    const placed = initial.placements.find((placement) => placement.partId === pin.partId)!;
    await send(runtime, design.id, { type: "pcb_move_placement", placementId: placed.id, positionMm: { x: index % 2 ? 0 : -10, y: index < 2 ? -5 : 5 } }, "fixture");
  }
  const schematic = (await runtime.store.getSchematicProjection(design.id))!;
  const netIds = [0, 2].map((index) => schematic.nets.find((net) => net.pinIds.includes(pins[index]!.pinId))!.id);
  for (const [index, netId] of netIds.entries()) await addCopper(runtime, design.id, netId, index ? 5 : -5, fullCopper);
  await send(runtime, design.id, { type: "pcb_set_design_rules", perNetClassAssignments: Object.fromEntries(netIds.map((id) => [id, "default"])),
    lengthMatchGroups: [{ id: "length", name: "Length", netIds, target: { kind: "absolute", mm: 10 }, toleranceMm: 0.1 }],
    diffPairs: [{ id: "pair", name: "Pair", pNetId: netIds[0]!, nNetId: netIds[1]! }],
    drcRules: [{ id: "rule", name: "Rule", enabled: true, priority: 1, scopes: [{ kind: "net", netIds }], constraint: { kind: "clearance", mm: 0.25 } }] }, "fixture");
  return { runtime, designId: design.id, pins, wires, netIds };
}

export function rawReferenceSignature(designId: string): string {
  const rows = getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).all();
  const references = rows.flatMap((row) => {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    if (row.kind === "board_settings") return [{ kind: row.kind, fields: ["perNetClassAssignments", "lengthMatchGroups", "diffPairs", "drcRules"].map((key) => [key, payload[key]]) }];
    return ["trace", "via", "free_pad", "zone"].includes(row.kind) ? [{ kind: row.kind, fields: [payload.id, ...["netId", "netName"].map((key) => [key, Object.hasOwn(payload, key), payload[key]])] }] : [];
  });
  return JSON.stringify(references.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
}

export function physicalVerdict(pcb: DesignerPcbProjection) {
  return { drc: runDrc(pcb).violations.map(({ code, id }) => [code, id]), ratsnest: pcb.ratsnest };
}
