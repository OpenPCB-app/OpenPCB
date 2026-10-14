import { describe, expect, test } from "bun:test";
import { unresolvedFootprintReason } from "../../../shared/pcb-geometry/pad-geometry";

describe("unresolvedFootprintReason", () => {
  test("null/undefined -> no-footprint", () => {
    expect(unresolvedFootprintReason(null)).toBe("no-footprint");
    expect(unresolvedFootprintReason(undefined)).toBe("no-footprint");
  });
  test("virtual mount, placeholder hash, null preview -> no-footprint", () => {
    expect(
      unresolvedFootprintReason({ mountType: "virtual", preview: { pads: [1] } }),
    ).toBe("no-footprint");
    expect(
      unresolvedFootprintReason({
        mountType: "smd",
        sourceHash: "placeholder:no-footprint-yet",
        preview: { pads: [1] },
      }),
    ).toBe("no-footprint");
    expect(unresolvedFootprintReason({ mountType: "smd", preview: null })).toBe(
      "no-footprint",
    );
  });
  test("empty pads -> no-pads", () => {
    expect(
      unresolvedFootprintReason({ mountType: "smd", preview: { pads: [] } }),
    ).toBe("no-pads");
    expect(unresolvedFootprintReason({ preview: {} })).toBe("no-pads");
  });
  test("real footprint -> null", () => {
    expect(
      unresolvedFootprintReason({
        mountType: "smd",
        sourceHash: "abc",
        preview: { pads: [{}] },
      }),
    ).toBeNull();
  });
});
