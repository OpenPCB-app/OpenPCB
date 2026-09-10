/**
 * Audit regression suite B2 — manufacturability + fab presets
 * (DRC_AUDIT_REPORT.md §4). Post-fix expectations; flip live per milestone.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { FAB_PRESETS } from "../../../modules/designer/backend/pcb/fab-presets";
import {
  boardWithRules,
  codes,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  via,
} from "./helpers/drc-fixtures";

function isolateTestDb(testLabel: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function createRuntime() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  return { moduleRuntime };
}

describe("audit B2 — manufacturability / fab presets", () => {
  // Fixed in P1 (below() in fab validators kills the derived-float false positive).
  test("B2-1: exact-spec annular (0.7−0.4)/2 emits no FAB_ANNULAR_RING", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          minimums: { annularRingMm: 0.1, viaDiameterMm: 0.6 },
        }),
        // (0.7 − 0.4) / 2 = 0.14999999999999997 — exactly at the 0.15 preset.
        vias: [via("v", { diameterMm: 0.7, drillMm: 0.4 })],
      }),
    );
    expect(codes(report)).not.toContain("FAB_ANNULAR_RING");
  });

  // Fixed in P8 (fab profiles refresh — jlcpcb_4l self-consistency).
  test("B2-2: jlcpcb_4l's own minimum-compliant via does not self-flag", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_4l",
          layerCount: 4,
          minimums: {
            annularRingMm: 0.05,
            viaDiameterMm: 0.25,
            viaDrillMm: 0.15,
            drillSizeMm: 0.15,
          },
        }),
        // Smallest via the (current) preset calls pad/drill-compliant.
        vias: [via("v", { diameterMm: 0.45, drillMm: 0.2 })],
      }),
    );
    expect(codes(report).filter((c) => c.startsWith("FAB_"))).toEqual([]);
  });

  // Fixed in P8 (values refreshed to the live JLCPCB capability page).
  test("B2-3: JLCPCB preset floors match live capabilities (2026-07)", () => {
    // Audit §7 drift table: 2L trace/space 0.10, drill 0.15, via Ø 0.25.
    // NOTE: P8 restructures presets into fab-profiles — update imports then.
    expect(FAB_PRESETS.jlcpcb_2l?.minTraceWidthMm).toBe(0.1);
    expect(FAB_PRESETS.jlcpcb_2l?.minClearanceMm).toBe(0.1);
    expect(FAB_PRESETS.jlcpcb_2l?.minDrillMm).toBe(0.15);
    expect(FAB_PRESETS.jlcpcb_4l?.minDrillMm).toBe(0.15);
  });

  // Fixed in P8 (via vs PTH annular thresholds applied to the right entity class).
  test("B2-4: via annular uses the VIA minimum, PTH pads get the PTH one", () => {
    // Via with 0.1 mm/side ring: legal per JLC via rule (≥ 0.05), today warns.
    const viaReport = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          minimums: { annularRingMm: 0.05, viaDiameterMm: 0.5 },
        }),
        vias: [via("v", { diameterMm: 0.6, drillMm: 0.4 })],
      }),
    );
    expect(codes(viaReport)).not.toContain("FAB_ANNULAR_RING");

    // TH component pad with 0.12 mm/side ring: below the 2L PTH minimum
    // (0.18) — today gets NO fab check at all.
    const pthReport = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          minimums: { annularRingMm: 0.05 },
        }),
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 1.0, 1.0, { drillDiameterMm: 0.76 }),
            ],
          }),
        ],
      }),
    );
    expect(codes(pthReport)).toContain("FAB_ANNULAR_RING");
  });

  // Fixed in S11: the annular ring is measured from the SLOT centreline, and a
  // footprint pad carries its own slot (contract 10 §1.2, §3).
  test("B2-5: slotted drills use slot geometry, not a round-hole model", () => {
    // Free std pad 2.0×1.0 with a 1.8×0.5 slot: true slot-end ring is
    // (2.0 − 1.8)/2 = 0.1 < 0.2 minimum. Round model sees (1.0 − 0.5)/2 = 0.25.
    const report = runDrc(
      projection({
        freePads: [
          freePad("fp1", {
            padType: "std",
            shape: "oval",
            widthMm: 2.0,
            heightMm: 1.0,
            drillMm: 0.5,
            drillSlot: { lengthMm: 1.8, widthMm: 0.5, angleDeg: 0 },
          }),
        ],
      }),
    );
    expect(codes(report)).toContain("ANNULAR_RING_MIN");

    // The same defect on a FOOTPRINT pad, which carried no slot at all before
    // S11: `drillSlotMm` is KiCad's `(drill oval W H)` in the pad's local axes.
    const footprint = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 2.0, 1.0, {
                shape: "oval",
                drillDiameterMm: 0.5,
                drillSlotMm: { widthMm: 1.8, heightMm: 0.5 },
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(footprint)).toContain("ANNULAR_RING_MIN");
    // Without the slot the very same pad passes: the round model measures
    // (1.0 − 0.5)/2 = 0.25 ≥ 0.2 and sees no defect.
    const round = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 2.0, 1.0, {
                shape: "oval",
                drillDiameterMm: 0.5,
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(round)).not.toContain("ANNULAR_RING_MIN");
  });

  // Fixed in S11: the ring is the exact copper width around the drill wall, not
  // `(min(w, h) − drill) / 2` (contract 10 §3.1–§3.2).
  // NOTE: `trapezoid` / `custom` outlines are still rectangles in every
  // consumer — the importer degrades them at the source and S12 owns their
  // fidelity (contract 10 §0), so this case uses the shapes S11 models exactly.
  test("B2-6: annular ring is the true copper width around the drill, not a bounding box", () => {
    // Oval 2.6 × 1.4 with a 2.3 × 0.9 slot. Bounding box: (1.4 − 0.9)/2 = 0.25,
    // which passes the 0.2 minimum. True ring at a slot END: the copper's own
    // cap centre is at ±0.6, the slot end at ±0.7, so the signed distance there
    // is 0.7 − 0.1 = 0.6 and the ring is 0.6 − 0.45 = 0.15 < 0.2.
    const slot = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 2.6, 1.4, {
                shape: "oval",
                drillDiameterMm: 0.9,
                drillSlotMm: { widthMm: 2.3, heightMm: 0.9 },
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(slot)).toContain("ANNULAR_RING_MIN");

    // An OFF-CENTRE drill: circle 2.0 with a 1.0 drill offset 0.4 mm. A centred
    // model reads 0.5 and passes; the true ring is (1.0 − 0.4) − 0.5 = 0.1.
    const offset = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 2.0, 2.0, {
                shape: "circle",
                drillDiameterMm: 1.0,
                drillOffsetMm: { x: 0.4, y: 0 },
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(offset)).toContain("ANNULAR_RING_MIN");
    const centred = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 2.0, 2.0, {
                shape: "circle",
                drillDiameterMm: 1.0,
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(centred)).not.toContain("ANNULAR_RING_MIN");
  });

  // Fixed in S11: a via OpenPCB cannot EXPORT is unmanufacturable on every
  // fabricator, and only a through via gets an aspect verdict (contract 10 §5).
  test("B2-7: blind via on a fab without blind-via support is flagged", () => {
    const blindBoard = {
      fabricator: "jlcpcb_4l" as const,
      layerCount: 4 as const,
      minimums: {
        annularRingMm: 0.05,
        viaDiameterMm: 0.3,
        viaDrillMm: 0.15,
        drillSizeMm: 0.15,
      },
    };
    const report = runDrc(
      projection({
        board: boardWithRules(blindBoard),
        vias: [
          via("v", {
            diameterMm: 0.3,
            drillMm: 0.15,
            fromLayer: "F.Cu",
            toLayer: "In1.Cu",
            viaType: "blind",
          }),
        ],
      }),
    );
    expect(codes(report)).toContain("VIA_TYPE_UNSUPPORTED");
    // No aspect verdict: there is no per-layer thickness model and no preset
    // states a blind-via limit (§5.2).
    expect(codes(report)).not.toContain("VIA_ASPECT_RATIO");

    // `custom` is the FAB opt-out, but the limit here is OpenPCB's own drill
    // export — one plated file, all through hits — so the code still fires.
    const custom = runDrc(
      projection({
        board: boardWithRules({ ...blindBoard, fabricator: "custom" }),
        vias: [
          via("v", {
            diameterMm: 0.3,
            drillMm: 0.15,
            fromLayer: "F.Cu",
            toLayer: "In1.Cu",
            viaType: "blind",
          }),
        ],
      }),
    );
    expect(codes(custom)).toContain("VIA_TYPE_UNSUPPORTED");

    // An INVALID span keeps VIA_LAYER_SPAN and gets nothing else: one code per
    // defect (§5.1). A "blind" via touching both outer layers is such a span.
    const badSpan = runDrc(
      projection({
        board: boardWithRules(blindBoard),
        vias: [
          via("v", {
            diameterMm: 0.3,
            drillMm: 0.15,
            fromLayer: "F.Cu",
            toLayer: "B.Cu",
            viaType: "blind",
          }),
        ],
      }),
    );
    expect(codes(badSpan)).toContain("VIA_LAYER_SPAN");
    expect(codes(badSpan)).not.toContain("VIA_TYPE_UNSUPPORTED");
  });

  // Fixed in P8 (fab drill floor applies to ALL holes, not just vias).
  test("B2-8: free hole below the fab drill floor gets a FAB warning", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          minimums: { drillSizeMm: 0.05 },
        }),
        freeHoles: [freeHole("h1", { x: 0, y: 0 }, 0.1)],
      }),
    );
    expect(codes(report)).toContain("FAB_DRILL");
  });

  // Fixed in P1 — verified S0 2026-09-06: gate and engine both consume
  // below() from pcb/tolerance.ts.
  test("B2-9: via creation gate and DRC agree on identical geometry", async () => {
    // (a) diameter deficit of 5e-7 mm is inside DRC_EPS (1e-6) — the gate
    // must accept it, and the engine must not flag VIA_DIAMETER_MIN either.
    isolateTestDb("drc-audit-b2-9-accept");
    const { moduleRuntime } = await createRuntime();
    const designerSdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await designerSdk.createDesign({ name: "B2-9 accept" });
    const initial = await designerSdk.getPcbProjection(design.id);
    const netClassId = initial!.board.netClasses[0]!.id;

    const accepted = await designerSdk.dispatchCommand(design.id, {
      commandId: "cmd-b2-9-accept",
      sessionId: "s",
      aggregateId: design.id,
      baseRevision: initial!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: null,
        netClassId,
        diameterMmOverride: 0.8 - 5e-7,
        drillMmOverride: 0.4,
      },
    });
    expect(accepted.ok).toBe(true);
    const acceptedProjection = await designerSdk.getPcbProjection(design.id);
    expect(codes(runDrc(acceptedProjection!))).not.toContain("VIA_DIAMETER_MIN");

    // (b) diameter deficit of 2e-6 mm is a real violation — the gate must
    // reject it, and a fixture via with the same geometry must flag in DRC.
    isolateTestDb("drc-audit-b2-9-reject");
    const runtime2 = await createRuntime();
    const designerSdk2 = runtime2.moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design2 = await designerSdk2.createDesign({ name: "B2-9 reject" });
    const initial2 = await designerSdk2.getPcbProjection(design2.id);
    const netClassId2 = initial2!.board.netClasses[0]!.id;

    const rejected = await designerSdk2.dispatchCommand(design2.id, {
      commandId: "cmd-b2-9-reject",
      sessionId: "s",
      aggregateId: design2.id,
      baseRevision: initial2!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: null,
        netClassId: netClassId2,
        diameterMmOverride: 0.8 - 2e-6,
        drillMmOverride: 0.4,
      },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(String((rejected as { detail?: string }).detail)).toContain(
        "below board minimum",
      );
    }
    const rejectedFixtureReport = runDrc(
      projection({
        vias: [via("v", { diameterMm: 0.8 - 2e-6, drillMm: 0.4 })],
      }),
    );
    expect(codes(rejectedFixtureReport)).toContain("VIA_DIAMETER_MIN");

    // (c) annular ring exactly at the 0.2 minimum ((0.8 − 0.4) / 2) — the
    // gate must accept, and the engine must not flag ANNULAR_RING_MIN.
    isolateTestDb("drc-audit-b2-9-annular");
    const runtime3 = await createRuntime();
    const designerSdk3 = runtime3.moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design3 = await designerSdk3.createDesign({ name: "B2-9 annular" });
    const initial3 = await designerSdk3.getPcbProjection(design3.id);
    const netClassId3 = initial3!.board.netClasses[0]!.id;

    const annular = await designerSdk3.dispatchCommand(design3.id, {
      commandId: "cmd-b2-9-annular",
      sessionId: "s",
      aggregateId: design3.id,
      baseRevision: initial3!.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: null,
        netClassId: netClassId3,
        diameterMmOverride: 0.8,
        drillMmOverride: 0.4,
      },
    });
    expect(annular.ok).toBe(true);
    const annularProjection = await designerSdk3.getPcbProjection(design3.id);
    expect(codes(runDrc(annularProjection!))).not.toContain("ANNULAR_RING_MIN");
  });
});
