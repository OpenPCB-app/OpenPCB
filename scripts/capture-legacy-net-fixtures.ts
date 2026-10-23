#!/usr/bin/env bun
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DesignerDerivedNet, DesignerSDK, DesignerSchematicProjection } from "../src/sdks/designer";
import { bootDesignerRuntime, dispatchOk, importCapacitorComponent } from "../src/core/backend/tests/helpers/designer-runtime";
import { getSharedDb, resetSharedSqliteForTesting } from "../src/core/backend/db/sqlite-client";
import { resetCaptureRuntimeForTesting } from "../src/modules/designer/backend/capture";
import { correlateNetPads } from "../src/modules/designer/backend/pcb/net-pad-correlation";
import { pcbEntities } from "../src/modules/designer/backend/schema";
import { netRefForPick } from "../src/modules/designer/frontend/pcb/tools/area-tool-options";
import { captureProvenance, captureRows, sha256 } from "./legacy-net-fixture-dump";

const root = path.resolve(import.meta.dir, "..");
process.chdir(root);
assert(!existsSync("src/modules/designer/backend/net-identity/sync.ts"), "S0 refuses capture after identity sync implementation exists");
const output = path.join(root, "src/core/backend/tests/fixtures/legacy-net-ids");
const fixtureIds = ["f1-routed-clean", "f2-t132-stale", "f3-name-hints", "f9-pour-only-gnd"] as const;
assert(fixtureIds.every((id) => !existsSync(path.join(output, `${id}.json`))), "Refusing to replace existing legacy fixtures");
const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
let temporaryDatabase: string | undefined;

type Runtime = Awaited<ReturnType<typeof bootDesignerRuntime>>;
type Fixture = Awaited<ReturnType<typeof captureRows>>;
type Built = { id: string; parts: string[]; nets: DesignerDerivedNet[]; unnamedId: string };

async function schematic(sdk: DesignerSDK, id: string): Promise<DesignerSchematicProjection> {
  const projection = await sdk.getSchematicProjection(id);
  assert(projection);
  return projection;
}

async function connect(sdk: DesignerSDK, id: string, sourcePinId: string, targetPinId: string): Promise<void> {
  await dispatchOk(sdk, id, { type: "create_wire", sourcePinId, targetPinId });
}

async function nameAtPin(sdk: DesignerSDK, id: string, pinId: string, name: "VCC" | "GND"): Promise<void> {
  const pin = (await schematic(sdk, id)).parts.flatMap((part) => part.pins).find((pin) => pin.id === pinId);
  assert(pin);
  await dispatchOk(sdk, id, name === "GND"
    ? { type: "place_gnd_port", positionNm: pin.worldPositionNm }
    : { type: "place_pwr_port", railText: name, positionNm: pin.worldPositionNm });
}

async function placeParts(sdk: DesignerSDK, id: string, componentId: string, count: number): Promise<string[]> {
  await dispatchOk(sdk, id, { type: "pcb_set_board_outline", outline: { kind: "rect", widthMm: 100, heightMm: 80, centerMm: { x: 35, y: 25 } } });
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const result = await dispatchOk(sdk, id, { type: "place_part", componentId, positionNm: { x: index * 30_000_000, y: 0 } });
    assert(result.createdEntityId);
    ids.push(result.createdEntityId);
  }
  let pcb = await sdk.getPcbProjection(id);
  assert(pcb);
  for (let index = 0; index < ids.length; index++) {
    const placement = pcb.placements.find((placement) => placement.partId === ids[index]);
    assert(placement);
    await dispatchOk(sdk, id, { type: "pcb_move_placement", placementId: placement.id, positionMm: { x: 15 + index * 20, y: 20 } });
  }
  return ids;
}

async function addUiZone(sdk: DesignerSDK, id: string, netId: string, board: boolean, layer: "F.Cu" | "B.Cu" = board ? "B.Cu" : "F.Cu"): Promise<void> {
  const pcb = await sdk.getPcbProjection(id);
  assert(pcb);
  const net = netRefForPick(Object.entries(pcb.netNames).map(([id, name]) => ({ id, name })), netId);
  assert.equal(net.netId, null);
  assert(net.netName);
  await dispatchOk(sdk, id, {
    type: "pcb_add_zone", layer, net, name: board ? "GND plane" : "Unnamed UI zone",
    region: board ? { kind: "board" } : { kind: "polygon", pointsMm: [{ x: 33, y: 2 }, { x: 59, y: 2 }, { x: 59, y: 12 }, { x: 33, y: 12 }], holesMm: [] },
    padConnection: "solid",
  });
}

