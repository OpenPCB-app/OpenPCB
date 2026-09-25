import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cancelAllDialogs,
  confirmDialog,
  promptDialog,
  registerDialogHost,
  useDialogHostStore,
} from "./dialog-host-store";

const queue = () => useDialogHostStore.getState().queue;

describe("dialog host queue", () => {
  let unregisterHost: () => void = () => {};
  beforeEach(() => {
    cancelAllDialogs();
    unregisterHost = registerDialogHost();
  });
  afterEach(() => unregisterHost());

  it("queues FIFO and resolves each request once", async () => {
    const first = confirmDialog({ title: "Delete R3?", tone: "danger" });
    const second = promptDialog({ title: "Rename design", defaultValue: "Board" });
    expect(queue().map((r) => r.kind)).toEqual(["confirm", "prompt"]);

    const head = queue()[0];
    if (head?.kind !== "confirm") throw new Error("expected confirm first");
    head.settle(true);
    head.settle(false);
    await expect(first).resolves.toBe(true);
    expect(queue().map((r) => r.kind)).toEqual(["prompt"]);

    const next = queue()[0];
    if (next?.kind !== "prompt") throw new Error("expected prompt");
    next.settle("Main board");
    await expect(second).resolves.toBe("Main board");
    expect(queue()).toEqual([]);
  });

  it("cancelAllDialogs settles confirm=false and prompt=null", async () => {
    const a = confirmDialog({ title: "Discard?" });
    const b = promptDialog({ title: "Name" });
    cancelAllDialogs();
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBeNull();
    expect(queue()).toEqual([]);
  });

  it("counts mounted hosts", () => {
    const before = useDialogHostStore.getState().hosts;
    const off = registerDialogHost();
    expect(useDialogHostStore.getState().hosts).toBe(before + 1);
    off();
    expect(useDialogHostStore.getState().hosts).toBe(before);
  });
});
