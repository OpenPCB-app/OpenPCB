import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BootstrapFailure } from "./BootstrapFailure";
import { Recovery } from "./Recovery";

describe("BootstrapFailure", () => {
  it("renders the message with Retry and Copy details actions", () => {
    const html = renderToStaticMarkup(
      <BootstrapFailure message="Backend health check failed: HTTP 500" onRetry={() => {}} />,
    );
    expect(html).toContain("Backend health check failed: HTTP 500");
    expect(html).toContain("Retry");
    expect(html).toContain("Copy details");
    expect(html).toContain('role="alert"');
  });

  it("wires Retry to the bootstrap retry, not a reload", () => {
    const onRetry = vi.fn();
    const element = BootstrapFailure({ message: "x", onRetry });
    expect(element.type).toBe(Recovery);
    expect(element.props.reset).toBe(onRetry);
    expect(element.props.retryLabel).toBe("Retry");
  });
});
