import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "@shared/frontend/ui/toast";
import { ToastProvider, useToast } from "./use-toast";

function captureAdapter() {
  let api: ReturnType<typeof useToast> | undefined;
  function Capture() {
    api = useToast();
    return <span>child</span>;
  }
  const markup = renderToStaticMarkup(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
  if (!api) throw new Error("Missing adapter context");
  return { api, markup };
}

beforeEach(() => {
  vi.useFakeTimers();
  toast.clear();
});
afterEach(() => {
  toast.clear();
  vi.useRealTimers();
});

describe("Designer toast adapter", () => {
  it("renders children without adding a second viewport", () => {
    expect(captureAdapter().markup).toBe("<span>child</span>");
  });
  it.each([undefined, 1, 3000])(
    "keeps handled errors sticky with duration %s",
    (duration) => {
      captureAdapter().api.addToast("Placement failed", "error", duration);
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        tone: "danger",
        durationMs: null,
      });
      vi.advanceTimersByTime(60000);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    },
  );
  it("honors explicit non-error duration", () => {
    captureAdapter().api.addToast("Notice", "warning", 100);
    vi.advanceTimersByTime(99);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
  it("removes owned notices without dismissing another root notification", () => {
    const { api } = captureAdapter();
    const foreign = toast.error("Global error", { durationMs: null });
    api.addToast("Placement failed", "error");
    const owned = useToastStore
      .getState()
      .toasts.find((item) => item.id !== foreign);
    if (!owned) throw new Error("Missing handled error");
    api.removeToast(foreign);
    api.removeToast(owned.id);
    expect(useToastStore.getState().toasts.map((item) => item.id)).toEqual([
      foreign,
    ]);
  });
});
