import { describe, expect, test } from "bun:test";
import type { DesignerPcbProjection, DrcAnchor, PcbCopperLayerId, PcbDrcRule, PcbZone } from "../../../sdks/designer";
import { CODE_LABEL } from "../../../modules/designer/frontend/pcb/drc/drc-labels";
import { checkNetBinding } from "../../../shared/drc/checks/net-binding";
import { EMIT_SITE_BY_CODE } from "../../../shared/drc/code-registry";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { DRC_STAGES, runDrc } from "../../../shared/drc/drc-engine";
import { LIVE_CODES, REFUSE_CODES } from "../../../shared/drc/legality";
import { DEFAULT_SEVERITY_BY_CODE, NON_OVERRIDABLE, RULE_CLASS_BY_CODE } from "../../../shared/drc/severity";
import { anchorKey } from "../../../shared/drc/violation-id";
import { board, freePad, projection, trace, via } from "./helpers/drc-fixtures";

const CODE = "NET_ORPHANED_COPPER";

function zone(overrides: Partial<PcbZone> = {}): PcbZone {
  return {
    id: "zone", name: null, enabled: true, lockedAt: null, layer: "B.Cu",
    netId: "retired", netName: null, priority: 0,
    region: { kind: "polygon", pointsMm: [{ x: 7, y: 8 }, { x: 9, y: 8 }, { x: 9, y: 10 }] },
    ...overrides,
  };
}

function orphans(scene: DesignerPcbProjection) {
  return runDrc(scene).violations.filter((row) => row.code === CODE);
}

interface CopperCase {
  kind: string;
  source: Partial<DesignerPcbProjection>;
  anchor: DrcAnchor;
  locationMm: { x: number; y: number };
  layer?: PcbCopperLayerId;
}

const INACTIVE: CopperCase[] = [
  {
    kind: "trace", source: { traces: [trace("trace", "retired", [[1.25, -2], [3, -2]])] },
    anchor: { kind: "trace", traceId: "trace" }, locationMm: { x: 1.25, y: -2 }, layer: "F.Cu",
  },
  {
    kind: "via", source: { vias: [via("via", { netId: "retired", center: { x: 3, y: 4 } })] },
    anchor: { kind: "via", viaId: "via" }, locationMm: { x: 3, y: 4 },
  },
  {
    kind: "freePad", source: { freePads: [freePad("freePad", { netId: "retired", center: { x: 5, y: 6 } })] },
    anchor: { kind: "freePad", freePadId: "freePad" }, locationMm: { x: 5, y: 6 }, layer: "F.Cu",
  },
  {
    kind: "zone", source: { zones: [zone()] },
    anchor: { kind: "zone", zoneId: "zone" }, locationMm: { x: 7, y: 8 }, layer: "B.Cu",
  },
];