async function routeAll(sdk: DesignerSDK, id: string): Promise<void> {
  const source = await schematic(sdk, id);
  const pcb = await sdk.getPcbProjection(id);
  assert(pcb);
  const pads = correlateNetPads(source, pcb.placements).netPads;
  const classId = pcb.board.netClasses[0]!.id;
  for (const net of source.nets) {
    const points = pads.get(net.id);
    assert.equal(points?.length, 2);
    const [a, b] = points!;
    assert(a && b);
    const y = net.name === "GND" ? 30 : net.name === "VCC" ? 10 : 5;
    await dispatchOk(sdk, id, {
      type: "pcb_add_trace", layer: "F.Cu", netId: net.id, netClassId: classId,
      widthMm: 0.25, segmentMode: "manhattan-90", legality: "off",
      pointsNm: [a.worldMm, { x: a.worldMm.x, y }, { x: b.worldMm.x, y }, b.worldMm]
        .map((point) => ({ x: Math.round(point.x * 1_000_000), y: Math.round(point.y * 1_000_000) })),
    });
  }
  const ground = source.nets.find((net) => net.name === "GND")!;
  await dispatchOk(sdk, id, {
    type: "pcb_add_via", centerMm: { x: 35, y: 30 }, netId: ground.id, netClassId: classId,
    diameterMmOverride: 0.8, drillMmOverride: 0.4, legality: "off",
  });
}

async function setReferences(sdk: DesignerSDK, built: Built): Promise<void> {
  const pcb = await sdk.getPcbProjection(built.id);
  assert(pcb);
  const vcc = built.nets.find((net) => net.name === "VCC")!.id;
  const gnd = built.nets.find((net) => net.name === "GND")!.id;
  const base = pcb.board.netClasses[0]!;
  await dispatchOk(sdk, built.id, {
    type: "pcb_set_design_rules", netClasses: [...pcb.board.netClasses, { ...base, id: "legacy-fixture-class", name: "Legacy fixture class" }],
    perNetClassAssignments: { [vcc]: "legacy-fixture-class", [gnd]: "legacy-fixture-class", [built.unnamedId]: "legacy-fixture-class" },
    lengthMatchGroups: [{ id: "legacy-length", name: "Legacy length", netIds: [vcc, built.unnamedId], target: { kind: "longest" }, toleranceMm: 2 }],
    diffPairs: [{ id: "legacy-pair", name: "Legacy pair", pNetId: vcc, nNetId: built.unnamedId }],
    drcRules: [{ id: "legacy-scope", name: "Legacy scoped width", enabled: true, priority: 10, scopes: [{ kind: "net", netIds: [gnd, built.unnamedId] }], constraint: { kind: "trackWidth", minMm: 0.25 } }],
  });
}

async function buildRouted(runtime: Runtime, componentId: string): Promise<Built> {
  const { sdk } = runtime;
  const design = await sdk.createDesign({ name: "H08 S0 routed legacy design" });
  const parts = await placeParts(sdk, design.id, componentId, 3);
  const placed = await schematic(sdk, design.id);
  const pins = parts.map((id) => placed.parts.find((part) => part.id === id)!.pins);
  for (const pair of pins) await connect(sdk, design.id, pair[0]!.id, pair[1]!.id);
  await nameAtPin(sdk, design.id, pins[0]![0]!.id, "VCC");
  await nameAtPin(sdk, design.id, pins[1]![0]!.id, "GND");
  await dispatchOk(sdk, design.id, { type: "set_pin_electrical_intent", pinId: pins[0]![0]!.id, intent: "power_source" });
  const projection = await schematic(sdk, design.id);
  assert.equal(projection.nets.length, 3);
  assert(projection.nets.every((net) => net.pinIds.length === 2));
  const unnamed = projection.nets.find((net) => /^Net_\d+$/.test(net.name));
  assert(unnamed);
  const built = { id: design.id, parts, nets: projection.nets, unnamedId: unnamed.id };
  await routeAll(sdk, design.id);
  await addUiZone(sdk, design.id, unnamed.id, false);
  await addUiZone(sdk, design.id, projection.nets.find((net) => net.name === "GND")!.id, true);
  await setReferences(sdk, built);
  return built;
}

