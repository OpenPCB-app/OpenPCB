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

describe("createDesignerApi history endpoints", () => {
  test("calls history, undo and redo endpoints with session id", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            history: { canUndo: true, canRedo: false, undoDepth: 1, redoDepth: 0 },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            result: {
              ok: true,
              revision: 2,
              history: { canUndo: false, canRedo: true, undoDepth: 0, redoDepth: 1 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            result: {
              ok: true,
              revision: 3,
              history: { canUndo: true, canRedo: false, undoDepth: 1, redoDepth: 0 },
            },
          },
        }),
      );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const api = createDesignerApi({ backendURL: "http://localhost:3000", moduleId: "designer" });
      await expect(api.getHistory("design 1", "session 1")).resolves.toMatchObject({
        canUndo: true,
      });
      await expect(api.undo("design 1", "session 1")).resolves.toMatchObject({
        ok: true,
        revision: 2,
      });
      await expect(api.redo("design 1", "session 1")).resolves.toMatchObject({
        ok: true,
        revision: 3,
      });

      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        "http://localhost:3000/api/modules/designer/designs/design%201/history?sessionId=session%201",
      );
      expect(mockFetch.mock.calls[1]?.[0]).toBe(
        "http://localhost:3000/api/modules/designer/designs/design%201/history/undo",
      );
      expect(mockFetch.mock.calls[2]?.[0]).toBe(
        "http://localhost:3000/api/modules/designer/designs/design%201/history/redo",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
