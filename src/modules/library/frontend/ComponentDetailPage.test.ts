import { describe, expect, test, vi } from "vitest";

vi.mock("../../../shared/frontend/canvas/preview", () => ({
  FootprintPreviewCanvas: () => null,
  SymbolPreviewCanvas: () => null,
}));
vi.mock("./three-d/ThreeDComponentPreview", () => ({
  ThreeDComponentPreview: () => null,
}));

import { validateStepUploadFile } from "./ComponentDetailPage";

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "model/step" });
}

describe("manual STEP upload validation", () => {
  test("accepts STEP and STP files for editable upload flow", () => {
    expect(validateStepUploadFile(makeFile("minimal.step", 8))).toBeNull();
    expect(validateStepUploadFile(makeFile("minimal.stp", 8))).toBeNull();
  });

  test("rejects direct GLB selection", () => {
    expect(validateStepUploadFile(makeFile("model.glb", 8))).toBe(
      "Select a STEP file (.step or .stp).",
    );
  });

  test("rejects STEP files larger than 25 MB", () => {
    expect(validateStepUploadFile(makeFile("large.step", 25 * 1024 * 1024 + 1))).toBe(
      "STEP file must be 25 MB or smaller.",
    );
  });
});
