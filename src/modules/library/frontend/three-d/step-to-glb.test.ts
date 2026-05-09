import { afterEach, describe, expect, test, vi } from "vitest";
import { convertStepToGlb, type StepToGlbWorkerResponse } from "./step-to-glb";

class MockWorker {
  onmessage: ((event: MessageEvent<StepToGlbWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(private readonly handler?: (worker: MockWorker, message: unknown) => void) {}

  postMessage(message: unknown): void {
    this.handler?.(this, message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: StepToGlbWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<StepToGlbWorkerResponse>);
  }
}

function glbFixture(): ArrayBuffer {
  const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("convertStepToGlb", () => {
  test("returns mocked GLB bytes whose first four bytes are glTF", async () => {
    const glbBytes = glbFixture();
    const digest = await sha256(glbBytes);
    const worker = new MockWorker((target, message) => {
      const requestId = (message as { requestId: string }).requestId;
      queueMicrotask(() => target.emit({ requestId, status: "ok", glbBytes, sha256: digest }));
    });

    const result = await convertStepToGlb(new ArrayBuffer(4), {}, null, undefined, () => worker as unknown as Worker);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    expect(Array.from(new Uint8Array(result.glbBytes.slice(0, 4)))).toEqual([0x67, 0x6c, 0x54, 0x46]);
    expect(worker.terminated).toBe(true);
  });

  test("returns a SHA-256 matching a recomputed hash", async () => {
    const glbBytes = glbFixture();
    const digest = await sha256(glbBytes);
    const worker = new MockWorker((target, message) => {
      const requestId = (message as { requestId: string }).requestId;
      queueMicrotask(() => target.emit({ requestId, status: "ok", glbBytes, sha256: digest }));
    });

    const result = await convertStepToGlb(new ArrayBuffer(4), {}, null, undefined, () => worker as unknown as Worker);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    await expect(sha256(result.glbBytes)).resolves.toBe(result.sha256);
  });

  test("returns a typed timeout error when the worker does not respond", async () => {
    vi.useFakeTimers();
    const worker = new MockWorker();
    const resultPromise = convertStepToGlb(
      new ArrayBuffer(4),
      {},
      null,
      undefined,
      () => worker as unknown as Worker,
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(resultPromise).resolves.toEqual({
      status: "error",
      code: "conversion_timeout",
      message: "STEP to GLB conversion exceeded 30000ms",
    });
    expect(worker.terminated).toBe(true);
  });

  test("returns a typed timeout error when cancelled", async () => {
    const controller = new AbortController();
    const worker = new MockWorker();
    const resultPromise = convertStepToGlb(
      new ArrayBuffer(4),
      {},
      null,
      controller.signal,
      () => worker as unknown as Worker,
    );

    controller.abort();

    await expect(resultPromise).resolves.toEqual({
      status: "error",
      code: "conversion_timeout",
      message: "STEP to GLB conversion was cancelled",
    });
    expect(worker.terminated).toBe(true);
  });
});
