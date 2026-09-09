/**
 * S7 WP4 — the emit census as a machine gate (batch-DRC contract 06 §6, §7,
 * plan D15):
 *
 *  (a) the registry, severity, class and label maps agree member for member
 *      with the `DrcRuleCode` union;
 *  (b) every code's declared check files under `drc/checks/` exist and their
 *      text contains the code string, and no check file contains a code
 *      string it is not registered for;
 *  (c) every `DrcAnchor` kind has a `case` in `anchorKey` and in
 *      `resolveAnchorLabel`;
 *  (d) `NON_OVERRIDABLE` is exactly the eight codes contract §6 lists;
 *  (e) `computeViolationId`'s location-hashed behavior (LOCATION_HASHED_CODES
 *      is not exported, so this is asserted through its effect).
 *
 * The corpus-union assertion (five goldens + golden-census-2l covers every
 * code) lives in drc-golden.test.ts (contract §6 last bullet).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { EMIT_SITE_BY_CODE } from "../../../modules/designer/backend/drc/code-registry";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
  RULE_CLASS_BY_CODE,
} from "../../../modules/designer/backend/drc/severity";
import { computeViolationId } from "../../../modules/designer/backend/drc/violation-id";
import { CODE_LABEL } from "../../../modules/designer/frontend/pcb/drc/drc-labels";
import type { DrcRuleCode } from "../../../sdks/designer";

const TYPES_PATH = path.resolve(
  import.meta.dir,
  "../../../sdks/designer/types.ts",
);
const CHECKS_DIR = path.resolve(
  import.meta.dir,
  "../../../modules/designer/backend/drc/checks",
);
const VIOLATION_ID_PATH = path.resolve(
  import.meta.dir,
  "../../../modules/designer/backend/drc/violation-id.ts",
);
const DRC_LABELS_PATH = path.resolve(
  import.meta.dir,
  "../../../modules/designer/frontend/pcb/drc/drc-labels.ts",
);

/** `DrcRuleCode` members, parsed as text from the `export type` union. */
function parseDrcRuleCodes(): string[] {
  const src = readFileSync(TYPES_PATH, "utf8");
  const m = src.match(/export type DrcRuleCode =\n([\s\S]*?);\n/);
  if (!m) throw new Error("DrcRuleCode union not found in types.ts");
  return [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!);
}

/** `DrcAnchor` `kind` members, parsed as text from the `export type` union. */
function parseDrcAnchorKinds(): string[] {
  const src = readFileSync(TYPES_PATH, "utf8");
  const m = src.match(/export type DrcAnchor =\n([\s\S]*?);\n\nexport type DrcSeverity/);
  if (!m) throw new Error("DrcAnchor union not found in types.ts");
  return [...m[1]!.matchAll(/kind:\s*"([a-zA-Z]+)"/g)].map((x) => x[1]!);
}

/** `case "kind":` labels inside one function body, by name (text scan). */
function parseSwitchCases(src: string, functionName: string): Set<string> {
  const start = src.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`function ${functionName} not found`);
  // The function body ends at the first top-level closing brace after start;
  // a simple depth counter is enough for this file's straight-line style.
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(start, end);
  return new Set([...body.matchAll(/case\s+"([a-zA-Z]+)"/g)].map((x) => x[1]!));
}

const ALL_CODES = parseDrcRuleCodes() as DrcRuleCode[];
const ALL_ANCHOR_KINDS = parseDrcAnchorKinds();

describe("DRC census — (a) registry/severity/class/label agree", () => {
  test("DrcRuleCode union is non-empty and has no duplicates", () => {
    expect(ALL_CODES.length).toBeGreaterThan(0);
    expect(new Set(ALL_CODES).size).toBe(ALL_CODES.length);
  });

  test("EMIT_SITE_BY_CODE keys equal the DrcRuleCode union", () => {
    expect(Object.keys(EMIT_SITE_BY_CODE).sort()).toEqual([...ALL_CODES].sort());
  });

  test("DEFAULT_SEVERITY_BY_CODE keys equal the DrcRuleCode union", () => {
    expect(Object.keys(DEFAULT_SEVERITY_BY_CODE).sort()).toEqual(
      [...ALL_CODES].sort(),
    );
  });

  test("RULE_CLASS_BY_CODE keys equal the DrcRuleCode union", () => {
    expect(Object.keys(RULE_CLASS_BY_CODE).sort()).toEqual([...ALL_CODES].sort());
  });

  test("CODE_LABEL keys equal the DrcRuleCode union", () => {
    expect(Object.keys(CODE_LABEL).sort()).toEqual([...ALL_CODES].sort());
  });
});

