import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  resolveThreeDPreviewState,
  ThreeDPreviewStatePanel,
} from "./ThreeDComponentPreview";

describe("ThreeDComponentPreview states", () => {
  test("renders upload CTA for editable components with no model", () => {
    const state = resolveThreeDPreviewState(
      {
        status: "missing",
        hasModel: false,
        glbSha256: null,
        sourceStepSha256: null,
        sourceFilename: null,
        modelRef: null,
        byteSize: null,
        errorMessage: null,
      },
      "/model",
      null,
    );

    expect(state.kind).toBe("missing");
    if (state.kind === "ready") return;

    const markup = renderToStaticMarkup(
      <ThreeDPreviewStatePanel state={state} isBuiltin={false} />,
    );
    expect(markup).toContain("library-3d-upload-step");
    expect(markup).toContain("Upload STEP");
  });

  test("does not render upload CTA for built-in components", () => {
    const state = resolveThreeDPreviewState(null, "/model", null);
    const markup = renderToStaticMarkup(
      <ThreeDPreviewStatePanel state={state} isBuiltin={true} />,
    );

    expect(markup).not.toContain("library-3d-upload-step");
  });

  test("maps pending conversion to progress copy", () => {
    const state = resolveThreeDPreviewState(
      {
        status: "pending_client_conversion",
        hasModel: false,
        glbSha256: null,
        sourceStepSha256: "abc",
        sourceFilename: "part.step",
        modelRef: null,
        byteSize: null,
        errorMessage: null,
      },
      "/model",
      null,
    );

    expect(state.kind).toBe("pending_client_conversion");
    if (state.kind === "ready") return;

    const markup = renderToStaticMarkup(
      <ThreeDPreviewStatePanel state={state} isBuiltin={false} />,
    );
    expect(markup).toContain("Converting 3D model");
  });

  test("maps ready metadata to model URL", () => {
    const state = resolveThreeDPreviewState(
      {
        status: "ready",
        hasModel: true,
        glbSha256: "abc",
        sourceStepSha256: null,
        sourceFilename: null,
        modelRef: null,
        byteSize: 1024,
        errorMessage: null,
      },
      "/model?sha=abc",
      null,
    );

    expect(state).toEqual({ kind: "ready", modelUrl: "/model?sha=abc" });
  });

  test("renders failed and unsupported WRL states", () => {
    const failed = resolveThreeDPreviewState(
      {
        status: "failed",
        hasModel: false,
        glbSha256: null,
        sourceStepSha256: null,
        sourceFilename: "part.step",
        modelRef: null,
        byteSize: null,
        errorMessage: "Conversion failed",
      },
      "/model",
      null,
    );
    const unsupported = resolveThreeDPreviewState(
      {
        status: "ready",
        hasModel: false,
        glbSha256: null,
        sourceStepSha256: null,
        sourceFilename: "legacy.wrl",
        modelRef: null,
        byteSize: null,
        errorMessage: null,
      },
      "/model",
      null,
    );

    if (failed.kind === "ready" || unsupported.kind === "ready") return;

    expect(renderToStaticMarkup(<ThreeDPreviewStatePanel state={failed} isBuiltin={false} />)).toContain(
      "library-3d-error",
    );
    expect(renderToStaticMarkup(<ThreeDPreviewStatePanel state={unsupported} isBuiltin={false} />)).toContain(
      "WRL format not supported",
    );
  });
});
