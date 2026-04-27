import { describe, expect, test, vi } from "vitest";
import { createDesignerApi } from "../../../modules/designer/frontend/api";

describe("createDesignerApi error handling", () => {
  test("parses problem-details error responses", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://openpcb.dev/problems/validation",
          title: "Bad Request",
          status: 400,
          detail: "Missing required field: componentId",
        }),
        {
          status: 400,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const api = createDesignerApi({ backendURL: "http://localhost:3000", moduleId: "designer" });

    await expect(api.listDesigns()).rejects.toThrow("Missing required field: componentId");

    globalThis.fetch = originalFetch;
  });

  test("falls back to HTTP status for non-problem errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const api = createDesignerApi({ backendURL: "http://localhost:3000", moduleId: "designer" });

    await expect(api.listDesigns()).rejects.toThrow("HTTP 500");

    globalThis.fetch = originalFetch;
  });
});
