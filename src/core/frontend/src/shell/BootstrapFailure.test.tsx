// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootstrapProvider, useBootstrap } from "../providers/BootstrapProvider";
import { BootstrapFailure } from "./BootstrapFailure";

vi.mock("../providers/RuntimeProvider", () => ({
  useRuntime: () => ({ runtime: "browser", backendURL: "http://127.0.0.1:3000", error: null }),
}));

function Probe() {
  const { status, error, retry } = useBootstrap();
  if (status === "error") return <BootstrapFailure message={error ?? "unknown"} onRetry={retry} />;
  return <div data-testid="status">{status}</div>;
}

let container: HTMLDivElement;
let root: Root;

async function click(text: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!button) throw new Error(`Button missing: ${text}`);
  await act(async () => { button.click(); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("bootstrap failure + retry", () => {
  it("shows the failure, then Retry re-runs bootstrap and reaches ready without reload", async () => {
    let healthOk = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/health")) return new Response("{}", { status: healthOk ? 200 : 500 });
      return Response.json({ modules: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => { root.render(<BootstrapProvider><Probe /></BootstrapProvider>); });
    await act(async () => {});

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Backend health check failed: HTTP 500",
    );
    const callsBefore = fetchMock.mock.calls.length;

    healthOk = true;
    await click("Retry");
    await act(async () => {});

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("ready");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("Copy details copies the bootstrap message, not a render stack", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => {
      root.render(<BootstrapFailure message="Backend health check failed: HTTP 500" onRetry={() => {}} />);
    });
    await click("Copy details");
    expect(writeText).toHaveBeenCalledWith("Backend health check failed: HTTP 500");
  });
});
