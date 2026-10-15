// @vitest-environment happy-dom
import React, { act, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { useEscapeLayer } from "../../../../../shared/frontend/keyboard/use-escape-layer";
import { isMacPlatform } from "../../../../../shared/frontend/ui/shortcut";
import { useEditorToolHandler } from "./use-editor-tool";
import { useSymbolEditorStore } from "./useSymbolEditorStore";

let host: HTMLDivElement;
let root: Root;
let handler: InteractionHandler;

const MOD = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
const OTHER_MOD = isMacPlatform() ? { ctrlKey: true } : { metaKey: true };

function Editor(): ReactElement {
  const rootRef = useRef<HTMLElement>(null);
  handler = useEditorToolHandler(rootRef);
  return (
    <section ref={rootRef} tabIndex={0} aria-label="Editor">
      <input aria-label="Inline text" />
    </section>
  );
}

function Page({
  onWizardEscape,
}: {
  onWizardEscape?: () => void;
}): ReactElement {
  useEscapeLayer(() => onWizardEscape?.(), {
    enabled: Boolean(onWizardEscape),
  });
  return (
    <>
      <input aria-label="Outside field" />
      <textarea aria-label="Outside notes" />
      <div contentEditable suppressContentEditableWarning aria-label="Rich">
        <span>rich text</span>
      </div>
      <button type="button" aria-label="Outside button">
        Grid
      </button>
      <Editor />
    </>
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useSymbolEditorStore.getState().reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useSymbolEditorStore.getState().reset();
});

async function render(element: ReactElement): Promise<void> {
  await act(async () => root.render(element));
}

function el<T extends HTMLElement>(label: string): T {
  const found = document.querySelector<T>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`${label} not rendered`);
  return found;
}

async function focus(target: HTMLElement | null): Promise<void> {
  await act(async () => {
    if (target) target.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });
}

