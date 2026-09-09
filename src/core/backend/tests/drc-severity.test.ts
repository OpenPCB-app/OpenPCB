/**
 * P3 — severity model + violation-id v2.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
} from "../../../modules/designer/backend/drc/severity";
import { computeViolationId } from "../../../modules/designer/backend/drc/violation-id";
import { fixtureToProjection } from "./helpers/drc-golden";
import {
  boardWithRules,
  codes,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

// Two different-net traces below the clearance rule → one clearance error.
function clearancePair() {
  return projection({
    netNames: { n1: "A", n2: "B" },
    traces: [
      trace("a", "n1", [[0, 0], [10, 0]]),
      trace("b", "n2", [[0, 0.4], [10, 0.4]]),
    ],
  });
}

describe("DRC severity — defaults", () => {
  test("COPPER_TO_BOARD_EDGE defaults to error (KiCad-aligned)", () => {
    // Trace hugging the default 50×30 board edge.
    const report = runDrc(
      projection({ traces: [trace("t", "n1", [[-24.7, 0], [24.7, 0]])] }),
    );
    const v = report.violations.find((x) => x.code === "COPPER_TO_BOARD_EDGE");
    expect(v?.severity).toBe("error");
  });

  test("UNCONNECTED_NET defaults to error", () => {
    // Two pads on one net with no copper between them; the engine derives the
    // airwire itself (contract 06 §1) rather than trusting `projection.ratsnest`.
    const report = runDrc(
      projection({
        netNames: { n1: "SIG" },
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("B", {
            positionMm: { x: 5, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1", "B|1": "n1" },
      }),
    );
    const v = report.violations.find((x) => x.code === "UNCONNECTED_NET");
    expect(v?.severity).toBe("error");
  });
});

describe("DRC severity — overrides", () => {
  test("override downgrades a code's severity", () => {
    const report = runDrc(clearancePair(), {
      severityOverrides: { TRACE_TO_TRACE_CLEARANCE: "warning" },
    });
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v?.severity).toBe("warning");
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBeGreaterThan(0);
  });

  test('"ignore" drops the code entirely', () => {
    const report = runDrc(clearancePair(), {
      severityOverrides: { TRACE_TO_TRACE_CLEARANCE: "ignore" },
    });
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("NET_SHORT_CIRCUIT override is ignored (non-overridable)", () => {
    const shortReport = runDrc(
      projection({
        netNames: { n1: "A", n2: "B" },
        traces: [
          trace("a", "n1", [[0, 0], [10, 0]]),
          trace("b", "n2", [[5, -2], [5, 2]]),
        ],
      }),
      { severityOverrides: { NET_SHORT_CIRCUIT: "ignore" } },
    );
    const v = shortReport.violations.find((x) => x.code === "NET_SHORT_CIRCUIT");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
  });
});

describe("violation-id v2", () => {
  test("id format is <CODE>-v2-<16hex>", () => {
    const id = computeViolationId({
      code: "TRACE_TO_TRACE_CLEARANCE",
      anchors: [{ kind: "trace", traceId: "a" }, { kind: "trace", traceId: "b" }],
      layer: "F.Cu",
      locationMm: { x: 1, y: 1 },
    });
    expect(id).toMatch(/^TRACE_TO_TRACE_CLEARANCE-v2-[0-9a-f]{16}$/);
  });

  test("anchor order does not change the id", () => {
    const a = computeViolationId({
      code: "NET_SHORT_CIRCUIT",
      anchors: [{ kind: "trace", traceId: "a" }, { kind: "trace", traceId: "b" }],
      layer: "F.Cu",
      locationMm: { x: 1, y: 1 },
    });
    const b = computeViolationId({
      code: "NET_SHORT_CIRCUIT",
      anchors: [{ kind: "trace", traceId: "b" }, { kind: "trace", traceId: "a" }],
      layer: "F.Cu",
      locationMm: { x: 1, y: 1 },
    });
    expect(a).toBe(b);
  });

  test("same pair on different layers gets distinct ids (B3-7)", () => {
    const anchors = [{ kind: "net" as const, netId: "gnd" }];
    const fCu = computeViolationId({ code: "ISOLATED_COPPER_ISLAND", anchors, layer: "F.Cu" });
    const bCu = computeViolationId({ code: "ISOLATED_COPPER_ISLAND", anchors, layer: "B.Cu" });
    expect(fCu).not.toBe(bCu);
  });

  test("hot-spot codes: same 0.1mm bucket keeps id, a real move changes it", () => {
    const at = (x: number) =>
      computeViolationId({
        code: "TRACE_TO_TRACE_CLEARANCE",
        anchors: [{ kind: "trace", traceId: "a" }, { kind: "trace", traceId: "b" }],
        layer: "F.Cu",
        locationMm: { x, y: 0 },
      });
    expect(at(1.0)).toBe(at(1.04)); // same 0.1mm bucket
    expect(at(1.0)).not.toBe(at(9.0)); // moved to a different hot-spot
  });

  test("location is NOT hashed for non-hot-spot codes", () => {
    const at = (x: number) =>
      computeViolationId({
        code: "UNCONNECTED_NET",
        anchors: [{ kind: "net", netId: "n1" }],
        locationMm: { x, y: 0 },
      });
    expect(at(1)).toBe(at(50)); // airwire midpoint volatility must not expire waivers
  });
});

/**
 * S6 §7 — checks emit FACTS, the engine decides severity. There is exactly one
 * default source (`DEFAULT_SEVERITY_BY_CODE`); no check may carry a literal.
 */
