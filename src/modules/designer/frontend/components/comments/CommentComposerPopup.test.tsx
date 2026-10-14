// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CommentComposerPopup } from "./CommentComposerPopup";

function typeInto(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

test("IME Escape keeps the comment draft; a plain Escape cancels it", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCancel = vi.fn();
  await act(async () =>
    root.render(
      <CommentComposerPopup
        screen={{ x: 40, y: 40 }}
        rect={{ width: 800, height: 600 }}
        onSubmit={() => undefined}
        onCancel={onCancel}
      />,
    ),
  );
  const field = document.querySelector("textarea")!;
  expect(document.activeElement).toBe(field);
  await act(async () => typeInto(field, "かんじ draft"));

  const composing = new KeyboardEvent("keydown", {
    key: "Escape",
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    field.dispatchEvent(composing);
  });
  expect(onCancel).not.toHaveBeenCalled();
  expect(field.value).toBe("かんじ draft");

  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(onCancel).toHaveBeenCalledTimes(1);

  await act(async () => root.unmount());
  host.remove();
});