describe("orphan copper net bindings", () => {
  for (const entry of INACTIVE) {
    test(`${entry.kind}: inactive ID has one anchored error at its raw location`, () => {
      const scene = projection({ ...entry.source, netNames: { live: "Active" } });
      const rows = orphans(scene);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        code: CODE, severity: "error", ruleClass: "connectivity",
        anchors: [entry.anchor], locationMm: entry.locationMm,
        message: 'Copper is assigned to net "retired" which no longer exists (inactive). Rebind or delete it before manufacturing.',
      });
      expect(rows[0]!.layer).toBe(entry.layer);
      expect(rows[0]!.waived).not.toBe(true);
    });
  }

  for (const kind of ["trace", "via", "zone"] as const) {
    test(`${kind}: a name hint matching a live display name is still unresolved`, () => {
      const source = kind === "trace"
        ? { traces: [{ ...trace("trace", null, [[0, 0], [1, 0]]), netName: "Live name" }] }
        : kind === "via"
          ? { vias: [{ ...via("via"), netName: "Live name" }] }
          : { zones: [zone({ netId: null, netName: "Live name" })] };
      const rows = orphans(projection({ ...source, netNames: { live: "Live name" } }));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toBe('Copper is assigned to net "Live name" which no longer exists (unresolved-name). Rebind or delete it before manufacturing.');
    });
  }

  test("bound IDs win stale hints, including an active unnamed net", () => {
    expect(orphans(projection({
      netNames: { live: "" },
      traces: [{ ...trace("trace", "live", [[0, 0], [1, 0]]), netName: "Old name" }],
      vias: [{ ...via("via", { netId: "live" }), netName: "Old name" }],
      freePads: [freePad("pad", { netId: "live" })],
      zones: [zone({ netId: "live", netName: "Old name" })],
    }))).toEqual([]);
  });

  test("null IDs with absent, empty or whitespace hints are unassigned", () => {
    expect(orphans(projection({
      traces: [trace("trace", null, [[0, 0], [1, 0]]), { ...trace("blank", null, [[0, 3], [1, 3]]), netName: " \t " }],
      vias: [{ ...via("via"), netName: "" }],
      freePads: [freePad("pad")], zones: [zone({ netId: null, netName: "  " })],
    }))).toEqual([]);
  });

  test("display hints label an inactive reference without changing its verdict", () => {
    const rows = orphans(projection({ zones: [zone({ netName: "Old display name" })] }));
    expect(rows[0]!.message).toBe('Copper is assigned to net "Old display name" which no longer exists (inactive). Rebind or delete it before manufacturing.');
  });

  test("disabled inactive and unresolved zones are inert", () => {
    expect(orphans(projection({ zones: [
      zone({ id: "inactive", enabled: false }),
      zone({ id: "hint", enabled: false, netId: null, netName: "Old name" }),
    ] }))).toEqual([]);
  });

  test("refused zone geometry and layers cannot hide unresolved references", () => {
    const scene = projection({ zones: [
      zone({ id: "invalid-ring", netId: null, netName: "Missing", region: { kind: "polygon", pointsMm: [] } }),
      zone({ id: "invalid-layer", layer: "In1.Cu" }),
    ] });
    const ctx = buildDrcContext(scene);
    expect(ctx.copperZones).toEqual([]);
    expect(checkNetBinding(ctx)).toHaveLength(2);
    expect(orphans(scene).map((row) => row.anchors)).toEqual(expect.arrayContaining([
      [{ kind: "zone", zoneId: "invalid-ring" }], [{ kind: "zone", zoneId: "invalid-layer" }],
    ]));
  });

  test("board zones use the outline center", () => {
    const scene = projection({
      board: board({ outline: { kind: "rect", widthMm: 30, heightMm: 20, centerMm: { x: 11, y: -7 } } }),
      zones: [zone({ id: "board:B.Cu", region: { kind: "board" } })],
    });
    expect(orphans(scene)[0]).toMatchObject({ locationMm: { x: 11, y: -7 }, layer: "B.Cu" });
  });

  test("only single-layer items carry a layer", () => {
    const scene = projection({
      vias: [via("single", { netId: "retired", fromLayer: "B.Cu", toLayer: "B.Cu" }), via("through", { netId: "retired" })],
      freePads: [freePad("through-pad", { netId: "retired", padType: "std", drillMm: 0.4 })],
    });
    const rows = orphans(scene);
    expect(rows.find((row) => anchorKey(row.anchors[0]!) === anchorKey({ kind: "via", viaId: "single" }))?.layer).toBe("B.Cu");
    expect(rows.filter((row) => row.layer === undefined)).toHaveLength(2);
  });

  test("netNames owns the active set; copper, rules and inherited keys cannot add nets", () => {
    const names = Object.assign(Object.create({ retired: "Inherited" }) as Record<string, string>, { live: "Live" });
    const scene = projection({
      netNames: names, traces: [trace("trace", "retired", [[0, 0], [1, 0]])],
      board: board({ perNetClassAssignments: { retired: "default" }, lengthMatchGroups: [{ id: "group", name: "group", netIds: ["retired"], target: { kind: "absolute", mm: 1 }, toleranceMm: 0 }] }),
    });
    expect(orphans(scene)).toHaveLength(1);
    expect(checkNetBinding(buildDrcContext(projection({ board: scene.board })))).toEqual([]);
    expect(checkNetBinding(buildDrcContext(projection({ traces: [trace("trace", "constructor", [[0, 0], [1, 0]])] })))).toHaveLength(1);
  });

  test("class ignores, severity overrides and waivers cannot suppress the error", () => {
    const scene = projection(INACTIVE[0]!.source);
    const id = orphans(scene)[0]!.id;
    for (const severity of ["ignore", "warning", "info"] as const) {
      const row = runDrc(scene, { ignoredRuleClasses: ["connectivity"], waivedIds: [id], severityOverrides: { [CODE]: severity } }).violations.find((row) => row.code === CODE);
      expect(row).toMatchObject({ id, severity: "error" });
      expect(row!.waived).not.toBe(true);
    }
    scene.board = { ...scene.board, drcSeverityOverrides: { [CODE]: "ignore" }, viewState: { ...scene.board.viewState!, drcIgnoredRuleClasses: ["connectivity"], drcWaivedViolationIds: [id] } };
    expect(orphans(scene)[0]).toMatchObject({ id, severity: "error" });
  });

  test("each physical kind and ID stays distinct; moves and row order preserve IDs", () => {
    const scene = projection({
      traces: [trace("shared", "retired", [[0, 0], [1, 0]]), trace("second", "retired", [[2, 0], [3, 0]])],
      vias: [via("shared", { netId: "retired" })],
      freePads: [freePad("shared", { netId: "retired" })], zones: [zone({ id: "shared" })],
    });
    const before = structuredClone(scene);
    const ids = orphans(scene).map((row) => row.id);
    expect(new Set(ids).size).toBe(5);
    expect(scene).toEqual(before);
    scene.traces.reverse().forEach((row) => row.pointsNm.forEach((point) => { point.x += 20_000_000; }));
    scene.vias[0]!.centerMm.x += 20;
    scene.freePads[0]!.centerMm.x += 20;
    const region = scene.zones[0]!.region;
    if (region.kind === "polygon") region.pointsMm.forEach((point) => { point.x += 20; });
    expect(orphans(scene).map((row) => row.id)).toEqual(ids);
  });

  test("code registration is complete and batch-only", () => {
    expect(DEFAULT_SEVERITY_BY_CODE[CODE]).toBe("error");
    expect(RULE_CLASS_BY_CODE[CODE]).toBe("connectivity");
    expect(NON_OVERRIDABLE.has(CODE)).toBe(true);
    expect(EMIT_SITE_BY_CODE[CODE].checks).toEqual(["net-binding"]);
    expect(CODE_LABEL[CODE]).toBe("Orphaned copper");
    expect(LIVE_CODES.has(CODE)).toBe(false);
    expect(REFUSE_CODES.has(CODE)).toBe(false);
    const index = DRC_STAGES.findIndex(([stage]) => stage === "connectivity");
    expect(DRC_STAGES[index + 1]).toEqual(["net-binding", checkNetBinding]);
  });

  test("malformed rule scopes do not prevent independent orphan and rule errors", () => {
    const rules = [{
      id: "malformed", name: "Malformed net scope", enabled: true, priority: 1,
      scopes: [{ kind: "net", netIds: "retired" }],
      constraint: { kind: "clearance", mm: 0.2 },
    }] as unknown as PcbDrcRule[];
    const report = runDrc(projection({
      board: board({ drcRules: rules }),
      traces: [trace("orphan", "retired", [[0, 0], [1, 0]])],
    }));
    expect(report.violations.filter((row) => row.code === "DRC_RULE_INVALID")).toMatchObject([
      { anchors: [{ kind: "rule", ruleId: "malformed" }], severity: "error" },
    ]);
    expect(report.violations.find((row) => row.code === "DRC_RULE_INVALID")!.message).toContain("netIds");
    expect(report.violations.filter((row) => row.code === CODE)).toMatchObject([
      { anchors: [{ kind: "trace", traceId: "orphan" }], severity: "error" },
    ]);
  });
});
