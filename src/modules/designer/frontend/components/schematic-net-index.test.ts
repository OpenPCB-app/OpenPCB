import { describe, expect, it } from "vitest";
import {
  buildSchematicNetIndex,
  netOfPin,
  netOfSelection,
} from "./schematic-net-index";

const index = buildSchematicNetIndex({
  nets: [
    { id: "n1", pinIds: ["p1", "p2"], wireIds: ["w1"], labelIds: ["l1"], primitiveIds: ["g1"] },
    { id: "n2", pinIds: ["p3"], wireIds: ["w2"], labelIds: [], primitiveIds: [] },
  ],
});
const sel = (w: string[] = [], l: string[] = [], p: string[] = []) => ({
  wireIds: new Set(w),
  labelIds: new Set(l),
  primitiveIds: new Set(p),
});

describe("schematic-net-index", () => {
  it("maps every element kind to its net", () => {
    expect(index.pin.get("p2")).toBe("n1");
    expect(index.wire.get("w2")).toBe("n2");
    expect(index.label.get("l1")).toBe("n1");
    expect(index.primitive.get("g1")).toBe("n1");
    expect(index.netIds.has("n2")).toBe(true);
  });
  it("handles null projection", () => {
    expect(buildSchematicNetIndex(null).netIds.size).toBe(0);
  });
  it("resolves synthetic primitive pins", () => {
    expect(netOfPin(index, "primitive:g1")).toBe("n1");
    expect(netOfPin(index, "p3")).toBe("n2");
    expect(netOfPin(index, "nope")).toBeNull();
  });
  it("selection pins only for a single net element", () => {
    expect(netOfSelection(index, sel(["w1"]))).toBe("n1");
    expect(netOfSelection(index, sel([], ["l1"]))).toBe("n1");
    expect(netOfSelection(index, sel([], [], ["g1"]))).toBe("n1");
    expect(netOfSelection(index, sel(["w1", "w2"]))).toBeNull();
    expect(netOfSelection(index, sel())).toBeNull();
    expect(netOfSelection(index, sel(["zz"]))).toBeNull();
  });
});
