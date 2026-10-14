// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcbHitCandidate } from "./pcb-hit";
import { PcbDisambiguationPopup } from "./PcbDisambiguationPopup";

let host: HTMLDivElement;
let root: Root;
const onPick = vi.fn();
const onCycle = vi.fn();
const onClose = vi.fn();

const items = ["A", "B"].map((label) => ({
  candidate: { kind: "placement" } as unknown as PcbHitCandidate,
  label,
}));

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PcbDisambiguationPopup
        items={items}
        activeIndex={1}
        screenX={0}
        screenY={0}
        onPick={onPick}
        onClose={onClose}
        onCycle={onCycle}
      />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

function press(
  key: string,
  init: KeyboardEventInit & { keyCode?: number } = {},
  target: EventTarget = document.body,
  preventEarlier = false,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (init.keyCode !== undefined)
    Object.defineProperty(event, "keyCode", { value: init.keyCode });
  if (preventEarlier) event.preventDefault();
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("PcbDisambiguationPopup keyboard", () => {
  it("cycles with arrows and picks the active item with Enter", () => {
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    press("ArrowUp");
    press("Enter");
    expect(onCycle.mock.calls).toEqual([[1], [-1]]);
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("ignores IME composition and keys an earlier handler consumed", () => {
    press("Enter", { isComposing: true });
    press("ArrowDown", { keyCode: 229 });
    press("Enter", {}, document.body, true);
    expect(onPick).not.toHaveBeenCalled();
    expect(onCycle).not.toHaveBeenCalled();
  });

  it("ignores keys typed into editable fields", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(input, editor);
    const event = press("Enter", {}, input);
    press("ArrowDown", {}, editor);
    expect(event.defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    expect(onCycle).not.toHaveBeenCalled();
  });

  it("ignores keys owned by another dialog and repeated Enter", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    press("Enter", {}, button);
    press("ArrowDown", {}, button);
    expect(onPick).not.toHaveBeenCalled();
    expect(onCycle).not.toHaveBeenCalled();
    dialog.remove();
    press("Enter", { repeat: true });
    expect(onPick).not.toHaveBeenCalled();
    press("ArrowDown", { repeat: true });
    expect(onCycle).toHaveBeenCalledWith(1);
  });
});
