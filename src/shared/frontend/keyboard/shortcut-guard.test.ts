import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  isInsideOverlay,
  isModalOpen,
  isShortcutBlocked,
} from "./shortcut-guard";

/*
 * Minimal fake DOM (node env): elements with attributes, a parent chain and
 * a `closest` that understands the simple selectors the guard uses.
 */
interface FakeElement {
  nodeType: 1;
  tagName: string;
  isContentEditable?: boolean;
  parent: FakeElement | null;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
  closest(selector: string): FakeElement | null;
}

function matchesSimple(element: FakeElement, simple: string): boolean {
  const notMatch = simple.match(/^(.*):not\((.*)\)$/);
  if (notMatch) {
    return matchesSimple(element, notMatch[1] ?? "") && !matchesSimple(element, notMatch[2] ?? "");
  }
  const parts = simple.match(/^([a-z]*)((?:\[[^\]]+\])*)$/i);
  if (!parts) throw new Error(`unsupported selector ${simple}`);
  const tag = parts[1] ?? "";
  const attrPart = parts[2] ?? "";
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const attr of attrPart.match(/\[[^\]]+\]/g) ?? []) {
    const match = attr.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    const name = match?.[1];
    const value = match?.[2];
    if (name === undefined || !(name in element.attrs)) return false;
    if (value !== undefined && element.attrs[name] !== value) return false;
  }
  return true;
}

function el(
  tagName: string,
  attrs: Record<string, string> = {},
  parent: FakeElement | null = null,
  isContentEditable = false,
): FakeElement {
  const element: FakeElement = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    isContentEditable,
    parent,
    attrs,
    getAttribute: (name) => attrs[name] ?? null,
    closest(selector) {
      const options = selector.split(",").map((s) => s.trim());
      for (let node: FakeElement | null = element; node; node = node.parent) {
        const current = node;
        if (options.some((option) => matchesSimple(current, option))) return current;
      }
      return null;
    },
  };
  return element;
}

const noModal = { querySelectorAll: () => [] as unknown[] };

function keydown(key: string, target: FakeElement | null, isComposing = false) {
  return { key, target: target as unknown as EventTarget, isComposing };
}

