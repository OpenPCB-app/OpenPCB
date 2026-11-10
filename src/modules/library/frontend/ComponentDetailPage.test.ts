// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { ComponentDetailPayload, ComponentFootprintVariant } from "./types";

vi.mock("../../../shared/frontend/canvas/preview", () => ({
  FootprintPreviewCanvas: () => null,
  SymbolPreviewCanvas: () => null,
}));
vi.mock("./three-d/ThreeDComponentPreview", () => ({
  ThreeDComponentPreview: () => null,
}));

const detailState = vi.hoisted(() => ({
  detail: null as ComponentDetailPayload | null,
}));
vi.mock("./hooks/useComponentDetail", () => ({
  useComponentDetail: () => ({
    detail: detailState.detail,
    loading: false,
    error: null,
    setDetail: () => undefined,
  }),
}));
vi.mock("./hooks/useFootprintGeometry", () => ({
  useFootprintGeometry: () => ({ status: "loading" }),
}));
vi.mock("./hooks/useLibraryTags", () => ({
  useLibraryTags: () => ({ tags: [] }),
}));
vi.mock("../../../core/frontend/src/providers/ThemeProvider", () => ({
  useTheme: () => ({ mode: "dark" }),
}));

import { ComponentDetailPage, validateStepUploadFile } from "./ComponentDetailPage";

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

const FLAGGED_REASON =
  "Generated before generator provenance was recorded; its geometry cannot be verified.";

function payload(variant: Partial<ComponentFootprintVariant>): ComponentDetailPayload {
  const footprintVariant: ComponentFootprintVariant = {
    footprintId: "fp-1",
    variantLabel: "Generated",
    isDefault: true,
    sortOrder: 0,
    name: "Generated",
    mountType: "SMD",
    padCount: 2,
    packageCode: { imperial: null, metric: null },
    pinMap: null,
    ...variant,
  };
  return {
    component: {
      id: "c-1",
      name: "R",
      description: "",
      tags: [],
      isBuiltin: false,
      symbolId: "s-1",
      footprintId: "fp-1",
    },
    symbol: {
      id: "s-1",
      name: "R",
      referencePrefix: "R",
      pinCount: 2,
      warnings: [],
      preview: null,
      provenance: null,
    },
    footprint: {
      id: "fp-1",
      name: "Generated",
      mountType: "SMD",
      padCount: 2,
      packageCode: { imperial: null, metric: null },
      warnings: [],
      preview: null,
      provenance: null,
    },
    footprintVariants: [footprintVariant],
  } as unknown as ComponentDetailPayload;
}

function renderPage(detail: ComponentDetailPayload): HTMLElement {
  detailState.detail = detail;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(ComponentDetailPage, {
        backendURL: "http://backend",
        moduleId: "library",
        componentId: "c-1",
        onBack: () => undefined,
      }),
    );
  });
  return host;
}

describe("footprint qualification badge", () => {
  test("an unqualified generated footprint shows the badge with its reason", () => {
    const host = renderPage(
      payload({
        qualification: {
          status: "unqualified-generator",
          reason: FLAGGED_REASON,
          generatorKind: "legacy-generated",
          generatorLabel: null,
        },
      }),
    );
    const badge = host.querySelector('[data-testid="footprint-unqualified-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("title")).toBe(FLAGGED_REASON);
  });

  test("qualified, not-generated and unclassified footprints show no badge", () => {
    for (const qualification of [
      { status: "qualified", reason: null, generatorKind: "template", generatorLabel: "pin-header" },
      { status: "not-generated", reason: null, generatorKind: null, generatorLabel: null },
      undefined,
    ] as const) {
      const host = renderPage(payload({ qualification }));
      expect(host.querySelector('[data-testid="footprint-unqualified-badge"]')).toBeNull();
    }
  });
});
