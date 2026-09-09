/**
 * The server-side copper commit gate (live-parity contract 07 §6): the five
 * copper-creating commands run the REFERENCE DRC verdict on the copper they are
 * about to commit, refuse the refuse set unless `legality: "report"`, compute
 * nothing under `"off"`, and report counts on the ok result.
 *
 * Every case runs through a real runtime + `dispatchCommand`, because the point
 * of the gate is that it is built from the rows the dispatcher holds — a
 * unit-level call could not catch a projection load leaking into the history.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommand,
  DesignerCommandEnvelope,
  DesignerDispatchResult,
  DesignerSDK,
  PcbCopperLayerId,
  PcbPointMm,
  PcbTraceSegmentMode,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { runDrc } from "../../../shared/drc/drc-engine";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { getKicadFixtureDir } from "./helpers/kicad-fixtures";

const SESSION = "copper-gate-session";
const F_CU = "F.Cu" as PcbCopperLayerId;
const MANHATTAN = "manhattan-90" as PcbTraceSegmentMode;
const NET_A = "net-a";
const NET_B = "net-b";

/** Flat mm coordinate pairs → the integer-nanometre path that is persisted. */
function pts(...mm: number[]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < mm.length; i += 2) {
    out.push({ x: Math.round(mm[i]! * 1e6), y: Math.round(mm[i + 1]! * 1e6) });
  }
  return out;
}

interface Harness {
  sdk: DesignerSDK;
  designId: string;
  netClassId: string;
  server: ReturnType<typeof createHttpServer>;
}

function isolateTestDb(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime() {
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime, server };
}

async function newBoard(label: string): Promise<Harness> {
  isolateTestDb(label);
  const { moduleRuntime, server } = await createRuntime();
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await sdk.createDesign({ name: label });
  const projection = await sdk.getPcbProjection(design.id);
  return {
    sdk,
    designId: design.id,
    netClassId: projection!.board.netClasses[0]!.id,
    server,
  };
}

let commandSeq = 0;

