import { describe, expect, test } from "bun:test";
import { createGracefulQuitHandler, settleShutdownSteps } from "../src/main/graceful-quit";

function fixture(stop: () => Promise<void>, reportFailure: () => void = () => {}) {
  let stoppedEvents = 0;
  let quitCalls = 0;
  let allowedQuits = 0;
  const event = () => {
    let prevented = false;
    handler({ preventDefault: () => { prevented = true; stoppedEvents++; } });
    if (!prevented) allowedQuits++;
  };
  const handler = createGracefulQuitHandler({ stop, reportFailure, quit: () => { quitCalls++; event(); } });
  return { event, counts: () => ({ stoppedEvents, quitCalls, allowedQuits }) };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Electron graceful quit", () => {
  test("repeated quit waits once, then allows the guarded app.quit re-entry", async () => {
    let finish = () => {};
    let closes = 0;
    const closed = new Promise<void>((resolve) => { finish = resolve; });
    const app = fixture(() => { closes++; return closed; });
    app.event();
    app.event();
    await tick();
    expect(closes).toBe(1);
    expect(app.counts()).toEqual({ stoppedEvents: 2, quitCalls: 0, allowedQuits: 0 });
    finish();
    await tick();
    expect(app.counts()).toEqual({ stoppedEvents: 2, quitCalls: 1, allowedQuits: 1 });
    app.event();
    expect(closes).toBe(1);
    expect(app.counts().quitCalls).toBe(1);
  });

  test("failed cleanup logs once without error data and still resumes quit", async () => {
    let reports = 0;
    const app = fixture(() => Promise.reject(new Error("private credential")), () => { reports++; });
    app.event();
    app.event();
    await tick();
    expect(reports).toBe(1);
    expect(app.counts()).toEqual({ stoppedEvents: 2, quitCalls: 1, allowedQuits: 1 });
  });

  test("a synchronous cleanup or logger failure cannot strand quit", async () => {
    const app = fixture(() => { throw new Error("close failed"); }, () => { throw new Error("logger failed"); });
    app.event();
    await tick();
    expect(app.counts()).toEqual({ stoppedEvents: 1, quitCalls: 1, allowedQuits: 1 });
  });

  test("runtime settles before DRC/MCP cleanup and reference clear, even on failure", async () => {
    const calls: string[] = [];
    let finish = () => {};
    const closed = new Promise<void>((resolve) => { finish = resolve; });
    const shutdown = settleShutdownSteps([
      async () => { calls.push("close"); await closed; throw new Error("close failed"); },
      () => { calls.push("DRC"); throw new Error("worker failed"); },
      () => { calls.push("MCP"); },
      () => { calls.push("references"); },
    ]);
    expect(calls).toEqual(["close"]);
    const rejected = shutdown.catch((error: unknown) => error);
    finish();
    expect(await rejected).toBeInstanceOf(AggregateError);
    expect(calls).toEqual(["close", "DRC", "MCP", "references"]);
  });

  test("updater-triggered quit preserves final quit hooks after cleanup", async () => {
    const calls: string[] = [];
    const handler = createGracefulQuitHandler({
      stop: async () => { calls.push("backend closed"); },
      reportFailure: () => { throw new Error("unexpected cleanup failure"); },
      quit: () => {
        handler({ preventDefault: () => { throw new Error("final quit blocked"); } });
        calls.push("updater quit hook");
      },
    });
    handler({ preventDefault: () => { calls.push("initial quit deferred"); } });
    await tick();
    expect(calls).toEqual(["initial quit deferred", "backend closed", "updater quit hook"]);
  });
});
