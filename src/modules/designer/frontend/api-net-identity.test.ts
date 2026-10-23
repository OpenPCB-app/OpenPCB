import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesignerApi, DesignerApiProblemError } from "./api";

afterEach(() => vi.unstubAllGlobals());
const api = () => createDesignerApi({ backendURL: "http://local", moduleId: "designer" });
const data = { revision: 7, status: "active", mode: "durable", groups: [] };

describe("net identity API", () => {
  it("gets the flat status at an encoded design URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data })); vi.stubGlobal("fetch", fetcher);
    expect(await api().getNetIdentity("a/b")).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith("http://local/api/modules/designer/designs/a%2Fb/net-identity", undefined);
  });
  it("uses one POST for migration and explicit boolean bodies for each restore attempt", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ data })); vi.stubGlobal("fetch", fetcher);
    expect(await api().migrateNetIdentity("a")).toEqual(data);
    await api().restoreNetIdentity("a"); await api().restoreNetIdentity("a", true);
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["http://local/api/modules/designer/designs/a/net-identity/migrate", "POST", undefined],
      ["http://local/api/modules/designer/designs/a/net-identity/restore-legacy", "POST", '{"confirmDiscardRevisions":false}'],
      ["http://local/api/modules/designer/designs/a/net-identity/restore-legacy", "POST", '{"confirmDiscardRevisions":true}'],
    ]);
  });
  it("preserves RFC7807 status, type, code and extra fields while retaining the old message", async () => {
    const problem = { status: 409, type: "https://openpcb.dev/problems/net-identity-restore-discards-edits",
      title: "Restore discards later edits", detail: "Later edits would be lost", code: "EXAMPLE", revision: 9 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(problem, { status: 409, headers: { "content-type": "application/problem+json" } })));
    const error = await api().restoreNetIdentity("a").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DesignerApiProblemError);
    expect(error).toMatchObject({ status: 409, message: problem.detail, code: "EXAMPLE", problem });
  });
  it.each([422, 500])("does not retry HTTP %s", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("failure", { status })); vi.stubGlobal("fetch", fetcher);
    await expect(api().migrateNetIdentity("a")).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