/** `baseRevision: null` — these tests are about the gate, not about conflicts. */
function envelope(
  designId: string,
  command: DesignerCommand,
): DesignerCommandEnvelope {
  commandSeq += 1;
  return {
    commandId: `copper-gate-${commandSeq}`,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

function dispatch(
  h: Harness,
  command: DesignerCommand,
): Promise<DesignerDispatchResult> {
  return h.sdk.dispatchCommand(h.designId, envelope(h.designId, command));
}

function trace(
  h: Harness,
  netId: string | null,
  pointsNm: Array<{ x: number; y: number }>,
  widthMm = 0.25,
) {
  return {
    layer: F_CU,
    pointsNm,
    widthMm,
    netId,
    netClassId: h.netClassId,
    segmentMode: MANHATTAN,
  };
}

/** Land board copper the gate must not be consulted about (the fixture). */
async function seedTrace(
  h: Harness,
  netId: string | null,
  pointsNm: Array<{ x: number; y: number }>,
  widthMm = 0.25,
): Promise<string> {
  const result = await dispatch(h, {
    type: "pcb_add_trace",
    ...trace(h, netId, pointsNm, widthMm),
    legality: "off",
  });
  if (!result.ok || !result.createdEntityId) {
    throw new Error(`seed trace failed: ${JSON.stringify(result)}`);
  }
  return result.createdEntityId;
}

async function seedVia(
  h: Harness,
  netId: string | null,
  centerMm: PcbPointMm,
): Promise<string> {
  const result = await dispatch(h, {
    type: "pcb_add_via",
    centerMm,
    netId,
    netClassId: h.netClassId,
    legality: "off",
  });
  if (!result.ok || !result.createdEntityId) {
    throw new Error(`seed via failed: ${JSON.stringify(result)}`);
  }
  return result.createdEntityId;
}

function refusal(result: DesignerDispatchResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  expect(result.code).toBe("PCB_COPPER_ILLEGAL");
  if (result.code !== "PCB_COPPER_ILLEGAL") throw new Error("wrong code");
  return result;
}

function accepted(result: DesignerDispatchResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

/** The crossing foreign run every "dead short" case commits against. */
function crossingRun(h: Harness) {
  return trace(h, NET_B, pts(0, -5, 0, 5));
}

describe("copper commit gate (contract 07 §6)", () => {
  test("1 — a crossing foreign trace is refused and nothing is persisted", async () => {
    const h = await newBoard("copper-gate-refuse");
    await seedTrace(h, NET_A, pts(-5, 0, 5, 0));
    const before = await h.sdk.getPcbProjection(h.designId);

    const refused = refusal(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [crossingRun(h)],
        vias: [],
      }),
    );
    // Whatever batch calls a different-net overlap, the gate calls it too.
    expect(["NET_SHORT_CIRCUIT", "TRACE_TO_TRACE_CLEARANCE"]).toContain(
      refused.violations[0]!.code,
    );
    expect(refused.detail).toContain(refused.violations[0]!.code);

    const after = await h.sdk.getPcbProjection(h.designId);
    expect(after!.traces).toHaveLength(before!.traces.length);
    expect(after!.revision).toBe(before!.revision);
  });

  test("2 — legality:report commits the same route and counts the refusal", async () => {
    const h = await newBoard("copper-gate-report");
    await seedTrace(h, NET_A, pts(-5, 0, 5, 0));

    const result = accepted(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [crossingRun(h)],
        vias: [],
        legality: "report",
      }),
    );
    expect(result.legality).toEqual({ refused: 1, warnings: 0 });
    expect((await h.sdk.getPcbProjection(h.designId))!.traces).toHaveLength(2);
  });

  test("3 — legality:off computes no verdict at all", async () => {
    const h = await newBoard("copper-gate-off");
    await seedTrace(h, NET_A, pts(-5, 0, 5, 0));

    const result = accepted(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [crossingRun(h)],
        vias: [],
        legality: "off",
      }),
    );
    expect("legality" in result).toBe(false);
    expect((await h.sdk.getPcbProjection(h.designId))!.traces).toHaveLength(2);
  });

  test("4 — a clean route reports zero refusals and zero warnings", async () => {
    const h = await newBoard("copper-gate-clean");
    const result = accepted(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [trace(h, NET_A, pts(-10, 5, 10, 5))],
        vias: [],
      }),
    );
    expect(result.legality).toEqual({ refused: 0, warnings: 0 });
  });

  test("4b — two runs of ONE batch are judged against each other", async () => {
    const h = await newBoard("copper-gate-pending-pairs");
    // Neither run is on the board yet: only pending × pending sees this.
    const refused = refusal(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [
          trace(h, NET_A, pts(-5, 0, 5, 0)),
          trace(h, NET_B, pts(0, -5, 0, 5)),
        ],
        vias: [],
      }),
    );
    expect(refused.violations[0]!.code).toBe("NET_SHORT_CIRCUIT");
    expect((await h.sdk.getPcbProjection(h.designId))!.traces).toHaveLength(0);
  });

  test("5 — every refused violation is in the batch report, to the bit", async () => {
    const h = await newBoard("copper-gate-parity");
    await seedTrace(h, NET_A, pts(-5, 0, 5, 0));
    // `report` so the copper actually lands: batch can only be asked about a
    // board that exists, and the ids the gate reported ARE the inserted ids.
    const committed = accepted(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [crossingRun(h)],
        vias: [],
        legality: "report",
      }),
    );
    expect(committed.legality!.refused).toBe(1);

    // Re-judge the SAME geometry under `refuse` (a no-op reshape of the trace
    // just committed) to recover the violation objects the gate produced.
    const landed = (await h.sdk.getPcbProjection(h.designId))!.traces.find(
      (t) => t.netId === NET_B,
    )!;
    const blocked = refusal(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: landed.id,
        pointsNm: landed.pointsNm,
      }),
    );

    const report = runDrc((await h.sdk.getPcbProjection(h.designId))!);
    const byId = new Map(report.violations.map((v) => [v.id, v]));
    expect(blocked.violations.length).toBeGreaterThan(0);
    for (const violation of blocked.violations) {
      const batch = byId.get(violation.id);
      expect(batch).toBeDefined();
      expect(batch!.code).toBe(violation.code);
      expect(batch!.measuredMm).toBe(violation.measuredMm!);
      expect(batch!.requiredMm).toBe(violation.requiredMm!);
      expect(batch!.message).toBe(violation.message);
    }
  });

  test("6 — every trace geometry update is judged, truncations included", async () => {
    const h = await newBoard("copper-gate-geometry");

    // (a) reshaping into a foreign pad.
    const pad = await dispatch(h, {
      type: "pcb_add_free_pad",
      centerMm: { x: 5, y: 5 },
      rotationDeg: 0,
      padType: "smd",
      shape: "rect",
      widthMm: 1,
      heightMm: 1,
      layer: F_CU,
      netId: NET_B,
    });
    expect(pad.ok).toBe(true);
    const intoPad = await seedTrace(h, NET_A, pts(-5, 5, 0, 5));
    const reshaped = refusal(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: intoPad,
        pointsNm: pts(-5, 5, 5, 5),
      }),
    );
    expect(reshaped.violations.map((v) => v.code)).toContain(
      "NET_SHORT_CIRCUIT",
    );

    // (b) dropping interior vertices draws a NEW segment — a vertex
    // subsequence is not a copper subset (Astra run 1 #2).
    await seedVia(h, NET_B, { x: 0, y: -5 });
    const around = await seedTrace(h, NET_A, pts(-5, -5, -5, -8, 5, -8, 5, -5));
    const straightened = refusal(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: around,
        pointsNm: pts(-5, -5, 5, -5),
      }),
    );
    expect(straightened.violations.map((v) => v.code)).toContain(
      "NET_SHORT_CIRCUIT",
    );

    // (c) a truncation that genuinely clears is accepted — and still judged.
    const clean = await seedTrace(h, NET_A, pts(-12, 10, 12, 10));
    const truncated = accepted(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: clean,
        pointsNm: pts(-12, 10, 0, 10),
      }),
    );
    expect(truncated.legality).toEqual({ refused: 0, warnings: 0 });
    const after = await h.sdk.getPcbProjection(h.designId);
    expect(after!.traces.find((t) => t.id === clean)!.pointsNm).toEqual(
      pts(-12, 10, 0, 10),
    );

    // (d) `replaces` removes the edited row: an UNASSIGNED trace is not "same
    // net" as itself, and a nudge of 0.35 mm leaves a 0.10 mm gap to where it
    // used to be — near, not touching, so the extension rule does not absorb it
    // and without `replaces` the trace would be refused against its own ghost.
    const unassigned = await seedTrace(h, null, pts(-12, -13, 12, -13));
    const moved = accepted(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: unassigned,
        pointsNm: pts(-12, -13.35, 12, -13.35),
      }),
    );
    expect(moved.legality).toEqual({ refused: 0, warnings: 0 });
  });

  test("6e — the pending item is built from the BOUND row, not the raw one", async () => {
    const h = await newBoard("copper-gate-netname");
    // One GND port is enough to give the schematic a net named "GND", which is
    // what `bindNetName` resolves an importer hint against.
    expect((await dispatch(h, { type: "place_gnd_port", positionNm: { x: 0, y: 0 } })).ok).toBe(true);

    const boardSide = await seedTrace(h, null, pts(-10, 0, 10, 0));
    const edited = await seedTrace(h, null, pts(-10, 5, 10, 5));
    // An imported trace: no `netId`, a `netName` hint the projection binds.
    setNetNameHint(boardSide, "GND");
    setNetNameHint(edited, "GND");

    // 0.35 mm apart → a 0.10 mm gap, below the 0.25 mm rule. Judged from the
    // RAW row the pending trace would be null-net against bound GND copper and
    // refused against its own net; judged from the bound row they are one net.
    const result = accepted(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: edited,
        pointsNm: pts(-10, 0.35, 10, 0.35),
      }),
    );
    expect(result.legality!.refused).toBe(0);
    // Parity: batch binds the hint too, so it sees one net and reports no
    // clearance breach — the gate must not have invented one.
    const report = runDrc((await h.sdk.getPcbProjection(h.designId))!);
    expect(report.violations.map((v) => v.code)).not.toContain(
      "TRACE_TO_TRACE_CLEARANCE",
    );

    // The stored row keeps its hint: binding is a derivation, not a migration.
    const stored = (await h.sdk.getPcbProjection(h.designId))!.traces.find(
      (t) => t.id === edited,
    )!;
    expect(stored.netName).toBe("GND");
    expect(rawTracePayload(edited).netId).toBeNull();
  });

  test("7 — the gate writes nothing: no placement lands in the history patch", async () => {
    isolateTestDb("copper-gate-history");
    const { moduleRuntime, server } = await createRuntime();
    const componentId = await importFixtureComponent(server);
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "copper-gate-history" });
    const h: Harness = {
      sdk,
      designId: design.id,
      netClassId: "default",
      server,
    };

    // A schematic part with NO pcb placement row yet: `loadPcbProjection` would
    // create one (its placement sync writes), and that write would land in this
    // command's undo patch. The projection is deliberately never read first.
    const placed = await dispatch(h, {
      type: "place_part",
      componentId,
      positionNm: { x: 0, y: 0 },
    });
    expect(placed.ok).toBe(true);
    expect(pcbRowCount(design.id, "placement")).toBe(0);

    const routed = accepted(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [trace(h, NET_A, pts(-10, 12, 10, 12))],
        vias: [],
      }),
    );
    expect(routed.legality).toEqual({ refused: 0, warnings: 0 });
    expect(pcbRowCount(design.id, "placement")).toBe(0);
    expect(undoStackJson(design.id)).not.toContain("designer.pcb_placement");
  });

  test("8 — HOLE_TO_HOLE is a warning, not a refusal", async () => {
    const h = await newBoard("copper-gate-hole");
    await seedVia(h, NET_A, { x: 10, y: 0 });

    // Same net, so the copper pair skips and only the drills are judged:
    // 0.6 mm centres − 0.4 mm drill = 0.2 mm < the 0.25 mm hole-to-hole rule.
    const result = accepted(
      await dispatch(h, {
        type: "pcb_add_via",
        centerMm: { x: 10.6, y: 0 },
        netId: NET_A,
        netClassId: h.netClassId,
      }),
    );
    expect(result.legality).toEqual({ refused: 0, warnings: 1 });
    const report = runDrc((await h.sdk.getPcbProjection(h.designId))!);
    expect(report.violations.map((v) => v.code)).toContain("HOLE_TO_HOLE");
  });

  test("9 — TRACE_WIDTH_MIN refuses", async () => {
    const h = await newBoard("copper-gate-width");
    const refused = refusal(
      await dispatch(h, {
        type: "pcb_add_trace",
        ...trace(h, NET_A, pts(-8, 8, 8, 8), 0.1),
      }),
    );
    expect(refused.violations.map((v) => v.code)).toContain("TRACE_WIDTH_MIN");
  });

  test("10 — a waived violation is not refused", async () => {
    const h = await newBoard("copper-gate-waiver");
    await seedVia(h, NET_B, { x: -6, y: -10 });
    // The trace ROW id is stable across attempts, so the violation id the
    // refusal reports is the id the waiver has to match. A CLEARANCE breach,
    // not a short: `NET_SHORT_CIRCUIT` is non-overridable and never waivable.
    const edited = await seedTrace(h, NET_A, pts(-12, -10, -9, -10));
    // 0.6 mm centre gap − 0.4 via radius − 0.125 half width = 0.075 mm.
    const conflicting = pts(-12, -10, -6.6, -10);

    const blocked = refusal(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: edited,
        pointsNm: conflicting,
      }),
    );
    expect(blocked.violations).toHaveLength(1);
    expect(blocked.violations[0]!.code).toBe("TRACE_TO_VIA_CLEARANCE");

    const waive = await dispatch(h, {
      type: "pcb_set_view_state",
      patch: { drcWaivedViolationIds: [blocked.violations[0]!.id] },
    });
    expect(waive.ok).toBe(true);

    const retried = accepted(
      await dispatch(h, {
        type: "pcb_update_trace_geometry",
        traceId: edited,
        pointsNm: conflicting,
      }),
    );
    expect(retried.legality!.refused).toBe(0);
  });

  test("11 — an invalid outline downgrades the off-board tier to a warning", async () => {
    const h = await newBoard("copper-gate-outline");
    // A self-intersecting polygon: the command layer accepts it (only contours
    // are geometry-validated), and DRC calls the outline invalid.
    const bowtie = await dispatch(h, {
      type: "pcb_set_board_outline",
      outline: {
        kind: "polygon",
        widthMm: 40,
        heightMm: 20,
        centerMm: { x: 0, y: 0 },
        pointsMm: [
          { x: -20, y: -10 },
          { x: 20, y: 10 },
          { x: 20, y: -10 },
          { x: -20, y: 10 },
        ],
      },
    });
    expect(bowtie.ok).toBe(true);

    const result = accepted(
      await dispatch(h, {
        type: "pcb_commit_route",
        traces: [trace(h, NET_A, pts(-10, 14, 10, 14))],
        vias: [],
      }),
    );
    expect(result.legality!.refused).toBe(0);
    expect(result.legality!.warnings).toBeGreaterThan(0);

    const report = runDrc((await h.sdk.getPcbProjection(h.designId))!);
    expect(report.violations.map((v) => v.code)).toContain("COPPER_OFF_BOARD");
  });

  test("12 — every copper-creating command refuses a dead short", async () => {
    const h = await newBoard("copper-gate-all-commands");
    await seedTrace(h, NET_A, pts(-5, 0, 5, 0));

    const addTrace = refusal(
      await dispatch(h, { type: "pcb_add_trace", ...crossingRun(h) }),
    );
    expect(addTrace.violations[0]!.code).toBe("NET_SHORT_CIRCUIT");

    const addVia = refusal(
      await dispatch(h, {
        type: "pcb_add_via",
        centerMm: { x: 2, y: 0 },
        netId: NET_B,
        netClassId: h.netClassId,
      }),
    );
    expect(addVia.violations[0]!.code).toBe("NET_SHORT_CIRCUIT");

    // Same builder and same copper as `pcb_add_via`, reachable over HTTP / MCP.
    const addManualVia = refusal(
      await dispatch(h, {
        type: "pcb_add_manual_via",
        centerMm: { x: -2, y: 0 },
        netId: NET_B,
        netClassId: h.netClassId,
      }),
    );
    expect(addManualVia.violations[0]!.code).toBe("NET_SHORT_CIRCUIT");

    const addTraceVia = refusal(
      await dispatch(h, {
        type: "pcb_add_trace_via",
        trace: trace(h, NET_B, pts(3, -6, 3, 0)),
        via: {
          centerMm: { x: 3, y: 0 },
          netId: NET_B,
          netClassId: h.netClassId,
        },
      }),
    );
    expect(addTraceVia.violations[0]!.code).toBe("NET_SHORT_CIRCUIT");

    const after = await h.sdk.getPcbProjection(h.designId);
    expect(after!.traces).toHaveLength(1);
    expect(after!.vias).toHaveLength(0);
  });

  test("13 — the refusal payload is capped, the count is not", async () => {
    const h = await newBoard("copper-gate-cap");
    // 8 board runs × 8 pending runs = 64 crossings, all NET_SHORT_CIRCUIT. The
    // verdict is O(pending × board), so the persisted result must not be.
    for (let i = 0; i < 8; i += 1) {
      await seedTrace(h, NET_A, pts(-10, i - 4, 10, i - 4));
    }
    const env = envelope(h.designId, {
      type: "pcb_commit_route",
      traces: Array.from({ length: 8 }, (_, i) =>
        trace(h, NET_B, pts(i - 4, -10, i - 4, 10)),
      ),
      vias: [],
    });
    const refused = refusal(await h.sdk.dispatchCommand(h.designId, env));
    expect(refused.refusedCount).toBe(64);
    expect(refused.violations).toHaveLength(50);
    expect(refused.detail).toStartWith("64 DRC violation(s):");
    expect((await h.sdk.getPcbProjection(h.designId))!.traces).toHaveLength(8);

    // The command log stores the capped result verbatim; an idempotent replay
    // must return the same verdict, count included (contract 07 §6).
    const replayed = refusal(await h.sdk.dispatchCommand(h.designId, env));
    expect(replayed.refusedCount).toBe(64);
    expect(replayed.violations).toHaveLength(50);
    expect(replayed.detail).toBe(refused.detail);
  });
});

