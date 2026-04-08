import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isDeleteShortcut,
  isEditableShortcutTarget,
  isEscapeShortcut,
  isRedoShortcut,
  isSelectAllShortcut,
  isUndoShortcut,
  matchesKey,
  useWindowKeyboardShortcuts,
  type KeyboardShortcutBinding,
} from "./keyboard-shortcuts";

function ShortcutHarness({
  bindings,
  ignoreEditableTarget = false,
}: {
  bindings: KeyboardShortcutBinding[];
  ignoreEditableTarget?: boolean;
}) {
  useWindowKeyboardShortcuts(bindings, { ignoreEditableTarget });

  return createElement(
    "div",
    undefined,
    createElement("input", { "data-testid": "input" }),
    createElement("div", {
      "data-testid": "content-editable",
      contentEditable: true,
    }),
  );
}

function makeKeyEvent(
  overrides: Partial<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("keyboard shortcut predicates", () => {
  it("matches single keys case-insensitively", () => {
    expect(matchesKey(makeKeyEvent({ key: "R" }), "r")).toBe(true);
  });

  it("recognizes escape and delete shortcuts", () => {
    expect(isEscapeShortcut(makeKeyEvent({ key: "Escape" }))).toBe(true);
    expect(isDeleteShortcut(makeKeyEvent({ key: "Backspace" }))).toBe(true);
    expect(isDeleteShortcut(makeKeyEvent({ key: "Delete" }))).toBe(true);
  });

  it("recognizes undo and redo shortcuts", () => {
    expect(isUndoShortcut(makeKeyEvent({ key: "z", ctrlKey: true }))).toBe(
      true,
    );
    expect(
      isRedoShortcut(makeKeyEvent({ key: "z", metaKey: true, shiftKey: true })),
    ).toBe(true);
  });

  it("recognizes select-all shortcuts", () => {
    expect(isSelectAllShortcut(makeKeyEvent({ key: "a", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("detects editable shortcut targets", () => {
    expect(isEditableShortcutTarget(document.createElement("input"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.createElement("textarea"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.createElement("div"))).toBe(false);
  });
});

describe("useWindowKeyboardShortcuts", () => {
  it("runs the first matching binding", () => {
    const first = vi.fn();
    const second = vi.fn();

    render(
      createElement(ShortcutHarness, {
        bindings: [
          {
            matches: isEscapeShortcut,
            run: first,
          },
          {
            matches: isEscapeShortcut,
            run: second,
          },
        ],
      }),
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("ignores editable targets when requested", () => {
    const run = vi.fn();

    const { getByTestId } = render(
      createElement(ShortcutHarness, {
        bindings: [
          {
            matches: isEscapeShortcut,
            run,
          },
        ],
        ignoreEditableTarget: true,
      }),
    );

    fireEvent.keyDown(getByTestId("input"), { key: "Escape" });
    fireEvent.keyDown(getByTestId("content-editable"), { key: "Escape" });

    expect(run).not.toHaveBeenCalled();
  });

  it("still runs bindings for non-editable targets", () => {
    const run = vi.fn();

    const { getByTestId } = render(
      createElement(ShortcutHarness, {
        bindings: [
          {
            matches: isEscapeShortcut,
            run,
          },
        ],
        ignoreEditableTarget: true,
      }),
    );

    fireEvent.keyDown(getByTestId("content-editable").parentElement!, {
      key: "Escape",
    });

    expect(run).toHaveBeenCalledOnce();
  });
});
