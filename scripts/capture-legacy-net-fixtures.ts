#!/usr/bin/env bun
/**
 * H08 slice S0 — capture REAL pre-H08 designs (coordinate-derived net ids) as
 * raw table dumps, so the net-identity migration (S6) can be tested against
 * what the legacy tree actually writes rather than hand-built rows.
 *
 * Run ONCE on a tree that has no net-identity code; it refuses otherwise:
 *   bun scripts/capture-legacy-net-fixtures.ts [--out <dir>]
 *
 * Output (default `src/core/backend/tests/fixtures/legacy-net-ids/`):
 *   f1-routed-clean   VCC + GND + an unnamed 2-pin net, all routed; via; UI-shaped
 *                     zones; class assignment; length group; diff pair; rule scope
 *   f2-t132-stale     f1 + `move_part`, so every persisted root is stale (T-132)
 *   f3-name-hints     importer-style name hints: VCC / vcc / unknown / a name that
 *                     is both a label and another net's legacy auto name
 *   f9-pour-only-gnd  board zone hinted "GND" + four stitching vias, no GND trace
 *
 * Dump format (`openpcb.legacy-net-fixture/1`): every column of every design row,
 * snake_case as stored, rows ordered by primary key. Ids/timestamps are random
 * per capture, so re-running does not reproduce bytes; commit the output.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../src/core/backend/db/sqlite-client";
import {
  bootDesignerRuntime,
  dispatchOk,
  importCapacitorComponent,
  placeCapacitors,
} from "../src/core/backend/tests/helpers/designer-runtime";
import type {
  DesignerCommand,
  DesignerSDK,
  PcbDrcRule,
  PcbZoneNetRef,
} from "../src/sdks/designer";
import { netRefForPick } from "../src/modules/designer/frontend/pcb/tools/area-tool-options";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const POST_H08_MARKER = path.join(
  REPO_ROOT,
  "src/modules/designer/backend/net-identity/sync.ts",
);
const FORMAT = "openpcb.legacy-net-fixture/1";

interface Ctx {
  sdk: DesignerSDK;
  designId: string;
  componentId: string;
}

interface Pt {
  x: number;
  y: number;
}

const mmToNm = (mm: number): number => Math.round(mm * 1e6);

async function pcb(c: Ctx) {
  const p = await c.sdk.getPcbProjection(c.designId);
  if (!p) throw new Error("no pcb projection");
  return p;
}
async function schematic(c: Ctx) {
  const s = await c.sdk.getSchematicProjection(c.designId);
  if (!s) throw new Error("no schematic projection");
  return s;
}

function send(c: Ctx, command: DesignerCommand) {
  return dispatchOk(c.sdk, c.designId, command);
}

async function pinWorld(c: Ctx, partIndex: number, pinNumber: "1" | "2") {
  const part = (await schematic(c)).parts[partIndex]!;
  const pin = part.pins.find((p) => p.number === pinNumber)!;
  return { id: pin.id, at: pin.worldPositionNm };
}

/** Wire pin→pin; both pins of every wire here are axis-aligned neighbours. */
async function wire(
  c: Ctx,
  a: [number, "1" | "2"],
  b: [number, "1" | "2"],
): Promise<void> {
  const pa = await pinWorld(c, ...a);
  const pb = await pinWorld(c, ...b);
  await send(c, { type: "create_wire", sourcePinId: pa.id, targetPinId: pb.id });
}

async function label(c: Ctx, text: string, at: Pt): Promise<void> {
  await send(c, { type: "upsert_label", text, positionNm: at });
}

/** Net id whose pin set contains the pin (legacy ids are union-find roots). */
async function netOfPin(c: Ctx, partIndex: number, pinNumber: "1" | "2") {
  const pin = await pinWorld(c, partIndex, pinNumber);
  const net = (await schematic(c)).nets.find((n) => n.pinIds.includes(pin.id));
  if (!net) throw new Error("pin has no net");
  return net;
}

/** Pad centre in mm: placement position + pad offset (all footprints here are unrotated). */
async function padMm(c: Ctx, partIndex: number, pinNumber: "1" | "2"): Promise<Pt> {
  const partId = (await schematic(c)).parts[partIndex]!.id;
  const placement = (await pcb(c)).placements.find((pl) => pl.partId === partId);
  if (!placement) throw new Error("no placement for part");
  const pad = placement.footprint.preview?.pads.find((p) => p.number === pinNumber);
  if (!pad) throw new Error("no pad");
  return {
    x: placement.positionMm.x + pad.centerMm.x,
    y: placement.positionMm.y + pad.centerMm.y,
  };
}

