import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { LibrarySDK, LibraryTagStat } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

interface TestHarness {
  runtime: ModuleRuntime;
  librarySdk: LibrarySDK;
  server: ReturnType<typeof createHttpServer>;
}

async function bootHarness(label: string): Promise<TestHarness> {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const registry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry: registry,
    workspaceRoot: repoRoot,
  });
  await runtime.bootstrap();
  const librarySdk = runtime
    .getSdkRegistry()
    .resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry: registry,
    moduleRuntime: runtime,
  });
  return { runtime, librarySdk, server };
}

async function cloneBuiltin(
  server: TestHarness["server"],
  sourceId: string,
): Promise<string> {
  const response = await server.fetch(
    new Request(
      `http://localhost/api/modules/library/components/${encodeURIComponent(
        sourceId,
      )}/clone`,
      { method: "POST" },
    ),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    data: { componentId: string };
  };
  return body.data.componentId;
}

function findTag(
  stats: LibraryTagStat[],
  tag: string,
): LibraryTagStat | undefined {
  return stats.find((entry) => entry.tag === tag);
}

describe("library tags & component edit", () => {
  test("listTags aggregates and counts across components", async () => {
    const { librarySdk } = await bootHarness("library-tags-aggregate");
    const stats = await librarySdk.listTags();
    // Builtins contribute passive, builtin, system tags (across resistor + capacitor)
    expect(findTag(stats, "passive")?.count).toBeGreaterThanOrEqual(2);
    expect(findTag(stats, "builtin")?.count).toBeGreaterThanOrEqual(2);
    expect(findTag(stats, "system")?.count).toBeGreaterThanOrEqual(2);
    // Sorted by count desc, then tag asc
    for (let i = 1; i < stats.length; i += 1) {
      const prev = stats[i - 1]!;
      const curr = stats[i]!;
      if (prev.count === curr.count) {
        expect(prev.tag.localeCompare(curr.tag)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.count).toBeGreaterThanOrEqual(curr.count);
      }
    }
  });

  test("listTags excludeSystem hides builtin/system/core/drawn-footprint/placeholder-footprint", async () => {
    const { librarySdk } = await bootHarness("library-tags-exclude-system");
    const stats = await librarySdk.listTags({ excludeSystem: true });
    expect(findTag(stats, "builtin")).toBeUndefined();
    expect(findTag(stats, "system")).toBeUndefined();
    expect(findTag(stats, "core")).toBeUndefined();
    expect(findTag(stats, "drawn-footprint")).toBeUndefined();
    expect(findTag(stats, "placeholder-footprint")).toBeUndefined();
    // Non-system tags should still appear
    expect(findTag(stats, "passive")).toBeDefined();
  });

  test("listTags via HTTP returns sorted stats", async () => {
    const { server } = await bootHarness("library-tags-http");
    const response = await server.fetch(
      new Request("http://localhost/api/modules/library/tags"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { tags: LibraryTagStat[] };
    };
    expect(body.ok).toBe(true);
    expect(body.data.tags.length).toBeGreaterThan(0);
    expect(typeof body.data.tags[0]!.tag).toBe("string");
    expect(typeof body.data.tags[0]!.count).toBe("number");
  });

  test("PATCH updates tags, name, description on user component", async () => {
    const { librarySdk, server } = await bootHarness("library-tags-patch-ok");
    const cloneId = await cloneBuiltin(server, "openpcb.core.passive.resistor");

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${cloneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Pull-up 10k",
            description: "Standard 10k pull-up resistor",
            tags: ["passive", "Resistor", "10k", "Pullup"],
          }),
        },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { component: { id: string; name: string; tags: string[] } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.component.name).toBe("Pull-up 10k");
    // Tags normalized to lowercase, de-duped
    expect(body.data.component.tags).toEqual([
      "passive",
      "resistor",
      "10k",
      "pullup",
    ]);

    // Re-fetch via SDK to confirm persistence
    const refreshed = await librarySdk.resolveComponent(cloneId);
    expect(refreshed?.name).toBe("Pull-up 10k");
    expect(refreshed?.description).toBe("Standard 10k pull-up resistor");
    expect(refreshed?.tags).toEqual(["passive", "resistor", "10k", "pullup"]);
  });

  test("PATCH with tags only leaves other fields unchanged", async () => {
    const { librarySdk, server } = await bootHarness(
      "library-tags-patch-partial",
    );
    const cloneId = await cloneBuiltin(server, "openpcb.core.passive.capacitor");
    const before = await librarySdk.resolveComponent(cloneId);
    expect(before).not.toBeNull();

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${cloneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["ceramic", "0603"] }),
        },
      ),
    );
    expect(response.status).toBe(200);
    const after = await librarySdk.resolveComponent(cloneId);
    expect(after?.name).toBe(before!.name);
    expect(after?.description).toBe(before!.description);
    expect(after?.tags).toEqual(["ceramic", "0603"]);
  });

  test("PATCH on builtin component is rejected with 400", async () => {
    const { server } = await bootHarness("library-tags-patch-builtin");
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${encodeURIComponent(
          "openpcb.core.passive.resistor",
        )}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["renamed"] }),
        },
      ),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail?: string; title?: string };
    const message = (body.detail ?? body.title ?? "").toLowerCase();
    expect(message).toContain("built-in");
  });

  test("PATCH on missing component returns 404", async () => {
    const { server } = await bootHarness("library-tags-patch-missing");
    const response = await server.fetch(
      new Request(
        "http://localhost/api/modules/library/components/no-such-id",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["foo"] }),
        },
      ),
    );
    expect(response.status).toBe(404);
  });

  test("PATCH rejects empty name and oversize fields", async () => {
    const { server } = await bootHarness("library-tags-patch-validate");
    const cloneId = await cloneBuiltin(server, "openpcb.core.passive.resistor");

    const emptyName = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${cloneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        },
      ),
    );
    expect(emptyName.status).toBe(400);

    const tooLong = "x".repeat(2001);
    const longDesc = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${cloneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: tooLong }),
        },
      ),
    );
    expect(longDesc.status).toBe(400);

    const badTags = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${cloneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: "not-an-array" }),
        },
      ),
    );
    expect(badTags.status).toBe(400);
  });

  test("designer module proxies /library/tags", async () => {
    const { server } = await bootHarness("library-tags-designer-proxy");
    const response = await server.fetch(
      new Request(
        "http://localhost/api/modules/designer/library/tags?excludeSystem=true",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { tags: LibraryTagStat[] };
    };
    expect(body.ok).toBe(true);
    // excludeSystem strips builtin
    expect(findTag(body.data.tags, "builtin")).toBeUndefined();
  });

  test("listTags reflects newly added tags after PATCH", async () => {
    const { librarySdk, server } = await bootHarness("library-tags-fresh");
    const cloneId = await cloneBuiltin(server, "openpcb.core.passive.resistor");

    const before = await librarySdk.listTags();
    expect(findTag(before, "high-power")).toBeUndefined();

    await server.fetch(
      new Request(
        `http://localhost/api/modules/library/components/${cloneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["passive", "high-power"] }),
        },
      ),
    );

    const after = await librarySdk.listTags();
    expect(findTag(after, "high-power")?.count).toBe(1);
  });
});
