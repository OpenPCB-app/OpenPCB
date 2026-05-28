import { describe, expect, it } from "vitest";
import { classifyComponentType, ledColorTone } from "./component-type";
import { groupBomItems, type BomItem } from "./BomResultCard";

function item(partial: Partial<BomItem>): BomItem {
  return {
    role: "X1",
    requestedQuery: "",
    rewrittenQuery: "",
    quantity: 1,
    value: null,
    attributes: {},
    selected: null,
    alternatives: [],
    assumptions: [],
    importSuggestions: [],
    status: "generic-resolved",
    ...partial,
  };
}

describe("classifyComponentType", () => {
  it("prefers the clean library name over a noisy refdes", () => {
    // "LED_limit_R1" contains "led" but the component is a Resistor.
    expect(classifyComponentType("Resistor", "330Ω", "LED_limit_R1").key).toBe(
      "resistor",
    );
  });

  it("classifies common EDA types", () => {
    expect(classifyComponentType("LED", "red", "LED1").key).toBe("led");
    expect(classifyComponentType("NPN Transistor SOT-23 EBC").key).toBe(
      "transistor",
    );
    expect(classifyComponentType("Capacitor").key).toBe("capacitor");
    expect(classifyComponentType("Generic Diode").key).toBe("diode");
    expect(classifyComponentType("Pin Header 1x02").key).toBe("connector");
  });

  it("falls back to 'other' when nothing matches", () => {
    expect(classifyComponentType(null, undefined, "").key).toBe("other");
    expect(classifyComponentType("widgetron 9000").key).toBe("other");
  });
});

describe("ledColorTone", () => {
  it("returns tones for known colors only", () => {
    expect(ledColorTone("red")).not.toBeNull();
    expect(ledColorTone("GREEN")).not.toBeNull();
    expect(ledColorTone("magenta")).toBeNull();
    expect(ledColorTone(null)).toBeNull();
  });
});

describe("groupBomItems", () => {
  it("collapses same type+value+source and sums quantity", () => {
    const resistor = {
      componentId: "c-res",
      name: "Resistor",
      description: "",
      tags: [],
      score: 1,
    };
    const groups = groupBomItems([
      item({ role: "R1", value: "10kΩ", selected: resistor }),
      item({ role: "R2", value: "10kΩ", selected: resistor }),
      item({ role: "R3", value: "330Ω", selected: resistor }),
    ]);
    expect(groups).toHaveLength(2);
    const tenK = groups.find((g) => g.value === "10kΩ");
    expect(tenK?.quantity).toBe(2);
    expect(tenK?.refdes).toEqual(["R1", "R2"]);
    expect(tenK?.sourceName).toBe("core:Resistor");
  });

  it("keeps distinct LED colors as separate rows", () => {
    const led = {
      componentId: "c-led",
      name: "LED",
      description: "",
      tags: [],
      score: 1,
    };
    const groups = groupBomItems([
      item({ role: "LED1", value: "red", selected: led }),
      item({ role: "LED2", value: "green", selected: led }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.type.key === "led")).toBe(true);
  });
});