async function netClassId(c: Ctx): Promise<string> {
  return (await pcb(c)).board.netClasses[0]!.id;
}

async function trace(
  c: Ctx,
  from: Pt,
  to: Pt,
  netId: string | null,
  layer: "F.Cu" | "B.Cu" = "F.Cu",
): Promise<void> {
  const pts: Pt[] = [{ x: mmToNm(from.x), y: mmToNm(from.y) }];
  if (from.x !== to.x && from.y !== to.y) {
    pts.push({ x: mmToNm(to.x), y: mmToNm(from.y) });
  }
  pts.push({ x: mmToNm(to.x), y: mmToNm(to.y) });
  await send(c, {
    type: "pcb_add_trace",
    layer,
    pointsNm: pts,
    widthMm: 0.25,
    netId,
    netClassId: await netClassId(c),
    segmentMode: "manhattan-90",
    legality: "off",
  });
}

async function via(c: Ctx, centerMm: Pt, netId: string | null): Promise<void> {
  await send(c, {
    type: "pcb_add_via",
    centerMm,
    netId,
    netClassId: await netClassId(c),
    legality: "off",
  });
}

async function zone(
  c: Ctx,
  layer: "F.Cu" | "B.Cu",
  net: PcbZoneNetRef,
  region: "board" | Pt[],
): Promise<void> {
  await send(c, {
    type: "pcb_add_zone",
    layer,
    net,
    region:
      region === "board"
        ? { kind: "board" }
        : { kind: "polygon", pointsMm: region },
  });
}

