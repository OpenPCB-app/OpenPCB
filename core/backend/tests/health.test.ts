import { describe, expect, test } from "bun:test";
import { createHttpServer } from "../runtime/http/create-http-server";
import { DiagnosticsStore } from "../runtime/diagnostics/diagnostics-store";

describe("health endpoint", () => {
  test("returns legacy success envelope", async () => {
    const server = createHttpServer({ diagnosticsStore: new DiagnosticsStore() });

    const response = await server.fetch(new Request("http://localhost/api/health"));
    const body = (await response.json()) as { ok: boolean; data?: { status?: string } };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.status).toBe("ok");
  });
});