// ── raw-row helpers: the gate's "writes nothing" claim is about ROWS ─────────

/** Give a persisted trace the importer `netName` hint a KiCad import writes. */
function setNetNameHint(traceId: string, netName: string): void {
  getSharedSqlite()
    .query(
      "UPDATE designer_pcb_entities SET payload_json = json_set(payload_json, '$.netName', ?) WHERE id = ?",
    )
    .run(netName, traceId);
}

function rawTracePayload(traceId: string): { netId: string | null } {
  const row = getSharedSqlite()
    .query<{ payload_json: string }>(
      "SELECT payload_json FROM designer_pcb_entities WHERE id = ?",
    )
    .get(traceId);
  return JSON.parse(row!.payload_json) as { netId: string | null };
}

function pcbRowCount(designId: string, kind: string): number {
  return (
    getSharedSqlite()
      .query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM designer_pcb_entities WHERE design_id = ? AND kind = ?",
      )
      .get(designId, kind)?.n ?? 0
  );
}

function undoStackJson(designId: string): string {
  return (
    getSharedSqlite()
      .query<{ undo_stack_json: string }>(
        "SELECT undo_stack_json FROM designer_session_histories WHERE design_id = ? AND session_id = ?",
      )
      .get(designId, SESSION)?.undo_stack_json ?? ""
  );
}

