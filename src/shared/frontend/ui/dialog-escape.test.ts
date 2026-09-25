import { describe, expect, it } from "vitest";
import { isEscapeOwnedByField } from "./dialog";

// Minimal Element stand-in: the vitest env is node (no DOM), and the helper
// only needs `closest`.
class FakeElement {
  constructor(private readonly owner: boolean) {}
  closest(selector: string) {
    return selector === '[data-escape-owner="true"]' && this.owner ? this : null;
  }
}

describe("isEscapeOwnedByField", () => {
  const withElement = (fn: () => void) => {
    const g = globalThis as { Element?: unknown };
    const prev = g.Element;
    g.Element = FakeElement;
    try {
      fn();
    } finally {
      g.Element = prev;
    }
  };

  it("keeps Escape for a field that owns it (dirty NumberInput)", () => {
    withElement(() => expect(isEscapeOwnedByField(new FakeElement(true) as never)).toBe(true));
  });

  it("lets the dialog close for any other target", () => {
    withElement(() => {
      expect(isEscapeOwnedByField(new FakeElement(false) as never)).toBe(false);
      expect(isEscapeOwnedByField(null)).toBe(false);
    });
  });
});