/**
 * Strip `//` and `/* *\/` comments so a code string mentioned only in
 * documentation (a cross-reference to another check, e.g. "NET_SHORT_CIRCUIT
 * for diff-net overlap is emitted by clearance.ts") does not read as an
 * emission. Crude but sufficient for this codebase's comment style — no
 * string literal in these files contains `//` or `/*`.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("DRC census — (b) emit sites are honest", () => {
  const checkFiles = new Map<string, string>();
  for (const f of readdirSync(CHECKS_DIR)) {
    if (!f.endsWith(".ts")) continue;
    checkFiles.set(
      f.replace(/\.ts$/, ""),
      stripComments(readFileSync(path.join(CHECKS_DIR, f), "utf8")),
    );
  }

  test("every declared check file exists and contains its code string", () => {
    for (const code of ALL_CODES) {
      const site = EMIT_SITE_BY_CODE[code];
      expect(site, `EMIT_SITE_BY_CODE missing an entry for ${code}`).toBeDefined();
      for (const check of site.checks) {
        const text = checkFiles.get(check);
        expect(
          text,
          `${code} declares check "${check}" but drc/checks/${check}.ts does not exist`,
        ).toBeDefined();
        expect(
          text!.includes(code),
          `drc/checks/${check}.ts does not contain the code string "${code}"`,
        ).toBe(true);
      }
    }
  });

  test("no check file contains a code string it is not registered for", () => {
    // Reverse index: code -> the check files EMIT_SITE_BY_CODE declares.
    const declaredChecksByCode = new Map<string, Set<string>>();
    for (const code of ALL_CODES) {
      declaredChecksByCode.set(code, new Set(EMIT_SITE_BY_CODE[code].checks));
    }
    const violations: string[] = [];
    for (const [check, text] of checkFiles) {
      for (const code of ALL_CODES) {
        if (!text.includes(code)) continue;
        const declared = declaredChecksByCode.get(code)!;
        if (declared.has(check)) continue;
        // NET_SHORT_CIRCUIT is the one code whose home check (`clearance`)
        // emits it from two distinct sites (the short tier + the null-net
        // bridge aggregation, D5/D6) — both already covered by its single
        // declared "clearance" home above, so this branch allows no further
        // exception; any other unregistered occurrence is a real drift.
        violations.push(`${check}.ts contains "${code}" but is not registered for it`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("DRC census — (c) every DrcAnchor kind has an anchorKey + label arm", () => {
  const violationIdSrc = readFileSync(VIOLATION_ID_PATH, "utf8");
  const drcLabelsSrc = readFileSync(DRC_LABELS_PATH, "utf8");

  test("DrcAnchor union is non-empty", () => {
    expect(ALL_ANCHOR_KINDS.length).toBeGreaterThan(0);
  });

  test("anchorKey has a case for every DrcAnchor kind", () => {
    const cases = parseSwitchCases(violationIdSrc, "anchorKey");
    for (const kind of ALL_ANCHOR_KINDS) {
      expect(cases.has(kind), `anchorKey has no case "${kind}"`).toBe(true);
    }
  });

  test("resolveAnchorLabel has a case for every DrcAnchor kind", () => {
    const cases = parseSwitchCases(drcLabelsSrc, "resolveAnchorLabel");
    for (const kind of ALL_ANCHOR_KINDS) {
      expect(cases.has(kind), `resolveAnchorLabel has no case "${kind}"`).toBe(true);
    }
  });
});

describe("DRC census — (d) NON_OVERRIDABLE is exactly contract §6's eight codes", () => {
  test("membership", () => {
    const expected = new Set<DrcRuleCode>([
      "NET_SHORT_CIRCUIT",
      "VIA_LAYER_SPAN",
      "PAD_LAYER_MISMATCH",
      "TRACE_LAYER_MISMATCH",
      "BOARD_OUTLINE_INVALID",
      "ZONE_INVALID",
      "ZONE_FILL_FAILED",
      "DRC_RULE_INVALID",
    ]);
    expect(NON_OVERRIDABLE.size).toBe(8);
    expect([...NON_OVERRIDABLE].sort()).toEqual([...expected].sort());
  });

  test("every NON_OVERRIDABLE code is a real DrcRuleCode", () => {
    for (const code of NON_OVERRIDABLE) {
      expect(ALL_CODES).toContain(code);
    }
  });
});

describe("DRC census — (e) location-hashed ids (LOCATION_HASHED_CODES effect)", () => {
  test("OUTLINE_INTERNAL_RADIUS: two different locations -> two distinct ids", () => {
    const anchors = [{ kind: "boardEdge" as const }];
    const idA = computeViolationId({
      code: "OUTLINE_INTERNAL_RADIUS",
      anchors,
      locationMm: { x: 0, y: 0 },
    });
    const idB = computeViolationId({
      code: "OUTLINE_INTERNAL_RADIUS",
      anchors,
      locationMm: { x: 10, y: 10 },
    });
    expect(idA).not.toBe(idB);
  });

  test("OUTLINE_SLOT_WIDTH: two different locations -> two distinct ids", () => {
    const anchors = [{ kind: "boardEdge" as const }];
    const idA = computeViolationId({
      code: "OUTLINE_SLOT_WIDTH",
      anchors,
      locationMm: { x: 0, y: 0 },
    });
    const idB = computeViolationId({
      code: "OUTLINE_SLOT_WIDTH",
      anchors,
      locationMm: { x: 10, y: 10 },
    });
    expect(idA).not.toBe(idB);
  });

  test("COPPER_TO_HOLE: two different locations -> ONE id (not location-hashed)", () => {
    const anchors = [
      { kind: "trace" as const, traceId: "t1" },
      { kind: "freeHole" as const, freeHoleId: "h1" },
    ];
    const idA = computeViolationId({
      code: "COPPER_TO_HOLE",
      anchors,
      locationMm: { x: 0, y: 0 },
    });
    const idB = computeViolationId({
      code: "COPPER_TO_HOLE",
      anchors,
      locationMm: { x: 10, y: 10 },
    });
    expect(idA).toBe(idB);
  });
});
