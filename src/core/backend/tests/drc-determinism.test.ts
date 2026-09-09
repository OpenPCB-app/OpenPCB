/**
 * DRC determinism contract (DRC_AUDIT_REPORT.md §3.3, Appendix A; batch-DRC
 * contract 06 §7 — S7 WP4 supersedes the array-reversal probe with a
 * byte-identity promise per array; broad-phase contract 08 §6 extends it to
 * both broad-phase modes):
 *
 *  1. Identical input (independent clones) → byte-identical full report,
 *     including violation ids, anchors, locations, messages, summary and
 *     countsByCode key order.
 *  2. Reversing ANY ONE of `traces`, `vias`, `placements`, `freePads`,
 *     `freeHoles`, `zones`, `keepouts`, `drcRules` — or all eight together —
 *     yields a BYTE-IDENTICAL `JSON.stringify(report)` (contract §7): every
 *     pairwise computation runs in the canonical anchor-key orientation, so
 *     witnesses, locations and measured values do not depend on iteration
 *     order, and the canonical `(code, id)` sort removes the last order
 *     dependence. A byte difference here is a WP3-A canonical-orientation bug
 *     to report, not a tolerance to loosen.
 *  3. Every one of the above holds in BOTH broad-phase modes (08 §6), and the
 *     grid-mode report is byte-identical to the exhaustive-mode report for
 *     the base fixture and every reversal (08 §1).
 *
 * The fixture does not set `projection.ratsnest` — the engine derives its own
 * ratsnest from its own connectivity result (contract §1, D7); trusting the
 * caller-supplied field would test nothing the engine actually reads.
 *
 * `buildFixture` / `reversed*` / `singleReversalBuilders` / `REVERSIBLE_KEYS`
 * moved to `helpers/drc-determinism-fixture.ts` (WP4 R2) so
 * `drc-broad-phase-oracle.test.ts` imports the fixture from a plain helper
 * module instead of a sibling `.test.ts` — `bun test drc-determinism` then
 * reports only this file's own tests.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../shared/drc/drc-engine";
import type { DrcOptions } from "../../../shared/drc/types";
import type { DesignerPcbProjection } from "../../../sdks/designer";
import { boardWithRules, projection, sortedIds, trace } from "./helpers/drc-fixtures";
import {
  buildFixture,
  reversedEverything,
  singleReversalBuilders,
} from "./helpers/drc-determinism-fixture";

const MODES: readonly DrcOptions["broadPhase"][] = ["grid", "exhaustive"];

for (const mode of MODES) {
  const opts: DrcOptions = mode === "grid" ? {} : { broadPhase: mode };

  describe(`DRC determinism (${mode ?? "grid"})`, () => {
    test("fixture is non-trivial (>=5 violations, >=3 codes)", () => {
      const report = runDrc(buildFixture(), opts);
      expect(report.violations.length).toBeGreaterThanOrEqual(5);
      const codes = new Set(report.violations.map((v) => v.code));
      expect(codes.size).toBeGreaterThanOrEqual(3);
    });

    test("identical input -> byte-identical full report", () => {
      const fixture = buildFixture();
      const r1 = runDrc(structuredClone(fixture), opts);
      const r2 = runDrc(structuredClone(fixture), opts);
      const s1 = JSON.stringify(r1);
      const s2 = JSON.stringify(r2);
      // Buffer compare = byte identity incl. key order, not deep equality.
      expect(Buffer.compare(Buffer.from(s1), Buffer.from(s2))).toBe(0);
    });

    test("re-serialized fixture (JSON round-trip) -> byte-identical report", () => {
      const fixture = buildFixture();
      const viaJson = JSON.parse(
        JSON.stringify(fixture),
      ) as DesignerPcbProjection;
      expect(JSON.stringify(runDrc(viaJson, opts))).toBe(
        JSON.stringify(runDrc(fixture, opts)),
      );
    });

    const baseline = JSON.stringify(runDrc(buildFixture(), opts));

    for (const [name, build] of singleReversalBuilders()) {
      test(`reversing ${name} alone -> byte-identical JSON.stringify(report)`, () => {
        const s = JSON.stringify(runDrc(build(), opts));
        expect(s).toBe(baseline);
      });
    }

    test("reversing all eight arrays together -> byte-identical JSON.stringify(report)", () => {
      const s = JSON.stringify(runDrc(reversedEverything(), opts));
      expect(s).toBe(baseline);
    });

    test("reversed input arrays -> identical id multiset and counts", () => {
      const r1 = runDrc(buildFixture(), opts);
      const r2 = runDrc(reversedEverything(), opts);
      expect(sortedIds(r2)).toEqual(sortedIds(r1));
      expect(r2.summary).toEqual(r1.summary);
      // Value equality (key order may legitimately differ across input orders).
      expect(r2.countsByCode).toEqual(r1.countsByCode);
    });

    test("reversed input preserves per-id content (message, location, severity)", () => {
      const byId = (vs: ReturnType<typeof runDrc>["violations"]) =>
        new Map(vs.map((v) => [v.id, v]));
      const m1 = byId(runDrc(buildFixture(), opts).violations);
      const m2 = byId(runDrc(reversedEverything(), opts).violations);
      expect(m2.size).toBe(m1.size);
      for (const [id, v1] of m1) {
        const v2 = m2.get(id);
        expect(v2).toBeDefined();
        expect(v2!.code).toBe(v1.code);
        expect(v2!.severity).toBe(v1.severity);
        expect(v2!.message).toBe(v1.message);
        const l1 = v1.locationMm;
        const l2 = v2!.locationMm;
        expect(l1).toBeDefined();
        expect(l2).toBeDefined();
        expect(l2!.x).toBe(l1!.x);
        expect(l2!.y).toBe(l1!.y);
        expect(v2!.measuredMm ?? null).toBe(v1.measuredMm ?? null);
        expect(v2!.requiredMm ?? null).toBe(v1.requiredMm ?? null);
      }
    });
  });
}

describe("DRC determinism: grid mode == exhaustive mode (08 §1)", () => {
  const gridBaseline = JSON.stringify(runDrc(buildFixture()));

  test("base fixture: grid and exhaustive reports are byte-identical", () => {
    expect(JSON.stringify(runDrc(buildFixture(), { broadPhase: "exhaustive" }))).toBe(
      gridBaseline,
    );
  });

  for (const [name, build] of singleReversalBuilders()) {
    test(`reversing ${name} alone: grid and exhaustive reports are byte-identical`, () => {
      const p = build();
      expect(JSON.stringify(runDrc(p, { broadPhase: "exhaustive" }))).toBe(
        JSON.stringify(runDrc(p)),
      );
    });
  }

  test("reversing all eight arrays: grid and exhaustive reports are byte-identical", () => {
    const p = reversedEverything();
    expect(JSON.stringify(runDrc(p, { broadPhase: "exhaustive" }))).toBe(
      JSON.stringify(runDrc(p)),
    );
  });
});

describe("equal-priority rules resolve by array index — the documented exception (contract 06 §7)", () => {
  // Astra A2 #3: `drcRules` reversal is documented as NOT byte-identical when
  // two enabled rules share the SAME priority and BOTH match a pair —
  // "highest priority first-match wins" (rule-semantics contract) falls back
  // to array (index) order on a tie, so reversing the array can genuinely
  // change which rule wins. This is the one array the determinism contract
  // does NOT promise reversal-invariance for; this test pins that the
  // difference is real (not a bug) AND that both broad-phase modes agree on
  // whichever rule wins.
  const relax = {
    id: "relax",
    name: "Relax",
    enabled: true,
    priority: 0,
    scopes: [],
    constraint: { kind: "clearance" as const, mm: 0.1 },
  };
  const tighten = {
    id: "tighten",
    name: "Tighten",
    enabled: true,
    priority: 0,
    scopes: [],
    constraint: { kind: "clearance" as const, mm: 1 },
  };

  // Two different-net 0.2mm traces at centrelines y=0 and y=0.7: edge gap
  // 0.7 - 0.1 - 0.1 = 0.5mm — clears a 0.1mm requirement, violates a 1mm one.
  function build(rules: readonly [typeof relax, typeof tighten]): DesignerPcbProjection {
    return projection({
      board: boardWithRules({ drcRules: [...rules] }),
      netNames: { a: "A", b: "B" },
      traces: [
        trace("t1", "a", [[0, 0], [10, 0]], { widthMm: 0.2 }),
        trace("t2", "b", [[0, 0.7], [10, 0.7]], { widthMm: 0.2 }),
      ],
    });
  }

  test("relaxation-first: no clearance draft; tightening-first: TRACE_TO_TRACE_CLEARANCE required 1mm — identically in both modes", () => {
    const relaxationFirst = build([relax, tighten]);
    const tighteningFirst = build([tighten, relax]);

    for (const opts of [{}, { broadPhase: "exhaustive" as const }]) {
      const relaxReport = runDrc(relaxationFirst, opts);
      const tightenReport = runDrc(tighteningFirst, opts);

      // The reversal genuinely changes the report — the documented exception.
      expect(JSON.stringify(relaxReport)).not.toBe(JSON.stringify(tightenReport));

      expect(
        relaxReport.violations.map((v) => v.code),
        `relaxation-first (${JSON.stringify(opts)}): expected no clearance draft`,
      ).not.toContain("TRACE_TO_TRACE_CLEARANCE");

      const tightenViolation = tightenReport.violations.find(
        (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
      );
      expect(
        tightenViolation,
        `tightening-first (${JSON.stringify(opts)}): expected TRACE_TO_TRACE_CLEARANCE`,
      ).toBeDefined();
      expect(tightenViolation!.requiredMm).toBe(1);
    }
  });
});
