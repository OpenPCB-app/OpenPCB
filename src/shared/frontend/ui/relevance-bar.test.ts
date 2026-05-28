import { describe, expect, it } from "vitest";
import { relevanceTier } from "./relevance-bar";

describe("relevanceTier", () => {
  it("classifies by percentage thresholds", () => {
    expect(relevanceTier(96)).toBe("high");
    expect(relevanceTier(90)).toBe("high");
    expect(relevanceTier(84)).toBe("mid");
    expect(relevanceTier(60)).toBe("mid");
    expect(relevanceTier(42)).toBe("low");
    expect(relevanceTier(30)).toBe("low");
    expect(relevanceTier(12)).toBe("poor");
  });
});