/** Axis-aligned rectangle around every placement, padded by `marginMm`. */
async function hullMm(c: Ctx, marginMm: number): Promise<Pt[]> {
  const ps = (await pcb(c)).placements.map((p) => p.positionMm);
  const x0 = Math.min(...ps.map((p) => p.x)) - marginMm;
  const x1 = Math.max(...ps.map((p) => p.x)) + marginMm;
  const y0 = Math.min(...ps.map((p) => p.y)) - marginMm;
  const y1 = Math.max(...ps.map((p) => p.y)) + marginMm;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

async function pcbNets(c: Ctx): Promise<Array<{ id: string; name: string }>> {
  return Object.entries((await pcb(c)).netNames).map(([id, name]) => ({
    id,
    name,
  }));
}

/** The zone net the way the UI persists a pick (`netRefForPick`). */
async function uiZoneNet(c: Ctx, netId: string): Promise<PcbZoneNetRef> {
  return netRefForPick(await pcbNets(c), netId);
}

async function newCtx(label_: string, caps: number): Promise<Ctx> {
  const { sdk: s, server } = await bootDesignerRuntime(`legacy-net-${label_}`);
  const componentId = await importCapacitorComponent(server);
  const design = await s.createDesign({ name: label_ });
  await placeCapacitors(s, design.id, componentId, caps);
  // Materialise the PCB placements through the projection read (legacy behaviour).
  await s.getPcbProjection(design.id);
  const ctx = { sdk: s, designId: design.id, componentId };
  await layoutInsideOutline(ctx);
  return ctx;
}

/**
 * Auto-placement stacks parts at x~31 mm, outside the default 50x30 mm outline
 * centred on the origin. Stack them at x=0, 4 mm pitch, centred on y=0 so all
 * pads/copper sit on the board. Pins: pad 1 at x-0.775, pad 2 at x+0.775.
 */
async function layoutInsideOutline(c: Ctx): Promise<void> {
  const parts = (await schematic(c)).parts;
  const placements = (await pcb(c)).placements;
  const updates = parts.map((part, i) => {
    const pl = placements.find((p) => p.partId === part.id);
    if (!pl) throw new Error("no placement for part");
    return {
      placementId: pl.id,
      positionMm: { x: 0, y: (i - (parts.length - 1) / 2) * 4 },
    };
  });
  await send(c, { type: "pcb_move_placements", updates });
}

const FORBIDDEN_DRC = new Set([
  "COPPER_OFF_BOARD",
  "NET_SHORT_CIRCUIT",
  "ZONE_EMPTY_FILL",
  "VIA_DANGLING",
]);

/** Refuse to capture a fixture whose geometry is degenerate (off-board / shorted). */
async function assertDrcSane(c: Ctx, name: string, allow: string[]): Promise<void> {
  const report = await c.sdk.runDrc(c.designId);
  if (!report) throw new Error(`${name}: no DRC report`);
  const bad = report.violations.filter(
    (v) => FORBIDDEN_DRC.has(v.code) && !allow.includes(v.code),
  );
  if (bad.length > 0) {
    throw new Error(
      `${name}: degenerate geometry: ${bad.map((v) => `${v.code} (${v.message})`).join("; ")}`,
    );
  }
}

// ───────────────────────────── scenarios ─────────────────────────────

/** C1..C4 at 10 mm pitch, pins vertical (pin 1 at +y, pin 2 at -y). */
async function buildF1(c: Ctx): Promise<void> {
  const p1c1 = await pinWorld(c, 0, "1");
  const p2c1 = await pinWorld(c, 0, "2");
  await wire(c, [0, "1"], [1, "1"]); // VCC
  await wire(c, [0, "2"], [1, "2"]); // GND
  await wire(c, [2, "2"], [1, "2"]); // GND, third cap
  await wire(c, [2, "1"], [3, "1"]); // the unnamed 2-pin net
  await label(c, "VCC", p1c1.at);
  await label(c, "GND", p2c1.at);
  // C4 pin 2 stays unwired: a standalone single-pin net.

  const vcc = await netOfPin(c, 0, "1");
  const gnd = await netOfPin(c, 0, "2");
  const anon = await netOfPin(c, 2, "1");

  await trace(c, await padMm(c, 0, "1"), await padMm(c, 1, "1"), vcc.id);
  await trace(c, await padMm(c, 0, "2"), await padMm(c, 1, "2"), gnd.id);
  await trace(c, await padMm(c, 1, "2"), await padMm(c, 2, "2"), gnd.id);
  await trace(c, await padMm(c, 2, "1"), await padMm(c, 3, "1"), anon.id);
  // On the Net_2 trace, midway between the two pads (clear of every pad).
  const m0 = await padMm(c, 2, "1");
  const m1 = await padMm(c, 3, "1");
  const viaAt = { x: m0.x, y: (m0.y + m1.y) / 2 };
  await via(c, viaAt, anon.id);
  // B.Cu stub so the via joins two layers of Net_2 copper.
  await trace(c, viaAt, { x: viaAt.x, y: viaAt.y + 0.5 }, anon.id, "B.Cu");

  const hull = await hullMm(c, 4);
  await zone(c, "F.Cu", await uiZoneNet(c, anon.id), hull); // {null, "Net_k"}
  await zone(c, "B.Cu", await uiZoneNet(c, gnd.id), "board"); // {null, "GND"}

  const rule: PcbDrcRule = {
    id: "rule-gnd-clearance",
    name: "GND clearance",
    enabled: true,
    priority: 1,
    scopes: [{ kind: "net", netIds: [gnd.id] }],
    constraint: { kind: "clearance", mm: 0.3 },
  };
  await send(c, {
    type: "pcb_set_design_rules",
    perNetClassAssignments: { [gnd.id]: "gnd" },
    lengthMatchGroups: [
      {
        id: "lg-1",
        name: "VCC/anon",
        netIds: [vcc.id, anon.id],
        target: { kind: "longest" },
        toleranceMm: 0.5,
      },
    ],
    diffPairs: [
      { id: "dp-1", name: "VCC/anon pair", pNetId: vcc.id, nNetId: anon.id },
    ],
    drcRules: [rule],
  });
}

async function buildF2(c: Ctx): Promise<void> {
  await buildF1(c);
  await assertDrcSane(c, "f2 (pre-move)", []);
  // C2.p2 holds the GND union-find root and C4.p1 the Net_2 root; moving C2
  // changes the GND root id, so persisted GND refs go stale (T-132).
  const idsBefore = new Set((await schematic(c)).nets.map((n) => n.id));
  const part = (await schematic(c)).parts[1]!;
  await send(c, {
    type: "move_part",
    partId: part.id,
    positionNm: { x: part.positionNm.x + 5_000_000, y: part.positionNm.y },
  });
  const idsAfter = new Set((await schematic(c)).nets.map((n) => n.id));
  const changed = [...idsBefore].filter((id) => !idsAfter.has(id));
  if (changed.length === 0) throw new Error("F2: no legacy net id changed");
  const persisted = new Set<string>();
  for (const row of getSharedSqlite()
    .query(
      "SELECT payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind IN ('trace','via')",
    )
    .all(c.designId) as Array<{ payload_json: string }>) {
    const id = (JSON.parse(row.payload_json) as { netId?: string | null }).netId;
    if (id) persisted.add(id);
  }
  if (![...persisted].some((id) => !idsAfter.has(id))) {
    throw new Error("F2: no persisted copper net id is stale");
  }
}

/** Rewrite one copper row's payload the way a KiCad importer leaves it. */
function setImporterHint(
  kind: "trace" | "via",
  ordinal: number,
  designId: string,
  netName: string,
): void {
  const db = getSharedSqlite();
  const rows = db
    .query(
      "SELECT id, payload_json FROM designer_pcb_entities WHERE design_id = ? AND kind = ? ORDER BY id",
    )
    .all(designId, kind) as Array<{ id: string; payload_json: string }>;
  const row = rows[ordinal];
  if (!row) throw new Error(`no ${kind} #${ordinal}`);
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  payload.netId = null;
  payload.netName = netName;
  db.query("UPDATE designer_pcb_entities SET payload_json = ? WHERE id = ?").run(
    JSON.stringify(payload),
    row.id,
  );
}

async function buildF3(c: Ctx): Promise<void> {
  // Pins are all standalone nets until wired. Wire C1.p1-C2.p1 so VCC is 2 pins.
  await wire(c, [0, "1"], [1, "1"]);
  const p1c1 = await pinWorld(c, 0, "1");
  const before = await schematic(c);
  const autoFirst = before.nets.find((n) => /^Net_1$/.test(n.name));
  if (!autoFirst) throw new Error("expected a Net_1 before labelling");
  await label(c, "VCC", p1c1.at);

  // Name another net "Net_1" while a different net keeps the legacy auto name
  // "Net_1": pick a pin whose net is NOT the one currently called Net_1.
  const after = await schematic(c);
  const holder = after.nets.find((n) => n.name === "Net_1");
  const victim = after.parts
    .flatMap((p) => p.pins)
    .find((pin) => {
      const net = after.nets.find((n) => n.pinIds.includes(pin.id))!;
      return net.name !== "VCC" && net.name !== "Net_1";
    });
  if (!holder || !victim) throw new Error("cannot build the ambiguous-name case");
  await label(c, "Net_1", victim.worldPositionNm);
  const final = await schematic(c);
  if (final.nets.filter((n) => n.name === "Net_1").length !== 2) {
    throw new Error("F3 expects two nets named Net_1 (label + legacy auto)");
  }

  const hull = await hullMm(c, 4);
  const hint = (netName: string): PcbZoneNetRef => ({ netId: null, netName });
  await zone(c, "F.Cu", hint("VCC"), hull);
  await zone(c, "B.Cu", hint("vcc"), hull);
  await zone(c, "F.Cu", hint("NO_SUCH_NET"), hull);
  await zone(c, "B.Cu", hint("Net_1"), hull);

  // Importer-style trace/via hints: no netId, only a name.
  await trace(c, await padMm(c, 0, "1"), await padMm(c, 1, "1"), null);
  await via(c, { x: 8, y: 8 }, null);
  setImporterHint("trace", 0, c.designId, "VCC");
  setImporterHint("via", 0, c.designId, "vcc");
}

async function buildF9(c: Ctx): Promise<void> {
  const p2 = await pinWorld(c, 0, "2");
  await wire(c, [0, "2"], [1, "2"]);
  await label(c, "GND", p2.at);
  const gnd = await netOfPin(c, 0, "2");
  // Pour-only: a board zone hinted "GND", stitching vias carry the GND root,
  // and there is deliberately no GND trace.
  await zone(c, "B.Cu", { netId: null, netName: "GND" }, "board");
  await zone(c, "F.Cu", { netId: null, netName: "GND" }, "board"); // vias join both pours
  // Clear of every pad (pads at x +-0.775, 0.9 mm wide) and inside the pour.
  const a = await padMm(c, 0, "2");
  const b = await padMm(c, 1, "2");
  for (const centerMm of [
    { x: a.x + 3, y: a.y },
    { x: a.x + 5, y: a.y },
    { x: b.x + 3, y: b.y },
    { x: b.x + 5, y: b.y },
  ]) {
    await via(c, centerMm, gnd.id);
  }
}

// ───────────────────────────── dump ─────────────────────────────

const DESIGN_TABLES: Array<{ table: string; key: "id" | "design_id" }> = [
  { table: "designer_design_heads", key: "id" },
  { table: "designer_schematic_parts", key: "design_id" },
  { table: "designer_schematic_pins", key: "design_id" },
  { table: "designer_schematic_wires", key: "design_id" },
  { table: "designer_schematic_labels", key: "design_id" },
  { table: "designer_schematic_primitives", key: "design_id" },
  { table: "designer_pcb_entities", key: "design_id" },
  { table: "designer_session_histories", key: "design_id" },
];

function dumpDesign(designId: string): Record<string, unknown[]> {
  const db = getSharedSqlite();
  const out: Record<string, unknown[]> = {};
  for (const { table, key } of DESIGN_TABLES) {
    out[table] = db
      .query(`SELECT * FROM ${table} WHERE ${key} = ? ORDER BY id`)
      .all(designId) as unknown[];
  }
  return out;
}

interface Scenario {
  name: string;
  caps: number;
  description: string;
  build: (c: Ctx) => Promise<void>;
  /** DRC codes this scenario intentionally provokes. */
  allowDrc?: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "f1-routed-clean",
    caps: 4,
    description:
      "VCC, GND and an unnamed 2-pin net, all routed (traces + via); UI-shaped zones (unnamed net as {null,'Net_k'}, GND as {null,'GND'}); class assignment, length group, diff pair, rule scope on legacy roots; C4.p2 is a standalone pin.",
    build: buildF1,
  },
  {
    name: "f2-t132-stale",
    caps: 4,
    description:
      "f1 followed by move_part of C3: schematic roots changed, persisted copper/settings still hold the old roots (T-132).",
    build: buildF2,
    // Stale roots make persisted copper disagree with the live nets by design.
    allowDrc: ["NET_SHORT_CIRCUIT"],
  },
  {
    name: "f3-name-hints",
    caps: 3,
    description:
      "Importer-style hints with no netId: zones 'VCC','vcc','NO_SUCH_NET','Net_1' (label on one net AND legacy auto name of another => ambiguous); trace hint 'VCC'; via hint 'vcc'.",
    build: buildF3,
    // Unresolved/ambiguous zone names and the lone hint via are intentional.
    allowDrc: ["ZONE_EMPTY_FILL", "VIA_DANGLING"],
  },
  {
    name: "f9-pour-only-gnd",
    caps: 2,
    description:
      "Pour-only GND: board zone hinted 'GND', four stitching vias carrying the GND legacy root, no GND traces.",
    build: buildF9,
  },
];

