// @vitest-environment happy-dom
import React, { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "../ui/icon-button";
import { TooltipProvider } from "../ui/tooltip";
import { useEscapeLayer } from "./use-escape-layer";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(element: ReactElement): Promise<void> {
  await act(async () => root.render(element));
}

async function escape(
  init: KeyboardEventInit & { keyCode?: number } = {},
  target: EventTarget = document.activeElement ?? document.body,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

function Layer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose(): void;
  children?: React.ReactNode;
}): ReactElement {
  useEscapeLayer(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label={label}>
      <input aria-label={`${label} field`} />
      {children}
    </div>
  );
}

/** Outer dialog with a button that opens an inner one, like confirm-over-dialog. */
function Nested({ onOuterClose }: { onOuterClose(): void }): ReactElement {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>
        Open outer
      </button>
      {outer ? (
        <Layer
          label="Outer"
          onClose={() => {
            onOuterClose();
            setOuter(false);
          }}
        >
          <button type="button" onClick={() => setInner(true)}>
            Open inner
          </button>
          {inner ? (
            <Layer label="Inner" onClose={() => setInner(false)} />
          ) : null}
        </Layer>
      ) : null}
    </>
  );
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === name,
  );
  if (!found) throw new Error(`button ${name} not rendered`);
  return found;
}

function dialog(label: string): Element | null {
  return document.querySelector(`[aria-label="${label}"]`);
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.focus();
    target.click();
  });
}

describe("useEscapeLayer", () => {
  it("closes nested dialogs one at a time, innermost first", async () => {
    const outerClosed = vi.fn();
    await render(<Nested onOuterClose={outerClosed} />);
    await click(button("Open outer"));
    await click(button("Open inner"));
    expect(dialog("Inner")).not.toBeNull();

    const first = await escape();
    expect(first.defaultPrevented).toBe(true);
    expect(dialog("Inner")).toBeNull();
    expect(dialog("Outer")).not.toBeNull();
    expect(outerClosed).not.toHaveBeenCalled();

    await escape();
    expect(dialog("Outer")).toBeNull();
    expect(outerClosed).toHaveBeenCalledTimes(1);

    // Empty stack: Escape is left alone for other handlers.
    expect((await escape()).defaultPrevented).toBe(false);
  });

  it("ignores Escape while an IME is composing (isComposing and keyCode 229)", async () => {
    const onClose = vi.fn();
    await render(<Layer label="Composer" onClose={onClose} />);
    const field = document.querySelector("input")!;
    field.focus();
    expect((await escape({ isComposing: true }, field)).defaultPrevented).toBe(
      false,
    );
    await escape({ keyCode: 229 }, field);
    expect(onClose).not.toHaveBeenCalled();
    await escape({}, field);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("respects Escape an inner handler already consumed", async () => {
    const onClose = vi.fn();
    function DirtyField(): ReactElement {
      useEscapeLayer(onClose);
      return (
        <input
          aria-label="Dirty"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.preventDefault();
          }}
        />
      );
    }
    await render(<DirtyField />);
    const field = document.querySelector("input")!;
    field.focus();
    await escape({}, field);
    expect(onClose).not.toHaveBeenCalled();

    // A Radix layer (document capture) that dismisses itself also wins.
    const radix = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", radix, { capture: true });
    try {
      await escape({}, document.body);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", radix, { capture: true });
    }
    await escape({}, document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the popup beneath a focused button's tooltip on one Escape", async () => {
    // OPENPCB-54: a closing Radix menu restores focus to its IconButton
    // trigger, which opens that button's tooltip; the tooltip must not
    // swallow the next Escape meant for the popup.
    const onClose = vi.fn();
    function Popup(): ReactElement {
      useEscapeLayer(onClose);
      return (
        <TooltipProvider>
          <IconButton label="More">…</IconButton>
        </TooltipProvider>
      );
    }
    await render(<Popup />);
    const more = document.querySelector<HTMLButtonElement>(
      '[aria-label="More"]',
    )!;
    await act(async () => more.focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    const event = await escape({}, more);
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores auto-repeat so a held Escape cannot unwind every layer", async () => {
    const onClose = vi.fn();
    await render(<Layer label="Held" onClose={onClose} />);
    await escape({ repeat: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("restores focus to the opener after the overlay closes", async () => {
    await render(<Nested onOuterClose={() => undefined} />);
    const opener = button("Open outer");
    await click(opener);
    const field = document.querySelector<HTMLInputElement>(
      '[aria-label="Outer field"]',
    )!;
    await act(async () => field.focus());
    expect(document.activeElement).toBe(field);

    await escape({}, field);
    expect(dialog("Outer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("restores the inner opener first, then the outer one", async () => {
    await render(<Nested onOuterClose={() => undefined} />);
    const outerOpener = button("Open outer");
    await click(outerOpener);
    const innerOpener = button("Open inner");
    await click(innerOpener);
    await act(async () =>
      document.querySelector<HTMLInputElement>('[aria-label="Inner field"]')!.focus(),
    );

    await escape();
    expect(document.activeElement).toBe(innerOpener);
    await escape();
    expect(document.activeElement).toBe(outerOpener);
  });

  it("does not steal focus the user already moved elsewhere", async () => {
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    try {
      await render(<Nested onOuterClose={() => undefined} />);
      await click(button("Open outer"));
      await act(async () => elsewhere.focus());
      await escape({}, elsewhere);
      expect(dialog("Outer")).toBeNull();
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });
});
