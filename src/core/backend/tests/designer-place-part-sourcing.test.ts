import { describe, expect, test } from "bun:test";
import { buildSourcingPropertiesJson } from "../../../modules/designer/backend/commands/place-part";
import type { LibraryComponentPlacementDetail } from "../../../sdks/library/types";

type Component = LibraryComponentPlacementDetail["component"];

function component(overrides: Partial<Component>): Component {
  return {
    id: "c1",
    name: "Test",
    description: "",
    symbolId: "s1",
    footprintId: "f1",
    tags: [],
    isBuiltin: false,
    ...overrides,
  };
}

describe("place-part sourcing inheritance", () => {
  test("seeds propertiesJson with the component's sourcing (BOM-readable keys)", () => {
    const props = JSON.parse(
      buildSourcingPropertiesJson(
        component({
          manufacturer: "Yageo",
          manufacturerPartNumber: "RC0603FR-0710KL",
          lcscPartNumber: "C25804",
          supplier: "LCSC",
        }),
      ),
    );
    expect(props.manufacturer).toBe("Yageo");
    expect(props.manufacturerPartNumber).toBe("RC0603FR-0710KL");
    expect(props.lcscPartNumber).toBe("C25804");
    expect(props.supplier).toBe("LCSC");
  });

  test("omits null/absent sourcing fields", () => {
    const props = JSON.parse(
      buildSourcingPropertiesJson(
        component({ manufacturerPartNumber: "MPN-1", lcscPartNumber: null }),
      ),
    );
    expect(props.manufacturerPartNumber).toBe("MPN-1");
    expect("lcscPartNumber" in props).toBe(false);
    expect("manufacturer" in props).toBe(false);
  });

  test("unsourced component → empty object", () => {
    expect(buildSourcingPropertiesJson(component({}))).toBe("{}");
  });
});
