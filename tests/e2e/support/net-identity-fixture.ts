import { expect, type APIRequestContext } from "@playwright/test";
import type {
  DesignerCommand, DesignerCommandOkResult, DesignerDispatchResult,
  DesignerNetIdentityStatus, DesignerPcbProjection, DesignerPlacedPart,
  DesignerSchematicProjection, DrcReport,
} from "../../../src/sdks/designer";

export const DESIGNER_API = "http://127.0.0.1:3000/api/modules/designer";
const LIBRARY_API = "http://127.0.0.1:3000/api/modules/library";
const NM = 1_000_000;

export async function schematic(request: APIRequestContext, id: string): Promise<DesignerSchematicProjection> {
  const response = await request.get(`${DESIGNER_API}/designs/${id}/projection/schematic`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { data: { projection: DesignerSchematicProjection } }).data.projection;
}

export async function pcb(request: APIRequestContext, id: string): Promise<DesignerPcbProjection> {
  const response = await request.get(`${DESIGNER_API}/designs/${id}/projection/pcb`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { data: { projection: DesignerPcbProjection } }).data.projection;
}

export async function identity(request: APIRequestContext, id: string): Promise<DesignerNetIdentityStatus> {
  const response = await request.get(`${DESIGNER_API}/designs/${id}/net-identity`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { data: DesignerNetIdentityStatus }).data;
}

export async function drc(request: APIRequestContext, id: string): Promise<DrcReport> {
  const response = await request.post(`${DESIGNER_API}/designs/${id}/drc/run`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { data: { report: DrcReport } }).data.report;
}

export async function seedCommand(request: APIRequestContext, id: string, command: DesignerCommand): Promise<DesignerCommandOkResult> {
  const current = await schematic(request, id);
  const response = await request.post(`${DESIGNER_API}/designs/${id}/commands`, { data: {
    commandId: crypto.randomUUID(), sessionId: "e2e-net-identity-seed", aggregateId: id,
    baseRevision: current.revision, issuedAt: Date.now(), command,
  } });
  expect(response.ok(), await response.text()).toBe(true);
  const result = (await response.json() as { data: { result: DesignerDispatchResult } }).data.result;
  if (!result.ok) throw new Error(`Fixture command failed: ${JSON.stringify({ command, result })}`);
  return result;
}

