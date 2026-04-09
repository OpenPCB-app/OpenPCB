import { describe, expect, test } from "bun:test";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";

describe("diagnostics endpoint", () => {
  test("returns minimal diagnostics payload", async () => {
    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
    });

    const response = await server.fetch(
      new Request("http://localhost/api/diagnostics"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        startedAt: string;
        uptimeMs: number;
        errorCount: number;
        recentErrors: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.data.startedAt).toBe("string");
    expect(body.data.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.data.errorCount).toBe(0);
    expect(Array.isArray(body.data.recentErrors)).toBe(true);
  });
});
