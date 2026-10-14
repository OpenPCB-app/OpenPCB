import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cancelAllDialogs,
  registerDialogHost,
  useDialogHostStore,
  type PromptDialogOptions,
} from "@shared/frontend/ui/dialog-host-store";
import {
  parsePositiveMm,
  promptOverlayText,
  promptPositiveMm,
} from "./pcb-prompts";

function head(): {
  options: PromptDialogOptions;
  settle: (value: string | null) => void;
} {
  const request = useDialogHostStore.getState().queue[0];
  if (request?.kind !== "prompt") throw new Error("expected a prompt");
  return request;
}

describe("PCB kit prompts", () => {
  let unregisterHost: () => void = () => {};
  beforeEach(() => {
    cancelAllDialogs();
    unregisterHost = registerDialogHost();
  });
  afterEach(() => unregisterHost());

  it("parses only finite positive millimetres", () => {
    expect(parsePositiveMm("0.254")).toBe(0.254);
    expect(parsePositiveMm(" 1 ")).toBe(1);
    for (const bad of ["", " ", "0", "-0.2", "abc", "Infinity", "NaN"]) {
      expect(parsePositiveMm(bad)).toBeNull();
    }
  });

  it("numeric prompt validates input and resolves the parsed value", async () => {
    const result = promptPositiveMm("Custom trace width", "Width (mm)", 0.25);
    const request = head();
    expect(request.options).toMatchObject({
      title: "Custom trace width",
      label: "Width (mm)",
      defaultValue: "0.25",
      inputMode: "decimal",
    });
    expect(request.options.validate?.("0")).toMatch(/greater than 0/);
    expect(request.options.validate?.("x")).toMatch(/greater than 0/);
    expect(request.options.validate?.("0.3")).toBeNull();
    request.settle("0.3");
    await expect(result).resolves.toBe(0.3);
  });

  it("numeric prompt resolves null on cancel", async () => {
    const result = promptPositiveMm("Custom via drill", "Drill (mm)", 0.4);
    head().settle(null);
    await expect(result).resolves.toBeNull();
  });

  it("overlay text prompt rejects blank text and returns the entered label", async () => {
    const result = promptOverlayText();
    const request = head();
    expect(request.options.validate?.("   ")).not.toBeNull();
    expect(request.options.validate?.("REV A")).toBeNull();
    request.settle("REV A");
    await expect(result).resolves.toBe("REV A");
  });
});
