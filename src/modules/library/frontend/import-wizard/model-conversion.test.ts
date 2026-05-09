import { describe, expect, test, vi } from "vitest";

vi.mock("./steps/SymbolStep", () => ({ SymbolStep: () => null }));
vi.mock("./steps/FootprintStep", () => ({ FootprintStep: () => null }));
vi.mock("./steps/ModelStep", () => ({ ModelStep: () => null }));
vi.mock("./steps/MetadataStep", () => ({ MetadataStep: () => null }));
vi.mock("./editor", () => ({ useSymbolEditorStore: { getState: () => ({ reset: vi.fn() }) } }));
vi.mock("./footprint-editor", () => ({ useFootprintEditorStore: { getState: () => ({ reset: vi.fn() }) } }));
import {
  convertPendingModelConversion,
  uploadFootprintStepModel,
} from "../three-d/model-conversion";

vi.mock("../three-d/step-to-glb", () => ({
  convertStepToGlb: vi.fn(async (stepBytes: ArrayBuffer) => {
    const text = new TextDecoder().decode(stepBytes);
    if (text.includes("not a STEP")) {
      return { status: "error", code: "invalid_step", message: "Invalid STEP data" };
    }
    return {
      status: "ok",
      glbBytes: new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer,
      sha256: "0".repeat(64),
    };
  }),
}));

const conversion = {
  footprintId: "fp-1",
  sourceStepSha256: "1".repeat(64),
  sourceStepUrl: "/footprints/fp-1/model/source",
  sourceFilename: "minimal.step",
  selectedModel: {
    fileName: "minimal.step",
    extension: ".step",
    association: "single-model" as const,
  },
  modelRef: null,
  status: "pending_client_conversion" as const,
};

function response(bytes: string, ok = true): Response {
  return new Response(new TextEncoder().encode(bytes), { status: ok ? 200 : 500 });
}

describe("ZIP post-commit model conversion", () => {
  test("fetches STEP source, converts, and uploads GLB", async () => {
    const progress: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return response("ISO-10303-21; END-ISO-10303-21;");
      return new Response(JSON.stringify({ ok: true, data: { status: "ready" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await convertPendingModelConversion({
      backendURL: "http://localhost:3000",
      moduleId: "library",
      conversion,
      onProgress: (status) => progress.push(status),
    });

    expect(progress).toEqual(["fetching_source", "converting", "uploading", "ready"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/api/modules/library/footprints/fp-1/model/source",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:3000/api/modules/library/footprints/fp-1/model",
    );
  });

  test("garbage STEP reports failure before uploading GLB", async () => {
    const progress: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true, data: { status: "failed" } }));
      }
      return response("this is not a STEP file");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      convertPendingModelConversion({
        backendURL: "http://localhost:3000",
        moduleId: "library",
        conversion,
        onProgress: (status) => progress.push(status),
      }),
    ).rejects.toThrow("Invalid STEP data");

    expect(progress).toEqual(["fetching_source", "converting", "failed"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
  });
});

describe("wizard STEP model upload", () => {
  test("converts selected STEP and uploads GLB with source STEP bytes", async () => {
    const progress: string[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { status: "ready" } })));
    vi.stubGlobal("fetch", fetchMock);

    await uploadFootprintStepModel({
      backendURL: "http://localhost:3000",
      moduleId: "library",
      footprintId: "fp-1",
      stepFile: new File(["ISO-10303-21; END-ISO-10303-21;"], "manual.step", {
        type: "model/step",
      }),
      onProgress: (status) => progress.push(status),
    });

    expect(progress).toEqual(["converting", "uploading", "ready"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/api/modules/library/footprints/fp-1/model",
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("sourceStep")).toBeInstanceOf(File);
    expect((body as FormData).get("sourceFilename")).toBe("manual.step");
  });
});
