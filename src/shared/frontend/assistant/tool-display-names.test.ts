import { describe, expect, it } from "vitest";
import { toolDisplay } from "./tool-display-names";

describe("toolDisplay", () => {
  it("maps known internal tool names to friendly labels", () => {
    expect(toolDisplay("designer_get_design_summary").label).toBe(
      "Read design",
    );
    expect(toolDisplay("library_search_components").label).toBe(
      "Search library",
    );
  });

  it("falls back to humanized snake_case for unmapped tools", () => {
    const d = toolDisplay("some_new_unmapped_tool");
    expect(d.label).toBe("Some new unmapped tool");
    expect(d.icon).toBe("Wrench");
  });
});
