import { describe, expect, it } from "vitest";
import { formatShortcut, matchesShortcut, parseShortcut } from "./shortcut";

function key(
  k: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; code: string }> = {},
) {
  return {
    key: k,
    code: mods.code ?? "",
    ctrlKey: Boolean(mods.ctrl),
    metaKey: Boolean(mods.meta),
    altKey: Boolean(mods.alt),
    shiftKey: Boolean(mods.shift),
  };
}

describe("parseShortcut", () => {
  it("splits modifiers and key, including a literal plus", () => {
    expect(parseShortcut("Mod+Shift+S")).toEqual({ modifiers: ["mod", "shift"], key: "S" });
    expect(parseShortcut("Mod++")).toEqual({ modifiers: ["mod"], key: "+" });
    expect(parseShortcut("Esc")).toEqual({ modifiers: [], key: "Escape" });
    expect(parseShortcut("f5")).toEqual({ modifiers: [], key: "F5" });
  });
});

describe("formatShortcut", () => {
  it("formats per platform in the written order", () => {
    expect(formatShortcut("Mod+Shift+S", { mac: true })).toBe("⌘⇧S");
    expect(formatShortcut("Mod+Shift+S", { mac: false })).toBe("Ctrl+Shift+S");
    expect(formatShortcut("Alt+ArrowUp", { mac: true })).toBe("⌥↑");
    expect(formatShortcut("Escape", { mac: false })).toBe("Esc");
    expect(formatShortcut("Space", { mac: false })).toBe("Space");
    expect(formatShortcut("/", { mac: true })).toBe("/");
  });
});

describe("matchesShortcut", () => {
  it("requires exact modifiers", () => {
    expect(matchesShortcut(key("n"), "N", { mac: true })).toBe(true);
    expect(matchesShortcut(key("n", { meta: true }), "N", { mac: true })).toBe(false);
    expect(matchesShortcut(key("k", { meta: true }), "Mod+K", { mac: true })).toBe(true);
    expect(matchesShortcut(key("k", { ctrl: true }), "Mod+K", { mac: true })).toBe(false);
    expect(matchesShortcut(key("k", { ctrl: true }), "Mod+K", { mac: false })).toBe(true);
    expect(matchesShortcut(key("K", { meta: true, shift: true }), "Mod+K", { mac: true })).toBe(false);
  });

  it("ignores Shift for symbols unless named", () => {
    expect(matchesShortcut(key("?", { shift: true }), "?", { mac: true })).toBe(true);
    expect(matchesShortcut(key("/"), "/", { mac: true })).toBe(true);
  });

  it("falls back to event.code for Option-modified letters on macOS", () => {
    expect(matchesShortcut(key("˜", { alt: true, code: "KeyN" }), "Alt+N", { mac: true })).toBe(true);
    expect(matchesShortcut(key("Dead", { alt: true, code: "KeyE" }), "Alt+E", { mac: true })).toBe(true);
  });

  it("follows the layout's letter, not the physical key (QWERTZ / AZERTY)", () => {
    // QWERTZ: the key labelled Y sits at KeyZ and vice versa.
    const ctrlY = key("y", { ctrl: true, code: "KeyZ" });
    expect(matchesShortcut(ctrlY, "Mod+Z", { mac: false })).toBe(false);
    expect(matchesShortcut(ctrlY, "Mod+Y", { mac: false })).toBe(true);
    const ctrlZ = key("z", { ctrl: true, code: "KeyY" });
    expect(matchesShortcut(ctrlZ, "Mod+Y", { mac: false })).toBe(false);
    expect(matchesShortcut(ctrlZ, "Mod+Z", { mac: false })).toBe(true);
    expect(matchesShortcut(key("y", { alt: true, code: "KeyZ" }), "Alt+Z", { mac: false })).toBe(false);
    // AZERTY: A/Q and Z/W swap.
    expect(matchesShortcut(key("q", { code: "KeyA" }), "A", { mac: false })).toBe(false);
    expect(matchesShortcut(key("q", { code: "KeyA" }), "Q", { mac: false })).toBe(true);
    expect(matchesShortcut(key("w", { meta: true, code: "KeyZ" }), "Mod+Z", { mac: true })).toBe(false);
    // Dvorak puts symbols on letter keys: Ctrl+; (KeyZ) is not Mod+Z.
    expect(matchesShortcut(key(";", { ctrl: true, code: "KeyZ" }), "Mod+Z", { mac: false })).toBe(false);
  });

  it("uses the physical key for non-Latin letters and AZERTY's unshifted digit row", () => {
    expect(matchesShortcut(key("я", { ctrl: true, code: "KeyZ" }), "Mod+Z", { mac: false })).toBe(true);
    expect(matchesShortcut(key("&", { code: "Digit1" }), "1", { mac: false })).toBe(true);
    expect(matchesShortcut(key("7", { shift: true, code: "Digit2" }), "Shift+2", { mac: false })).toBe(false);
    expect(matchesShortcut(key("1", { code: "Numpad1" }), "1", { mac: false })).toBe(true);
  });

  it("matches named keys", () => {
    expect(matchesShortcut(key("Escape"), "Esc", { mac: false })).toBe(true);
    expect(matchesShortcut(key(" "), "Space", { mac: false })).toBe(true);
    expect(matchesShortcut(key("Enter", { shift: true }), "Enter", { mac: false })).toBe(false);
  });
});
