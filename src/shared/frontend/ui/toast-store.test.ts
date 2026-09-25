import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOAST_DEFAULT_MS,
  TOAST_ERROR_MS,
  clearToasts,
  pauseToasts,
  resumeToasts,
  toast,
  useToastStore,
} from "./toast-store";

const ids = () => useToastStore.getState().toasts.map((t) => t.id);

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });
  afterEach(() => {
    resumeToasts();
    clearToasts();
    vi.useRealTimers();
  });

  it("auto-dismisses info after 4 s and errors after 8 s", () => {
    toast.info("Saved");
    toast.error("Couldn't save");
    expect(useToastStore.getState().toasts.map((t) => t.tone)).toEqual(["info", "danger"]);
    vi.advanceTimersByTime(TOAST_DEFAULT_MS);
    expect(useToastStore.getState().toasts.map((t) => t.tone)).toEqual(["danger"]);
    vi.advanceTimersByTime(TOAST_ERROR_MS - TOAST_DEFAULT_MS);
    expect(ids()).toEqual([]);
  });

  it("keeps sticky toasts until dismissed", () => {
    const id = toast.show({ message: "Offline", durationMs: null });
    vi.advanceTimersByTime(60_000);
    expect(ids()).toEqual([id]);
    toast.dismiss(id);
    expect(ids()).toEqual([]);
  });

  it("dedupes by id: replaces in place and restarts the timer", () => {
    toast.show({ id: "sync", message: "Syncing…" });
    toast.info("Other");
    vi.advanceTimersByTime(TOAST_DEFAULT_MS - 1000);
    toast.show({ id: "sync", message: "Synced", tone: "success" });
    const state = useToastStore.getState().toasts;
    expect(state.map((t) => t.id)[0]).toBe("sync");
    expect(state[0]?.message).toBe("Synced");
    vi.advanceTimersByTime(1000);
    expect(ids()).toEqual(["sync"]);
    vi.advanceTimersByTime(TOAST_DEFAULT_MS);
    expect(ids()).toEqual([]);
  });

  it("pauses every countdown while hovered and resumes with the remainder", () => {
    toast.info("Hello");
    vi.advanceTimersByTime(3000);
    pauseToasts();
    vi.advanceTimersByTime(10_000);
    expect(ids()).toHaveLength(1);
    resumeToasts();
    vi.advanceTimersByTime(999);
    expect(ids()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ids()).toHaveLength(0);
  });

  it("returns the id and carries the action", () => {
    const onClick = vi.fn();
    const id = toast.warning("Unsaved changes", { action: { label: "Review", onClick } });
    const item = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(item?.tone).toBe("warning");
    item?.action?.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