function rawCopper(rows: Fixture): Array<{ id: string; kind: string; netId: string | null; netName?: string | null }> {
  return rows.payload.pcbEntities.filter((row) => ["trace", "via", "zone"].includes(row.kind))
    .map((row) => ({ kind: row.kind, ...JSON.parse(row.payloadJson) as { id: string; netId: string | null; netName?: string | null } }));
}

async function captureRouted(runtime: Runtime, componentId: string) {
  const built = await buildRouted(runtime, componentId);
  const pcb = await runtime.sdk.getPcbProjection(built.id);
  assert(pcb);
  assert.equal(pcb.traces.length, 3);
  assert.equal(pcb.vias.length, 1);
  assert.equal(pcb.ratsnest.length, 0, "F1 routes must connect every logical pin pair");
  const first = captureRows(built.id);
  const zones = rawCopper(first).filter((row) => row.kind === "zone");
  assert(zones.some((zone) => zone.netId === null && /^Net_\d+$/.test(zone.netName ?? "")));
  assert(zones.some((zone) => zone.netId === null && zone.netName === "GND"));
  const rootsBefore = built.nets.map((net) => ({ id: net.id, name: net.name, pinIds: net.pinIds }));
  await dispatchOk(runtime.sdk, built.id, { type: "move_part", partId: built.parts[2]!, positionNm: { x: 72_000_000, y: 7_000_000 } });
  const after = await schematic(runtime.sdk, built.id);
  assert.equal(after.nets.length, rootsBefore.length, "F2 preserves the three-net partition");
  for (const old of rootsBefore) assert(after.nets.some((net) => JSON.stringify(net.pinIds) === JSON.stringify(old.pinIds) && net.name === old.name));
  const stale = rootsBefore.filter((old) => !after.nets.some((net) => net.id === old.id));
  assert(stale.length > 0, "F2 must actually change coordinate roots");
  const second = captureRows(built.id);
  assert.deepEqual(rawCopper(first), rawCopper(second), "Moving a schematic part must leave stored copper refs unchanged");
  assert(rawCopper(second).some((item) => stale.some((net) => net.id === item.netId)));
  return { built, first, second, rootsBefore, rootsAfter: after.nets, stale };
}

async function captureHints(runtime: Runtime, componentId: string) {
  const built = await buildRouted(runtime, componentId);
  const current = await schematic(runtime.sdk, built.id);
  const autoName = current.nets.find((net) => net.id === built.unnamedId)!.name;
  await dispatchOk(runtime.sdk, built.id, { type: "upsert_label", text: autoName, positionNm: { x: 140_000_000, y: 140_000_000 } });
  const projection = await schematic(runtime.sdk, built.id);
  const candidates = projection.nets.filter((net) => net.name === autoName);
  assert.equal(candidates.length, 2, "F3 requires actual auto-name/label collision");
  const pcb = await runtime.sdk.getPcbProjection(built.id);
  assert(pcb);
  const hints = ["VCC", "vcc", "UNKNOWN_SUPPLY", autoName];
  const adapters: Array<{ entityId: string; netId: null; netName: string }> = [];
  for (let index = 0; index < hints.length; index++) {
    const result = await dispatchOk(runtime.sdk, built.id, {
      type: "pcb_add_trace", layer: "B.Cu", netId: null, netClassId: pcb.board.netClasses[0]!.id,
      widthMm: 0.25, segmentMode: "manhattan-90", legality: "off",
      pointsNm: [{ x: 5_000_000, y: (40 + index * 2) * 1_000_000 }, { x: 8_000_000, y: (40 + index * 2) * 1_000_000 }],
    });
    assert(result.createdEntityId);
    const rows = getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.designId, built.id)).all();
    const row = rows.find((row) => row.kind === "trace" && (JSON.parse(row.payloadJson) as { id: string }).id === result.createdEntityId);
    assert(row);
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    payload.netName = hints[index]!;
    getSharedDb().update(pcbEntities).set({ payloadJson: JSON.stringify(payload) }).where(eq(pcbEntities.id, row.id)).run();
    adapters.push({ entityId: result.createdEntityId, netId: null, netName: hints[index]! });
  }
  const rows = captureRows(built.id);
  for (const hint of hints) assert(rawCopper(rows).some((item) => item.netId === null && item.netName === hint));
  return { rows, hints, autoName, ambiguousCandidateRoots: candidates.map((net) => net.id), adapters };
}