describe("isEditableTarget", () => {
  it("treats text inputs, textarea, select and text roles as editable", () => {
    expect(isEditableTarget(el("input") as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el("input", { type: "number" }) as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el("textarea") as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el("select") as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el("div", { role: "textbox" }) as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el("div", { role: "combobox" }) as unknown as EventTarget)).toBe(true);
  });

  it("treats contenteditable (own or inherited) as editable", () => {
    const editor = el("div", { contenteditable: "true" });
    expect(isEditableTarget(el("p", {}, editor) as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el("div", {}, null, true) as unknown as EventTarget)).toBe(true);
    const off = el("div", { contenteditable: "false" });
    expect(isEditableTarget(el("p", {}, off) as unknown as EventTarget)).toBe(false);
  });

  it("does not treat checkbox/radio/button/range inputs or plain nodes as editable", () => {
    for (const type of ["checkbox", "radio", "button", "range"]) {
      expect(isEditableTarget(el("input", { type }) as unknown as EventTarget)).toBe(false);
    }
    expect(isEditableTarget(el("button") as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});

describe("isInsideOverlay / isModalOpen", () => {
  it("detects dialog, menu and listbox ancestors", () => {
    expect(isInsideOverlay(el("button", {}, el("div", { role: "dialog" })) as unknown as EventTarget)).toBe(true);
    expect(isInsideOverlay(el("div", { role: "menuitem" }, el("div", { role: "menu" })) as unknown as EventTarget)).toBe(true);
    expect(isInsideOverlay(el("div", { role: "option" }, el("div", { role: "listbox" })) as unknown as EventTarget)).toBe(true);
    expect(isInsideOverlay(el("canvas") as unknown as EventTarget)).toBe(false);
  });

  it("sees an aria-modal element unless it is hidden", () => {
    expect(isModalOpen({ querySelectorAll: () => [el("div", { "aria-modal": "true" })] })).toBe(true);
    const hidden = el("div", { "aria-modal": "true" }, el("div", { hidden: "" }));
    expect(isModalOpen({ querySelectorAll: () => [hidden] })).toBe(false);
    expect(isModalOpen(noModal)).toBe(false);
  });
});

describe("isShortcutBlocked", () => {
  const body = el("body");

  it("lets canvas/body shortcuts through", () => {
    expect(isShortcutBlocked(keydown("r", body), { doc: noModal })).toBe(false);
    expect(isShortcutBlocked(keydown("Delete", el("canvas", {}, body)), { doc: noModal })).toBe(false);
  });

  it("blocks while typing (T-002 repro: comment typing)", () => {
    expect(isShortcutBlocked(keydown("r", el("textarea")), { doc: noModal })).toBe(true);
    expect(isShortcutBlocked(keydown("Delete", el("input")), { doc: noModal })).toBe(true);
  });

  it("allowInEditable lets typing targets through but not dialogs", () => {
    expect(isShortcutBlocked(keydown("k", el("input")), { doc: noModal, allowInEditable: true })).toBe(false);
    const inDialog = el("input", {}, el("div", { role: "dialog" }));
    expect(isShortcutBlocked(keydown("k", inDialog), { doc: noModal, allowInEditable: true })).toBe(true);
  });

  it("blocks inside menus and while any modal is open", () => {
    expect(isShortcutBlocked(keydown("r", el("div", { role: "menuitem" }, el("div", { role: "menu" }))), { doc: noModal })).toBe(true);
    const modal = { querySelectorAll: () => [el("div", { "aria-modal": "true" })] };
    expect(isShortcutBlocked(keydown("r", body), { doc: modal })).toBe(true);
  });

  it("blocks IME composition", () => {
    expect(isShortcutBlocked(keydown("r", body, true), { doc: noModal })).toBe(true);
  });

  it("leaves Enter/Space to a focused button", () => {
    expect(isShortcutBlocked(keydown("Enter", el("button")), { doc: noModal })).toBe(true);
    expect(isShortcutBlocked(keydown(" ", el("span", {}, el("div", { role: "tab" }))), { doc: noModal })).toBe(true);
    expect(isShortcutBlocked(keydown("r", el("button")), { doc: noModal })).toBe(false);
  });

  it("leaves Enter/Space to native non-text inputs (kit Checkbox, RadioGroup) and grid rows", () => {
    for (const type of ["checkbox", "radio", "submit", "button", "reset", "range", "file", "color"]) {
      const input = el("input", { type }, el("label", {}, body));
      expect(isShortcutBlocked(keydown(" ", input), { doc: noModal })).toBe(true);
      expect(isShortcutBlocked(keydown("Enter", input), { doc: noModal })).toBe(true);
    }
    expect(isShortcutBlocked(keydown(" ", el("input", { type: "Checkbox" })), { doc: noModal })).toBe(true);
    expect(isShortcutBlocked(keydown("Enter", el("div", { role: "row", tabindex: "0" })), { doc: noModal })).toBe(true);
    // Non-activation keys on a checkbox still reach global shortcuts.
    expect(isShortcutBlocked(keydown("r", el("input", { type: "checkbox" })), { doc: noModal })).toBe(false);
  });

  it("leaves arrows/Home/End/PageUp/PageDown to roving widgets, radios and sliders", () => {
    const radio = el("input", { type: "radio" }, el("div", { role: "radiogroup" }));
    const range = el("input", { type: "range" });
    const tab = el("button", { role: "tab" }, el("div", { role: "tablist" }));
    const segment = el("button", {}, el("div", { role: "group", "data-roving-focus": "" }));
    const thumb = el("span", { role: "slider" });
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
      for (const target of [radio, range, tab, segment, thumb]) {
        expect(isShortcutBlocked(keydown(key, target), { doc: noModal })).toBe(true);
      }
    }
    // A radio outside a radiogroup still owns its arrows.
    expect(isShortcutBlocked(keydown("ArrowDown", el("input", { type: "radio" })), { doc: noModal })).toBe(true);
  });

  it("does not hand arrows to plain groups, buttons or checkboxes (canvas nudge keeps working)", () => {
    const groupButton = el("button", {}, el("div", { role: "group" }));
    expect(isShortcutBlocked(keydown("ArrowLeft", groupButton), { doc: noModal })).toBe(false);
    expect(isShortcutBlocked(keydown("ArrowUp", el("button")), { doc: noModal })).toBe(false);
    expect(isShortcutBlocked(keydown("ArrowUp", el("input", { type: "checkbox" })), { doc: noModal })).toBe(false);
    expect(isShortcutBlocked(keydown("ArrowRight", el("canvas", {}, body)), { doc: noModal })).toBe(false);
    // The tab key itself is not a navigation key here.
    expect(isShortcutBlocked(keydown("r", el("button", { role: "tab" }, el("div", { role: "tablist" }))), { doc: noModal })).toBe(false);
  });

  it("blocks navigation/activation keys an earlier handler already consumed", () => {
    const consumed = { ...keydown("ArrowLeft", el("canvas", {}, body)), defaultPrevented: true };
    expect(isShortcutBlocked(consumed, { doc: noModal })).toBe(true);
    const consumedEnter = { ...keydown("Enter", el("div", {}, body)), defaultPrevented: true };
    expect(isShortcutBlocked(consumedEnter, { doc: noModal })).toBe(true);
    // Letter shortcuts are not second-guessed on defaultPrevented.
    const consumedLetter = { ...keydown("r", body), defaultPrevented: true };
    expect(isShortcutBlocked(consumedLetter, { doc: noModal })).toBe(false);
  });
});