async function importProbe(request: APIRequestContext): Promise<string> {
  const name = `Net identity probe ${crypto.randomUUID()}`;
  const response = await request.post(`${LIBRARY_API}/imports/drawn`, { data: {
    drawnSymbol: { referencePrefix: "U", source: {
      name, unitCount: 1, referenceText: "U?", valueText: "Identity probe",
      pins: [-2, 2].map((x, index) => ({
        id: `pin-${index + 1}`, number: `${index + 1}`, name: `P${index + 1}`,
        electricalType: "passive", unit: 1, hidden: false,
        positionMm: { x, y: 0 }, lengthMm: 1, rotationDeg: index === 0 ? 0 : 180,
      })),
      graphics: [{ unit: 1, graphic: { kind: "rect", x: -1, y: -0.8,
        width: 2, height: 1.6, fill: "none", strokeWidthMm: 0.12 } }], warnings: [],
    } },
    footprintMode: "drawn", drawnFootprint: {
      source: { name, pads: [-1, 1].map((x, index) => ({
        id: `pad-${index + 1}`, number: `${index + 1}`, shape: "rect",
        centerMm: { x, y: 0 }, widthMm: 0.6, heightMm: 0.6, rotationDeg: 0, layer: "F.Cu",
      })), graphics: [], labels: [], warnings: [] },
      metadata: { name, mountType: "smd", packageCode: { imperial: null, metric: null }, tags: [] },
    }, component: { name, description: "Native durable-net browser fixture" },
  } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { data: { componentId: string } }).data.componentId;
}

async function placeProbeParts(request: APIRequestContext, id: string, componentId: string): Promise<DesignerPlacedPart[]> {
  const parts: DesignerPlacedPart[] = [];
  for (const [x, y] of [[0, 0], [20, 0], [40, 20], [60, 20], [60, 40]]) {
    const result = await seedCommand(request, id, {
      type: "place_part", componentId, positionNm: { x: x! * NM, y: y! * NM },
    });
    const part = (await schematic(request, id)).parts.find((entry) => entry.id === result.createdEntityId);
    if (!part) throw new Error("Placed probe missing from schematic projection");
    parts.push(part);
  }
  return parts;
}

function probePin(part: DesignerPlacedPart, number: string) {
  const found = part.pins.find((entry) => entry.number === number);
  if (!found) throw new Error(`Probe pin ${number} missing`);
  return found;
}

async function wireAndName(request: APIRequestContext, id: string, parts: DesignerPlacedPart[]): Promise<void> {
  for (const [from, fromPin, to, toPin] of [[0, "2", 1, "1"], [2, "2", 3, "1"], [3, "1", 4, "1"]] as const) {
    await seedCommand(request, id, { type: "create_wire",
      sourcePinId: probePin(parts[from]!, fromPin).id, targetPinId: probePin(parts[to]!, toPin).id });
  }
  // The named label stays on the fixed endpoint while the other part is dragged.
  for (const [index, number, text] of [[1, "1", "ROUTED"], [2, "2", "MAIN"]] as const) {
    await seedCommand(request, id, { type: "upsert_label", text,
      positionNm: probePin(parts[index]!, number).worldPositionNm });
  }
}

async function routeAndConstrain(request: APIRequestContext, id: string, parts: DesignerPlacedPart[], netId: string): Promise<void> {
  let board = await pcb(request, id);
  const positions = [[-10, 0], [0, 0], [10, 7], [16, 7], [16, 14]];
  for (const [index, part] of parts.entries()) {
    const placement = board.placements.find((entry) => entry.partId === part.id)!;
    await seedCommand(request, id, { type: "pcb_move_placement", placementId: placement.id,
      positionMm: { x: positions[index]![0]!, y: positions[index]![1]! } });
  }
  board = await pcb(request, id);
  const centers = parts.slice(0, 2).map((part, index) => {
    const placement = board.placements.find((entry) => entry.partId === part.id)!;
    expect(placement.rotationDeg).toBe(0);
    expect(placement.mirrored).toBe(false);
    const number = index === 0 ? "2" : "1";
    const pad = placement.footprint.preview!.pads.find((entry) => entry.number === number)!;
    expect(board.padNets?.[`${placement.id}|${number}`]).toBe(netId);
    return { x: Math.round((placement.positionMm.x + pad.centerMm.x) * NM),
      y: Math.round((placement.positionMm.y + pad.centerMm.y) * NM) };
  });
  const [a, b] = centers;
  await seedCommand(request, id, { type: "pcb_add_trace", layer: "F.Cu",
    pointsNm: [a!, { x: a!.x, y: -3 * NM }, { x: b!.x, y: -3 * NM }, b!],
    widthMm: 0.25, netId, netClassId: board.board.netClasses[0]!.id, segmentMode: "manhattan-90" });
  await seedCommand(request, id, { type: "pcb_set_design_rules",
    perNetClassAssignments: { [netId]: board.board.netClasses[0]!.id },
    lengthMatchGroups: [{ id: "identity-length", name: "Identity length", netIds: [netId],
      target: { kind: "absolute", mm: 16 }, toleranceMm: 1 }],
    drcRules: [{ id: "identity-clearance", name: "Identity clearance", enabled: true, priority: 1,
      scopes: [{ kind: "net", netIds: [netId] }], constraint: { kind: "clearance", mm: 0.25 } }],
  });
}

export async function seedIdentityScene(request: APIRequestContext) {
  const componentId = await importProbe(request), name = `Net identity ${crypto.randomUUID()}`;
  const response = await request.post(`${DESIGNER_API}/designs`, { data: { name } });
  expect(response.status(), await response.text()).toBe(201);
  const id = (await response.json() as { data: { design: { id: string } } }).data.design.id;
  const parts = await placeProbeParts(request, id, componentId);
  await wireAndName(request, id, parts);
  const source = await schematic(request, id);
  const routed = source.nets.find((entry) => entry.name === "ROUTED")!;
  const larger = source.nets.find((entry) => entry.name === "MAIN")!;
  expect(routed.pinIds).toHaveLength(2);
  expect(larger.pinIds).toHaveLength(3);
  expect(routed.id).toMatch(/^net:[a-z2-7]{10}:[1-9][0-9]*$/);
  await routeAndConstrain(request, id, parts, routed.id);
  const before = await pcb(request, id);
  expect(before.traces).toHaveLength(1);
  expect(before.ratsnest.filter((entry) => entry.netId === routed.id)).toEqual([]);
  expect((await identity(request, id)).orphanedCopperCount).toBe(0);
  return { id, name, parts, routedId: routed.id, largerId: larger.id,
    routedLabelId: source.labels.find((entry) => entry.text === "ROUTED")!.id, before };
}

export type IdentityScene = Awaited<ReturnType<typeof seedIdentityScene>>;
