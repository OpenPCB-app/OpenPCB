// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PcbZoneNetRef } from "../../../../sdks";
import { NetSelect } from "./PcbSelectionInspector";

const nets = [
  { id: "net-current", name: "GROUND" },
  { id: "net-other", name: "GND" },
  { id: "net-auto", name: "Net_3" },
];
let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onChange.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(value: PcbZoneNetRef, disabled = false): Promise<HTMLSelectElement> {
  await act(async () => root.render(
    <NetSelect value={value} nets={nets} onChange={onChange} disabled={disabled} />,
  ));
  return host.querySelector("select")!;
}

describe("NetSelect durable references", () => {
  test("a bound id wins over an old name now used by another net", async () => {
    const select = await render({ netId: "net-current", netName: "GND" });
    expect(select.value).toBe("net-current");
    expect(select.selectedOptions[0]?.textContent).toBe("GROUND");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an inactive id stays visibly unresolved despite a matching hint", async () => {
    const select = await render({ netId: "retired", netName: "GND" });
    expect(select.value).toBe("retired");
    expect(select.selectedOptions[0]?.textContent).toContain("Unresolved");
    expect(select.selectedOptions[0]?.textContent).toContain("retired");
    expect(select.selectedOptions[0]?.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an inactive id without a hint never selects the first live net", async () => {
    const select = await render({ netId: "retired", netName: null });
    expect(select.value).toBe("retired");
    expect(select.selectedOptions[0]?.textContent).toContain("Unresolved");
  });

  test("a null id permits the existing trimmed case-insensitive name match", async () => {
    const select = await render({ netId: null, netName: " gnd " });
    expect(select.value).toBe("net-other");
  });

  test("an unmatched null-id hint does not select a live net", async () => {
    const select = await render({ netId: null, netName: "missing" });
    expect(select.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("no net stays selected and disabled state is preserved", async () => {
    const select = await render({ netId: null, netName: null }, true);
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("No net");
    expect(select.disabled).toBe(true);
  });

  test.each(["net-current", "net-auto", ""])("picking %s emits only its id", async (pick) => {
    const select = await render({ netId: "retired", netName: "GND" });
    await act(async () => {
      select.value = pick;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      netId: pick || null,
      netName: null,
    });
  });
});