function parseOutDir(): string {
  const i = process.argv.indexOf("--out");
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]!);
  return path.join(REPO_ROOT, "src/core/backend/tests/fixtures/legacy-net-ids");
}

async function main(): Promise<void> {
  if (existsSync(POST_H08_MARKER)) {
    throw new Error(
      "net-identity code present: fixtures must be captured on a pre-H08 tree (legacy ids).",
    );
  }
  const outDir = parseOutDir();
  mkdirSync(outDir, { recursive: true });
  for (const scenario of SCENARIOS) {
    const ctx = await newCtx(scenario.name, scenario.caps);
    await scenario.build(ctx);
    await assertDrcSane(ctx, scenario.name, scenario.allowDrc ?? []);
    const head = await ctx.sdk.getSchematicProjection(ctx.designId);
    const dump = {
      format: FORMAT,
      name: scenario.name,
      description: scenario.description,
      designId: ctx.designId,
      revision: head?.revision ?? null,
      legacyNets: (head?.nets ?? []).map((n) => ({
        id: n.id,
        name: n.name,
        pinIds: n.pinIds,
      })),
      tables: dumpDesign(ctx.designId),
    };
    const file = path.join(outDir, `${scenario.name}.json`);
    writeFileSync(file, `${JSON.stringify(dump, null, 2)}\n`);
    console.log(`wrote ${file}`);
    const dbPath = process.env.OPENPCB_DB_PATH;
    resetSharedSqliteForTesting();
    if (dbPath) {
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${dbPath}${suffix}`, { force: true });
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