/** A real library component, so `place_part` can create a schematic part. */
async function importFixtureComponent(
  server: ReturnType<typeof createHttpServer>,
): Promise<string> {
  const dir = getKicadFixtureDir();
  const payload = {
    symbolLibrary: {
      fileName: "C.kicad_sym",
      content: await Bun.file(
        path.resolve(dir, "simple_capacitor.kicad_sym"),
      ).text(),
    },
    footprints: [
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: await Bun.file(
          path.resolve(dir, "C_0603_1608Metric.kicad_mod"),
        ).text(),
      },
    ],
  };
  const post = (url: string, body: unknown) =>
    server.fetch(
      new Request(`http://localhost${url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const inspect = await post(
    "/api/modules/library/imports/kicad/inspect",
    payload,
  );
  expect(inspect.status).toBe(200);
  const inspected = (await inspect.json()) as {
    data?: {
      symbols?: Array<{ id: string }>;
      footprints?: Array<{ id: string }>;
    };
  };
  const symbolId = inspected.data?.symbols?.[0]?.id;
  const footprintId = inspected.data?.footprints?.[0]?.id;
  if (!symbolId || !footprintId) throw new Error("fixture inspect failed");

  const commit = await post("/api/modules/library/imports/kicad", {
    ...payload,
    selection: { symbolId, footprintId },
    component: {
      name: `Copper gate capacitor ${crypto.randomUUID()}`,
      description: "copper commit gate fixture",
    },
  });
  expect(commit.status).toBe(201);
  const committed = (await commit.json()) as {
    data?: { componentId?: string };
  };
  const componentId = committed.data?.componentId;
  if (!componentId) throw new Error("fixture commit failed");
  return componentId;
}
