/**
 * The bundle tool's partner pick is the board's ONE diff-pair identity
 * (SI contract 14 §5): the explicit `board.diffPairs` table first, then the
 * shared name convention — never a private suffix table.
 *
 * `diffPairPartnerName` / `isDiffPair` themselves are pinned against the
 * shared resolver in `src/core/backend/tests/diff-pair.test.ts`, which runs one
 * case table through both entry points.
 */
import { describe, expect, test } from "vitest";
import type { PcbDiffPair } from "../../../../../sdks";
import { buildDiffPairIndex, isDiffPair } from "./diff-pair";

const NET_NAMES: Record<string, string> = {
  n1: "CLK_P",
  n2: "CLK_N",
  n3: "LANE0_P",
  n4: "LANE0_N",
  gnd: "GND",
};

describe("buildDiffPairIndex", () => {
  test("the name convention pairs nets the explicit table does not claim", () => {
    const index = buildDiffPairIndex(undefined, NET_NAMES);
    expect(index.partnerNetId("n1")).toBe("n2");
    expect(index.partnerNetName("n3", "LANE0_P")).toBe("LANE0_N");
    expect(index.partnerNetId("gnd")).toBeNull();
    expect(index.partnerNetId(null)).toBeNull();
  });

  test("an explicit row overrides the name convention, both ways", () => {
    // `CLK_P` is paired with `LANE0_N` by decree. The convention would have
    // answered `CLK_N` / `LANE0_P`; the explicit row claims all four nets, so
    // neither inferred pair survives.
    const explicit: PcbDiffPair[] = [
      { id: "dp1", name: "ODD", pNetId: "n1", nNetId: "n4" },
    ];
    const index = buildDiffPairIndex(explicit, NET_NAMES);
    expect(index.partnerNetId("n1")).toBe("n4");
    expect(index.partnerNetId("n4")).toBe("n1");
    expect(index.partnerNetName("n1", "CLK_P")).toBe("LANE0_N");
    // The nets the row left over are no longer each other's partner by name:
    // `resolveDiffPairs` skips nets an explicit row has claimed.
    expect(index.partnerNetId("n2")).toBeNull();
    expect(index.partnerNetId("n3")).toBeNull();
  });

  test("a net the board names but the resolver refused stays refused", () => {
    // Two positives under one base (case-folded) — the resolver rejects the
    // base rather than picking by insertion order, and the bundle tool must
    // not re-resolve it through the bare suffix table.
    const index = buildDiffPairIndex(undefined, {
      a: "D0_P",
      b: "d0_p",
      c: "D0_N",
    });
    expect(index.partnerNetName("a", "D0_P")).toBeNull();
    // Only an ID-less canvas pick falls back to the shared suffix table.
    expect(index.partnerNetName(null, "D0_P")).toBe("D0_N");
    expect(index.partnerNetName("unknown-net", "D0_P")).toBeNull();
  });

  test("stale and retired IDs never resolve through their name hints", () => {
    const index = buildDiffPairIndex(undefined, NET_NAMES);
    expect(index.partnerNetName("retired", "CLK_P")).toBeNull();
    expect(index.partnerNetName("gnd", "CLK_P")).toBeNull();
    expect(index.partnerNetName(null, null)).toBeNull();
  });

  test("explicit current IDs supply the current partner name despite stale hints", () => {
    const index = buildDiffPairIndex([
      { id: "pair", name: "Pair", pNetId: "p", nNetId: "n" },
    ], { p: "RENAMED_P", n: "RENAMED_N" });
    expect(index.partnerNetId("p")).toBe("n");
    expect(index.partnerNetName("p", "OLD_P")).toBe("RENAMED_N");
  });

  test("an inherited partner name cannot replace a missing own entry", () => {
    const names = { p: "CLK_P", n: "CLK_N" } as Record<string, string>;
    const index = buildDiffPairIndex(undefined, names);
    delete names.n;
    Object.setPrototypeOf(names, { n: "INHERITED_N" });
    expect(index.partnerNetId("p")).toBe("n");
    expect(index.partnerNetName("p", "CLK_P")).toBeNull();
  });

  test("a resolved partner requires a current own string name", () => {
    const names = { p: "CLK_P", n: "CLK_N" };
    const index = buildDiffPairIndex(undefined, names);
    Object.defineProperty(names, "n", { value: 42 });
    expect(index.partnerNetName("p", "CLK_P")).toBeNull();
  });

  test.each(["constructor", "__proto__", "toString"])("an intentional own %s partner name is preserved", (id) => {
    const names = { p: "PAIR_P", [id]: "PAIR_N" };
    const index = buildDiffPairIndex([
      { id: "pair", name: "Pair", pNetId: "p", nNetId: id },
    ], names);
    expect(index.partnerNetName("p", "OLD_P")).toBe("PAIR_N");
  });
});

describe("isDiffPair", () => {
  test("runs on the shared table: no bare P/N pairing", () => {
    expect(isDiffPair("CLK_P", "CLK_N")).toBe(true);
    expect(isDiffPair("D-", "D+")).toBe(true);
    expect(isDiffPair("VIP", "VIN")).toBe(false);
    expect(isDiffPair("CLK_P", "CLK_P")).toBe(false);
  });
});
