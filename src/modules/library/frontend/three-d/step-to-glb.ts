export interface TessellationParams {
  linearUnit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
  linearDeflectionType?: "bounding_box_ratio" | "absolute_value";
  linearDeflection?: number;
  angularDeflection?: number;
}

export interface Model3DRef {
  path: string;
  resolvedFileName: string;
  offset: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface StepToGlbRequest {
  stepBytes: ArrayBuffer;
  params: TessellationParams;
  modelRef?: Model3DRef | null;
  timeoutMs?: number;
}

export interface StepToGlbOkResult {
  status: "ok";
  glbBytes: ArrayBuffer;
  sha256: string;
}

export interface StepToGlbErrorResult {
  status: "error";
  code: string;
  message: string;
}

export type ConversionResult = StepToGlbOkResult | StepToGlbErrorResult;

export type StepToGlbWorkerRequest = StepToGlbRequest & {
  type: "convert";
  requestId: string;
};

export interface StepToGlbWorkerCancelRequest {
  type: "cancel";
  requestId: string;
}

export type StepToGlbWorkerResponse = ConversionResult & {
  requestId: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

type WorkerFactory = () => Worker;

function createStepToGlbWorker(): Worker {
  return new Worker(new URL("./step-to-glb.worker.ts", import.meta.url), {
    type: "module",
  });
}

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `step-to-glb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorResult(code: string, message: string): StepToGlbErrorResult {
  return { status: "error", code, message };
}

function detachArrayBuffer(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

export async function convertStepToGlb(
  stepBytes: ArrayBuffer,
  params: TessellationParams,
  modelRef?: Model3DRef | null,
  signal?: AbortSignal,
  workerFactory: WorkerFactory = createStepToGlbWorker,
): Promise<ConversionResult> {
  if (signal?.aborted) {
    return errorResult("conversion_timeout", "STEP to GLB conversion was cancelled");
  }

  const requestId = makeRequestId();
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const worker = workerFactory();
  let settled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  return new Promise<ConversionResult>((resolve) => {
    const cleanup = (): void => {
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };

    const finish = (result: ConversionResult): void => {
      if (settled) {
        return;
      }
      cleanup();
      resolve(result);
    };

    const cancelWorker = (): void => {
      worker.postMessage({ type: "cancel", requestId } satisfies StepToGlbWorkerCancelRequest);
    };

    const handleAbort = (): void => {
      cancelWorker();
      finish(errorResult("conversion_timeout", "STEP to GLB conversion was cancelled"));
    };

    signal?.addEventListener("abort", handleAbort, { once: true });

    timeoutHandle = setTimeout(() => {
      cancelWorker();
      finish(errorResult("conversion_timeout", `STEP to GLB conversion exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<StepToGlbWorkerResponse>): void => {
      if (event.data.requestId !== requestId) {
        return;
      }

      if (event.data.status === "ok") {
        finish({ status: "ok", glbBytes: event.data.glbBytes, sha256: event.data.sha256 });
        return;
      }

      finish({ status: "error", code: event.data.code, message: event.data.message });
    };

    worker.onerror = (event): void => {
      finish(errorResult("conversion_worker_error", event.message));
    };

    const request: StepToGlbWorkerRequest = {
      type: "convert",
      requestId,
      stepBytes: detachArrayBuffer(stepBytes),
      params,
      modelRef,
      timeoutMs,
    };

    worker.postMessage(request, [request.stepBytes]);
  });
}
