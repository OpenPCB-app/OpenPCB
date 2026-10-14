import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesignerUnresolvedFootprint } from "../../../../sdks/designer";
import { UnresolvedFootprintBanner } from "./UnresolvedFootprintBanner";

const item = (
  reference: string,
  reason: DesignerUnresolvedFootprint["reason"],
): DesignerUnresolvedFootprint => ({
  placementId: `pl-${reference}`,
  partId: `pt-${reference}`,
  reference,
  reason,
});
const noop = () => {};

describe("UnresolvedFootprintBanner", () => {
  it("renders nothing when empty", () => {
    expect(
      renderToStaticMarkup(<UnresolvedFootprintBanner items={[]} onSelect={noop} />),
    ).toBe("");
  });

  it("lists refdes by reason and truncates after 6", () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => item(`R${i}`, "no-footprint")),
      item("U1", "no-pads"),
    ];
    const html = renderToStaticMarkup(
      <UnresolvedFootprintBanner items={items} onSelect={noop} />,
    );
    expect(html).toContain("9 parts have no usable footprint");
    expect(html).toContain("R5");
    expect(html).not.toContain(">R6<");
    expect(html).toContain("+2 more");
    expect(html).toContain("footprint has no pads");
    expect(html).toContain(">U1<");
    expect(html).not.toContain("Fix…");
  });

  it("shows Fix… only when handler provided", () => {
    const html = renderToStaticMarkup(
      <UnresolvedFootprintBanner
        items={[item("U1", "no-footprint")]}
        onSelect={noop}
        onFixFootprint={noop}
      />,
    );
    expect(html).toContain("Fix…");
  });
});