describe("S6 §7 — one default severity source", () => {
  test("every violation on a real board matches the default table", async () => {
    // A board dense enough to exercise most of the emit sites at once.
    const dir = path.resolve(import.meta.dir, "fixtures/drc/golden");
    for (const name of ["golden-cutouts-2l", "golden-areas-2l", "golden-small-2l"]) {
      const fixture = JSON.parse(
        await Bun.file(path.join(dir, `${name}.json`)).text(),
      );
      const report = runDrc(fixtureToProjection(fixture));
      expect(report.violations.length).toBeGreaterThan(0);
      for (const v of report.violations) {
        // No scoped rules in these fixtures and no overrides ⇒ the table alone.
        expect(`${v.code}:${v.severity}`).toBe(
          `${v.code}:${DEFAULT_SEVERITY_BY_CODE[v.code]}`,
        );
      }
    }
  });

  test("no check file carries a severity literal any more", async () => {
    const dir = path.resolve(
      import.meta.dir,
      "../../../modules/designer/backend/drc/checks",
    );
    for (const file of readdirSync(dir)) {
      const source = await Bun.file(path.join(dir, file)).text();
      expect(`${file}:${/severity: "(error|warning|info)"/.test(source)}`).toBe(
        `${file}:false`,
      );
      expect(`${file}:${source.includes("waivable: false")}`).toBe(
        `${file}:false`,
      );
    }
  });
});

describe("S6 §7 — the hole-code split", () => {
  const board100 = () =>
    boardWithRules({
      fabricator: "custom",
      outline: { kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 } },
    });

  test("a drill outside the board region is HOLE_OFF_BOARD (error)", () => {
    const report = runDrc(
      projection({
        board: board100(),
        freeHoles: [{ id: "h", centerMm: { x: 49.2, y: 0 }, drillMm: 3, lockedAt: null }],
      }),
    );
    const v = report.violations.find((x) => x.code === "HOLE_OFF_BOARD");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(codes(report)).not.toContain("HOLE_TO_BOARD_EDGE");
  });

  test("a drill inside but close keeps HOLE_TO_BOARD_EDGE (warning)", () => {
    const report = runDrc(
      projection({
        board: board100(),
        freeHoles: [{ id: "h", centerMm: { x: 49.4, y: 0 }, drillMm: 1, lockedAt: null }],
      }),
    );
    const v = report.violations.find((x) => x.code === "HOLE_TO_BOARD_EDGE");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
    expect(codes(report)).not.toContain("HOLE_OFF_BOARD");
  });

  test("HOLE_OFF_BOARD stays overridable; DRC_RULE_INVALID does not", () => {
    expect(NON_OVERRIDABLE.has("HOLE_OFF_BOARD")).toBe(false);
    expect(NON_OVERRIDABLE.has("DRC_RULE_INVALID")).toBe(true);
  });
});
