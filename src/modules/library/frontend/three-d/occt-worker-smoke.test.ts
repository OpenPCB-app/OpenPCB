import { describe, expect, test, vi } from "vitest";

const { occtImportJs } = vi.hoisted(() => ({
  occtImportJs: vi.fn(),
}));

vi.mock("occt-import-js", () => ({
  default: occtImportJs,
}));

describe("initOcct", () => {
  test("returns a typed error response when OCCT init rejects", async () => {
    occtImportJs.mockRejectedValueOnce(new Error("WASM init failed"));

    const { initOcct } = await import("./occt-worker-smoke");

    await expect(initOcct()).resolves.toEqual({
      status: "error",
      message: "WASM init failed",
    });
  });
});
