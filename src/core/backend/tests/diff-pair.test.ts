/**
 * The ONE diff-pair naming table (SI contract 14 §5). `diffPairPartnerName`
 * now lives in `shared/drc/diff-pair-resolver.ts`, so the cases below run
 * against it — and against the frontend tool, which still carries its own copy
 * until WP4 turns it into a re-export. Running one table through both is what
 * makes "one table" a property instead of an intention.
 */
import { describe, expect, test } from "bun:test";
import { diffPairPartnerName as sharedPartnerName } from "../../../shared/drc/diff-pair-resolver";
import {
  diffPairPartnerName as frontendPartnerName,
  isDiffPair,
} from "../../../modules/designer/frontend/pcb/tools/diff-pair";

/** `[name, partner]`, partner `null` when the name carries no pair suffix. */
const CASES: ReadonlyArray<readonly [string, string | null]> = [
  ["CLK_P", "CLK_N"],
  ["CLK_N", "CLK_P"],
  ["lvds0_p", "lvds0_n"],
  ["lvds0_n", "lvds0_p"],
  ["D+", "D-"],
  ["D-", "D+"],
  ["USB_DM-", "USB_DM+"],
  ["GND", null],
  ["CLKP", null], // no separator — the bare P/N rule is gone (Decision 4)
  ["N", null], // bare suffix
  ["_P", null], // empty stem
  ["+", null],
];

describe("diffPairPartnerName", () => {
  test("the shared table: suffixes, case preserved, non-pairs rejected", () => {
    for (const [name, partner] of CASES) {
      expect(sharedPartnerName(name), name).toBe(partner);
    }
  });

  test("the frontend tool answers the same for every case", () => {
    for (const [name, partner] of CASES) {
      expect(frontendPartnerName(name), name).toBe(partner);
    }
  });
});

describe("isDiffPair", () => {
  test("matches both directions, rejects self and mismatches", () => {
    expect(isDiffPair("CLK_P", "CLK_N")).toBe(true);
    expect(isDiffPair("D-", "D+")).toBe(true);
    expect(isDiffPair("CLK_P", "CLK_P")).toBe(false);
    expect(isDiffPair("CLK_P", "DATA_N")).toBe(false);
    expect(isDiffPair("GND", "VCC")).toBe(false);
  });
});