async function press(
  key: string,
  init: KeyboardEventInit & { keyCode?: number } = {},
  target: EventTarget = document.activeElement ?? document.body,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

function pointer(xMm: number, yMm: number) {
  const point = { x: xMm * 1_000_000, y: yMm * 1_000_000 };
  return {
    worldPoint: point,
    snappedPoint: point,
    screenPoint: { x: 0, y: 0 },
    modifiers: { shift: false, ctrl: false, meta: false, alt: false },
    button: 0,
  } as Parameters<NonNullable<InteractionHandler["onPointerDown"]>>[0];
}

function seedPin(): void {
  const store = useSymbolEditorStore.getState();
  store.addPin({
    name: "1",
    number: "1",
    electricalType: "passive",
    positionMm: { x: 0, y: 0 },
    lengthMm: 2.54,
    rotationDeg: 180,
  });
  store.selectAll();
}

/** Everything a stray key could change: tool, document, selection, history. */
function editorSnapshot() {
  const s = useSymbolEditorStore.getState();
  return {
    tool: s.activeTool,
    pins: s.pins.length,
    graphics: s.graphics.length,
    selected: s.selectedIds.size,
    undo: s.undoStack.length,
    redo: s.redoStack.length,
    guides: s.alignmentGuidesVisible,
  };
}

const TYPED_KEYS: [string, KeyboardEventInit][] = [
  ["r", {}],
  ["l", {}],
  ["p", {}],
  ["R", { shiftKey: true }],
  ["G", { shiftKey: true }],
  ["Delete", {}],
  ["Backspace", {}],
  ["a", MOD],
  ["c", MOD],
  ["v", MOD],
  ["d", MOD],
  ["z", MOD],
  ["z", { ...MOD, shiftKey: true }],
];

describe("symbol editor keyboard scope", () => {
  it("typing in editable surfaces issues no editor commands", async () => {
    await render(<Page />);
    seedPin();
    const before = editorSnapshot();
    for (const label of ["Outside field", "Outside notes", "Inline text"]) {
      await focus(el(label));
      for (const [key, init] of TYPED_KEYS) {
        const event = await press(key, init);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    const rich = el("Rich").querySelector("span")!;
    for (const [key, init] of TYPED_KEYS) await press(key, init, rich);
    expect(editorSnapshot()).toEqual(before);
  });

  it("ignores IME composition and auto-repeat", async () => {
    await render(<Page />);
    seedPin();
    await focus(el("Editor"));
    const before = editorSnapshot();
    await press("l", { isComposing: true });
    await press("Process", { keyCode: 229 });
    await press("Delete", { isComposing: true });
    await press("l", { repeat: true });
    await press("Delete", { repeat: true });
    await press("z", { ...MOD, repeat: true });
    expect(editorSnapshot()).toEqual(before);

    await press("l");
    expect(useSymbolEditorStore.getState().activeTool).toBe("line");
  });

  it("an open modal blocks tool switches and deletion behind it", async () => {
    await render(<Page />);
    seedPin();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    try {
      const before = editorSnapshot();
      await focus(el("Editor"));
      await press("l");
      await press("Delete");
      await focus(null);
      await press("l");
      await press("Delete");
      expect(editorSnapshot()).toEqual(before);
    } finally {
      modal.remove();
    }
    await press("Delete");
    expect(useSymbolEditorStore.getState().pins).toHaveLength(0);
  });

  it("keys belong to the editor only while it or nothing else is focused", async () => {
    await render(<Page />);
    await focus(el("Outside button"));
    await press("l");
    expect(useSymbolEditorStore.getState().activeTool).toBe("select");

    await focus(null);
    await press("l");
    expect(useSymbolEditorStore.getState().activeTool).toBe("line");

    await focus(el("Editor"));
    await press("c");
    expect(useSymbolEditorStore.getState().activeTool).toBe("circle");
  });

  it("requires exact modifiers for history and tools", async () => {
    await render(<Page />);
    await focus(el("Editor"));
    seedPin();
    useSymbolEditorStore.getState().pushSnapshot();
    const undoDepth = useSymbolEditorStore.getState().undoStack.length;

    await press("z", OTHER_MOD);
    await press("l", MOD);
    await press("l", { altKey: true });
    expect(useSymbolEditorStore.getState().undoStack).toHaveLength(undoDepth);
    expect(useSymbolEditorStore.getState().activeTool).toBe("select");

    await press("z", MOD);
    expect(useSymbolEditorStore.getState().undoStack).toHaveLength(
      undoDepth - 1,
    );
  });
});

describe("symbol editor grid hotkey", () => {
  it("Shift+S toggles snapping without touching grid visibility", async () => {
    await render(<Page />);
    await focus(el("Editor"));
    await press("S", { shiftKey: true });
    expect(useSymbolEditorStore.getState()).toMatchObject({
      snapEnabled: false,
      gridVisible: true,
    });
    await focus(el("Outside field"));
    await press("S", { shiftKey: true });
    expect(useSymbolEditorStore.getState().snapEnabled).toBe(false);
  });
});

describe("symbol editor Escape inside the import wizard", () => {
  it("unwinds gesture, tool and selection before the wizard layer", async () => {
    const wizardEscape = vi.fn();
    await render(<Page onWizardEscape={wizardEscape} />);
    await focus(el("Editor"));

    await press("l");
    await act(async () => {
      handler.onPointerDown?.(pointer(0, 0));
      handler.onPointerMove?.(pointer(2.54, 0));
    });
    expect(useSymbolEditorStore.getState().previewGraphic).not.toBeNull();

    // 1. cancels the in-flight line
    expect((await press("Escape")).defaultPrevented).toBe(true);
    expect(useSymbolEditorStore.getState().previewGraphic).toBeNull();
    expect(useSymbolEditorStore.getState().activeTool).toBe("line");
    // 2. drops back to the Select tool
    await press("Escape");
    expect(useSymbolEditorStore.getState().activeTool).toBe("select");
    // 3. clears the selection
    seedPin();
    await press("Escape");
    expect(useSymbolEditorStore.getState().selectedIds.size).toBe(0);
    expect(wizardEscape).not.toHaveBeenCalled();
    // 4. nothing left in the editor: the wizard layer finally sees it
    await press("Escape");
    expect(wizardEscape).toHaveBeenCalledTimes(1);
    expect(useSymbolEditorStore.getState().pins).toHaveLength(1);
  });

  it("an IME Escape cancels nothing and closes nothing", async () => {
    const wizardEscape = vi.fn();
    await render(<Page onWizardEscape={wizardEscape} />);
    await focus(el("Editor"));
    await press("l");
    await press("Escape", { isComposing: true });
    expect(useSymbolEditorStore.getState().activeTool).toBe("line");
    expect(wizardEscape).not.toHaveBeenCalled();
  });

  it("focus leaving the editor abandons the in-flight gesture", async () => {
    await render(<Page />);
    await focus(el("Editor"));
    await press("l");
    await act(async () => {
      handler.onPointerDown?.(pointer(0, 0));
      handler.onPointerMove?.(pointer(2.54, 0));
    });
    await focus(el("Outside field"));
    expect(useSymbolEditorStore.getState().previewGraphic).toBeNull();
    // The next click starts a fresh line instead of committing the old one.
    await act(async () => handler.onPointerDown?.(pointer(5.08, 0)));
    expect(useSymbolEditorStore.getState().graphics).toHaveLength(0);
  });
});
