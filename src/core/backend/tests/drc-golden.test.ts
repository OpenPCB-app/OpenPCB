/**
 * Golden-board suite: every fixture under fixtures/drc/golden/ runs through
 * the REAL runDrc and must reproduce its checked-in expected report exactly
 * (summary + countsByCode + sorted violation-id multiset).
 *
 * A failure here means engine behavior changed. If the change is intended,
 * re-baseline CONSCIOUSLY via `bun run scripts/update-drc-goldens.ts` and
 * commit fixture + expected together with the behavior change.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { RULE_CLASS_BY_CODE } from "../../../modules/designer/backend/drc/severity";
import type { DrcRuleCode } from "../../../sdks/designer";
import {
  fixturePrimitiveCount,
  fixtureToProjection,
} from "./helpers/drc-golden";

const GOLDEN_DIR = path.resolve(import.meta.dir, "fixtures/drc/golden");

const goldens = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .sort();

/**
 * Every `DrcRuleCode` the corpus (§6 census gate) can never provoke through
 * fixture data alone — `ZONE_FILL_FAILED` fires only when the copper-fill
 * KERNEL itself refuses (copper-pour contract §8), which no board geometry
 * reaches through the normal projection/DRC path. It is pinned directly
 * against a synthetic draft in `drc-copper-pour.test.ts`
 * (`describe("ZONE_FILL_FAILED", …)`), which asserts the code, its
 * `RULE_CLASS_BY_CODE` entry, its default severity and its `NON_OVERRIDABLE`
 * membership. This exception list must stay empty except for this one,
 * justified entry (contract 06 §6, plan D15).
 */
const CORPUS_EXCEPTIONS = new Set<DrcRuleCode>(["ZONE_FILL_FAILED"]);

describe("DRC golden boards", () => {
  test("corpus is non-empty", () => {
    expect(goldens.length).toBeGreaterThanOrEqual(1);
  });

  for (const file of goldens) {
    const name = file.replace(/\.json$/, "");
    test(`${name} matches its expected report`, async () => {
      const fixture = JSON.parse(
        await Bun.file(path.join(GOLDEN_DIR, file)).text(),
      );
      const expected = JSON.parse(
        await Bun.file(
          path.join(GOLDEN_DIR, `${name}.expected.json`),
        ).text(),
      );
      const projection = fixtureToProjection(fixture);
      // Non-triviality gates: a hollowed-out fixture must fail loudly.
      expect(fixturePrimitiveCount(projection)).toBeGreaterThanOrEqual(80);
      const report = runDrc(projection);
      expect(report.violations.length).toBeGreaterThanOrEqual(10);

      expect(report.summary).toEqual(expected.summary);
      expect(report.countsByCode).toEqual(expected.countsByCode);
      expect(report.violations.map((v) => v.id).sort()).toEqual(
        expected.violationIds,
      );

      // Ids are unique within a report (contract §6).
      const ids = report.violations.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);

      // Every violation's class equals the table (contract §6) — a check
      // cannot disagree with RULE_CLASS_BY_CODE about its own code's class.
      for (const v of report.violations) {
        expect(v.ruleClass).toBe(RULE_CLASS_BY_CODE[v.code]);
      }
    });

    // Broad-phase contract 08 §10: every golden byte-identical in exhaustive
    // mode too — the same expected summary / counts / ids.
    test(`${name} matches its expected report (exhaustive broad phase)`, async () => {
      const fixture = JSON.parse(
        await Bun.file(path.join(GOLDEN_DIR, file)).text(),
      );
      const expected = JSON.parse(
        await Bun.file(
          path.join(GOLDEN_DIR, `${name}.expected.json`),
        ).text(),
      );
      const projection = fixtureToProjection(fixture);
      const report = runDrc(projection, { broadPhase: "exhaustive" });

      expect(report.summary).toEqual(expected.summary);
      expect(report.countsByCode).toEqual(expected.countsByCode);
      expect(report.violations.map((v) => v.id).sort()).toEqual(
        expected.violationIds,
      );
    });
  }

  test("corpus union: every DrcRuleCode is provoked, except the documented exceptions", () => {
    const allCodes = [
      ...new Set(
        [
          ...readFileSync(
            path.resolve(import.meta.dir, "../../../sdks/designer/types.ts"),
            "utf8",
          ).matchAll(/export type DrcRuleCode =\n([\s\S]*?);\n/g),
        ]
          .flatMap((m) => [...m[1]!.matchAll(/"([A-Z_]+)"/g)])
          .map((m) => m[1]!),
      ),
    ] as DrcRuleCode[];
    expect(allCodes.length).toBeGreaterThan(0);

    const union = new Set<DrcRuleCode>();
    for (const file of goldens) {
      const fixture = JSON.parse(
        readFileSync(path.join(GOLDEN_DIR, file), "utf8"),
      );
      const report = runDrc(fixtureToProjection(fixture));
      for (const v of report.violations) union.add(v.code);
    }

    const missing = allCodes.filter(
      (c) => !union.has(c) && !CORPUS_EXCEPTIONS.has(c),
    );
    expect(missing, `codes not provoked by any golden: ${missing.join(", ")}`).toEqual(
      [],
    );

    // The exception list itself must stay exactly the documented, justified
    // set — a code silently added here without provoking it elsewhere would
    // otherwise defeat the gate.
    expect([...CORPUS_EXCEPTIONS].sort()).toEqual(["ZONE_FILL_FAILED"]);
  });
});