async function capturePourOnly(runtime: Runtime, componentId: string) {
  const { sdk } = runtime;
  const design = await sdk.createDesign({ name: "H08 S0 pour-only GND" });
  await placeParts(sdk, design.id, componentId, 1);
  const part = (await schematic(sdk, design.id)).parts[0]!;
  await connect(sdk, design.id, part.pins[0]!.id, part.pins[1]!.id);
  await nameAtPin(sdk, design.id, part.pins[0]!.id, "GND");
  const ground = (await schematic(sdk, design.id)).nets.find((net) => net.name === "GND")!;
  const pcb = await sdk.getPcbProjection(design.id);
  assert(pcb);
  await addUiZone(sdk, design.id, ground.id, true, "F.Cu");
  for (const centerMm of [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 10, y: 30 }, { x: 30, y: 30 }]) {
    await dispatchOk(sdk, design.id, {
      type: "pcb_add_manual_via", centerMm, netId: ground.id, netClassId: pcb.board.netClasses[0]!.id,
      diameterMmOverride: 0.8, drillMmOverride: 0.4, legality: "off",
    });
  }
  const rows = captureRows(design.id);
  const copper = rawCopper(rows);
  assert.equal(copper.filter((item) => item.kind === "trace").length, 0);
  assert.equal(copper.filter((item) => item.kind === "via" && item.netId === ground.id).length, 4);
  assert(copper.some((item) => item.kind === "zone" && item.netId === null && item.netName === "GND"));
  const final = await sdk.getPcbProjection(design.id);
  assert(final);
  assert.equal(final.ratsnest.length, 0, "F9 ground pads must connect through the pour without traces");
  return { rows, groundRoot: ground.id };
}

async function main(): Promise<void> {
  const provenance = captureProvenance();
  const runtime = await bootDesignerRuntime("h08-s0-legacy-capture");
  temporaryDatabase = process.env.OPENPCB_DB_PATH;
  assert(temporaryDatabase && temporaryDatabase !== oldPath, "Capture must use an isolated temporary database");
  const componentId = await importCapacitorComponent(runtime.server);
  const routed = await captureRouted(runtime, componentId);
  const hints = await captureHints(runtime, componentId);
  const pour = await capturePourOnly(runtime, componentId);
  const snapshots = [
    { id: fixtureIds[0], rows: routed.first, observations: { nets: routed.rootsBefore, traces: 3, vias: 1, ratsnest: 0, uiZonesUseNameHints: true, knownIntent: "power_source on passive VCC pin" } },
    { id: fixtureIds[1], rows: routed.second, observations: { rootsBefore: routed.rootsBefore, rootsAfter: routed.rootsAfter, changedRoots: routed.stale, storedCopperUnchangedFromF1: true, operation: "move_part" } },
    { id: fixtureIds[2], rows: hints.rows, observations: { hints: hints.hints, collisionName: hints.autoName, ambiguousCandidateRoots: hints.ambiguousCandidateRoots, importedStyleAdapters: hints.adapters } },
    { id: fixtureIds[3], rows: pour.rows, observations: { groundRoot: pour.groundRoot, traces: 0, stitchingVias: 4, zoneNetId: null, zoneNetName: "GND", zoneRegion: "board" } },
  ];
  await mkdir(output, { recursive: true });
  for (const snapshot of snapshots) {
    const deviations = ["Copper authoring uses legality: off to capture binding facts; fixture names do not claim manufacturing or circuit qualification", "Each passive two-pad capacitor fixture supplies one isolated two-pin net by wiring its two symbol pins together; this tests identity and persistence, not a functional circuit"];
    if (snapshot.id === fixtureIds[2]) deviations.push("SDK creates trace geometry and history; narrow imported-style adapter adds netName to exactly four raw trace payloads because native trace commands expose no netName. Adapter does not rewrite existing history or command rows.");
    const document = { metadata: { fixtureId: snapshot.id, ...provenance, deviations }, ...snapshot.rows, observations: snapshot.observations };
    assert(document.payload.schematic.pins.every((pin) => Object.hasOwn(pin, "electricalIntent")), "Every raw pin row must preserve nullable electrical_intent");
    assert.equal(sha256(JSON.stringify(document.payload)), document.sha256);
    await writeFile(path.join(output, `${snapshot.id}.json`), `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
    console.log(`${snapshot.id}: revision=${document.payload.revision} pcbRows=${document.payload.pcbEntities.length} sha256=${document.sha256}`);
  }
}

try {
  await main();
} finally {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (temporaryDatabase) for (const suffix of ["", "-wal", "-shm"]) await rm(`${temporaryDatabase}${suffix}`, { force: true });
  if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = oldPath;
  if (oldCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
}
