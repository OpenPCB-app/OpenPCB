import { describe, expect, test } from "bun:test";
import type { DesignerUnresolvedFootprint } from "../../../sdks/designer";
import {
  collectUnresolvedFootprints,
  formatUnresolvedFootprintSummary,
} from "../../../shared/pcb-geometry/unresolved-footprints";

const item = (
  reference: string,
  reason: DesignerUnresolvedFootprint["reason"],
): DesignerUnresolvedFootprint => ({
  placementId: `pl-${reference}`,
  partId: `pt-${reference}`,
  reference,
  reason,
});

describe("formatUnresolvedFootprintSummary", () => {
  test("empty -> empty string", () => {
    expect(formatUnresolvedFootprintSummary([])).toBe("");
  });
  test("distinguishes reasons", () => {
    expect(
      formatUnresolvedFootprintSummary([
        item("U1", "no-footprint"),
        item("C4", "no-pads"),
      ]),
    ).toBe(
      "2 parts have no usable footprint: U1 (no footprint); C4 (footprint has no pads)",
    );
  });
  test("singular + truncation after 6 refdes", () => {
    expect(
      formatUnresolvedFootprintSummary([item("U1", "no-pads")]),
    ).toStartWith("1 part has");
    const many = Array.from({ length: 9 }, (_, i) => item(`R${i}`, "no-footprint"));
    expect(formatUnresolvedFootprintSummary(many)).toContain(
      "R0, R1, R2, R3, R4, R5 +3 more (no footprint)",
    );
  });
});

describe("collectUnresolvedFootprints", () => {
  test("flags null preview and empty pads, skips real footprints", () => {
    const fp = (preview: unknown) =>
      ({ mountType: "smd", sourceHash: null, preview }) as never;
    const out = collectUnresolvedFootprints([
      { id: "a", partId: "pa", reference: "U1", footprint: fp(null) },
      { id: "b", partId: "pb", reference: "U2", footprint: fp({ pads: [] }) },
      { id: "c", partId: "pc", reference: "U3", footprint: fp({ pads: [{}] }) },
    ]);
    expect(out.map((o) => [o.reference, o.reason])).toEqual([
      ["U1", "no-footprint"],
      ["U2", "no-pads"],
    ]);
  });
});
