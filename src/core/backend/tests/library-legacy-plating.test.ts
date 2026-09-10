/**
 * Legacy plating recovery (manufacturability contract 10 §2.2).
 *
 * Every footprint imported before the `plated` attribute existed still stores
 * its whole import JSON, so `raw.pads[i].type === "np_thru_hole"` is there to
 * be read at load time. The fixture is the REAL CoreLibrary row for
 * `MountingHole_3.2mm_M3` — the 3.2 x 3.2 copper-less NPTH the contract names.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withLegacyPlating } from "../../../modules/library/backend/queries";
import type { FootprintRenderModel } from "../../../shared/rendering";

const ROW = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/library/mountinghole-m3.fp.json"),
    "utf8",
  ),
) as {
  normalized: { preview: FootprintRenderModel };
  raw: { pads: unknown[] };
};

type PadWithPlating = FootprintRenderModel["pads"][number] & {
  plated?: boolean;
};

function platingOf(
  preview: FootprintRenderModel,
  index = 0,
): boolean | undefined {
  return (preview.pads[index] as PadWithPlating).plated;
}

describe("withLegacyPlating", () => {
  test("the real M3 mounting-hole row comes out non-plated", () => {
    const preview = ROW.normalized.preview;
    // The row as shipped: no `plated` key anywhere.
    expect(platingOf(preview)).toBeUndefined();
    expect(preview.pads[0]!.id).toBe("?:0");
    const fixed = withLegacyPlating(preview, ROW.raw.pads);
    expect(platingOf(fixed)).toBe(false);
    // Pure: the input is never mutated.
    expect(platingOf(preview)).toBeUndefined();
  });

  test("the raw index is the LAST `:`-separated segment of the pad id", () => {
    // A pad literally numbered `A:1` produces the id `A:1:0`; taking the FIRST
    // segment would parse `A` and recover nothing.
    const preview: FootprintRenderModel = {
      ...ROW.normalized.preview,
      pads: [
        { ...ROW.normalized.preview.pads[0]!, id: "A:1:0", number: "A:1" },
      ],
    };
    const rawPads = [
      { ...(ROW.raw.pads[0] as Record<string, unknown>), number: "A:1" },
    ];
    expect(platingOf(withLegacyPlating(preview, rawPads))).toBe(false);
  });

  test("a preview with no `raw` is untouched (editor-authored footprints)", () => {
    const preview = ROW.normalized.preview;
    expect(platingOf(withLegacyPlating(preview, undefined))).toBeUndefined();
    expect(platingOf(withLegacyPlating(preview, null))).toBeUndefined();
    expect(platingOf(withLegacyPlating(preview, {}))).toBeUndefined();
  });

  test("a pad that already states its plating keeps it", () => {
    const preview: FootprintRenderModel = {
      ...ROW.normalized.preview,
      pads: [
        {
          ...ROW.normalized.preview.pads[0]!,
          plated: true,
        } as FootprintRenderModel["pads"][number],
      ],
    };
    expect(platingOf(withLegacyPlating(preview, ROW.raw.pads))).toBe(true);
  });

  test("an np_thru_hole at the index that is NOT the same pad does not flip it", () => {
    // The raw list is never assumed immutable (Astra run 1 #15): the index
    // alone is not identity. Each mismatch alone must be enough to refuse.
    const preview = ROW.normalized.preview;
    const raw = ROW.raw.pads[0] as Record<string, unknown>;
    const cases: Array<Record<string, unknown>> = [
      { ...raw, number: "1" }, // different number
      { ...raw, drillDiameter: 3.3 }, // different drill
      { ...raw, position: { x: 1, y: 0 } }, // different position
      { ...raw, type: "thru_hole" }, // not an NPTH at all
    ];
    for (const bad of cases) {
      expect(platingOf(withLegacyPlating(preview, [bad]))).toBeUndefined();
    }
    // A missing pad at that index, and a non-object entry, are also refusals.
    expect(platingOf(withLegacyPlating(preview, []))).toBeUndefined();
    expect(platingOf(withLegacyPlating(preview, [null]))).toBeUndefined();
  });

  test("an unparsable id recovers nothing", () => {
    const preview: FootprintRenderModel = {
      ...ROW.normalized.preview,
      pads: [{ ...ROW.normalized.preview.pads[0]!, id: "pad-one" }],
    };
    expect(platingOf(withLegacyPlating(preview, ROW.raw.pads))).toBeUndefined();
  });
});
