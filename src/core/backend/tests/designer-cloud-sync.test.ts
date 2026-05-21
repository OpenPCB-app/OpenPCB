import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  linkDesignToCloud,
  mirrorCommand,
} from "../../../modules/designer/backend/cloud-sync";
import { cloudLink } from "../../../modules/designer/backend/schema";
import type {
  DesignerCommandEnvelope,
  LibraryComponentPlacementDetail,
} from "../../../sdks";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

function makeDb(): { db: DbClient; close: () => void } {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    create table designer_cloud_link (
      design_id text primary key,
      cloud_design_id text not null,
      cloud_workspace_id text not null,
      cloud_user_id text not null,
      last_synced_revision integer not null default -1,
      linked_at text not null,
      failed_attempts integer not null default 0,
      last_error text
    );
  `);
  const db = drizzle(sqlite) as DbClient;
  return { db, close: () => sqlite.close() };
}

function makeLogger(): {
  info: (m: string, x?: unknown) => void;
  warn: (m: string, x?: unknown) => void;
  error: (m: string, x?: unknown) => void;
  events: Array<{ level: string; msg: string; meta?: unknown }>;
} {
  const events: Array<{ level: string; msg: string; meta?: unknown }> = [];
  return {
    info: (msg, meta) => events.push({ level: "info", msg, meta }),
    warn: (msg, meta) => events.push({ level: "warn", msg, meta }),
    error: (msg, meta) => events.push({ level: "error", msg, meta }),
    events,
  };
}

function insertLink(
  db: DbClient,
  overrides: Partial<typeof cloudLink.$inferInsert> = {},
): void {
  db.insert(cloudLink)
    .values({
      designId: "local-1",
      cloudDesignId: "cloud-1",
      cloudWorkspaceId: "ws-1",
      cloudUserId: "user-1",
      lastSyncedRevision: -1,
      linkedAt: new Date().toISOString(),
      failedAttempts: 0,
      lastError: null,
      ...overrides,
    })
    .run();
}

function makeEnvelope(command: {
  type: string;
  [k: string]: unknown;
}): DesignerCommandEnvelope {
  return {
    commandId: "cmd-1",
    sessionId: "sess-1",
    aggregateId: "local-1",
    baseRevision: 0,
    issuedAt: "2026-05-21T12:00:00Z",
    command: command as unknown as DesignerCommandEnvelope["command"],
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit;
  body?: unknown;
}

function stubFetch(
  responses: Array<{ status: number; body: unknown } | Error>,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const bodyText = init?.body ? String(init.body) : undefined;
    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      parsed = bodyText;
    }
    calls.push({ url, init, body: parsed });
    const next = responses[i++];
    if (next instanceof Error) throw next;
    if (!next) throw new Error("no stubbed response");
    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      { status: next.status, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

describe("mirrorCommand", () => {
  let ctx: { db: DbClient; close: () => void };
  beforeEach(() => {
    ctx = makeDb();
  });
  afterEach(() => {
    ctx.close();
  });

  test("no-op when design not linked", async () => {
    const logger = makeLogger();
    const stub = stubFetch([]);
    try {
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({ type: "place_part" }),
        newRevision: 1,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      expect(stub.calls.length).toBe(0);
    } finally {
      stub.restore();
    }
  });

  test("warns and skips when bearer/apiUrl missing", async () => {
    insertLink(ctx.db);
    const logger = makeLogger();
    const stub = stubFetch([]);
    try {
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({ type: "place_part" }),
        newRevision: 1,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: {},
      });
      expect(stub.calls.length).toBe(0);
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    } finally {
      stub.restore();
    }
  });

  test("skips non-schematic command types", async () => {
    insertLink(ctx.db);
    const logger = makeLogger();
    const stub = stubFetch([]);
    try {
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({ type: "set_board_outline" }),
        newRevision: 1,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      expect(stub.calls.length).toBe(0);
      expect(logger.events.some((e) => e.msg.includes("non-schematic"))).toBe(
        true,
      );
    } finally {
      stub.restore();
    }
  });

  test("forwards desktop envelope verbatim with aggregateId remapped", async () => {
    insertLink(ctx.db);
    const logger = makeLogger();
    const stub = stubFetch([{ status: 200, body: { ok: true } }]);
    try {
      const cmd = {
        type: "move_part",
        partId: "p-1",
        positionNm: { x: 1_000_000, y: 2_000_000 },
      };
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope(cmd),
        newRevision: 7,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      expect(stub.calls.length).toBe(1);
      const call = stub.calls[0]!;
      expect(call.url).toBe("https://api.test/v1/designs/cloud-1/commands");
      const body = call.body as {
        aggregateId: string;
        baseRevision: number;
        command: typeof cmd;
      };
      expect(body.aggregateId).toBe("cloud-1");
      expect(body.baseRevision).toBe(6);
      expect(body.command).toEqual(cmd);
    } finally {
      stub.restore();
    }
  });

  test("enriches place_part with resolved.pins from placement detail", async () => {
    insertLink(ctx.db);
    const logger = makeLogger();
    const stub = stubFetch([{ status: 200, body: { ok: true } }]);
    try {
      const placement: LibraryComponentPlacementDetail = {
        symbol: {
          pins: [
            {
              number: "1",
              name: "A",
              localPositionMm: { x: 1.5, y: -2.5 },
            },
            {
              number: "2",
              name: "K",
              localPositionMm: { x: -1.5, y: 0 },
            },
          ],
        },
      } as unknown as LibraryComponentPlacementDetail;
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({
          type: "place_part",
          componentId: "comp-1",
          positionNm: { x: 0, y: 0 },
          rotationDeg: 0,
          mirrored: false,
        }),
        newRevision: 1,
        createdEntityId: "part-1",
        placeComponentDetail: placement,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      const body = stub.calls[0]!.body as {
        command: {
          type: string;
          resolved: {
            pins: Array<{
              id: string;
              localPositionNm: { x: number; y: number };
            }>;
          };
        };
      };
      expect(body.command.type).toBe("place_part");
      expect(body.command.resolved.pins).toHaveLength(2);
      expect(body.command.resolved.pins[0]!.id).toBe("1");
      expect(body.command.resolved.pins[0]!.localPositionNm).toEqual({
        x: 1_500_000,
        y: -2_500_000,
      });
    } finally {
      stub.restore();
    }
  });

  test("updates lastSyncedRevision and clears failedAttempts on 200", async () => {
    insertLink(ctx.db, { failedAttempts: 3, lastError: "prev" });
    const logger = makeLogger();
    const stub = stubFetch([{ status: 200, body: { ok: true } }]);
    try {
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({ type: "upsert_label", text: "X" }),
        newRevision: 5,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      const row = ctx.db
        .select()
        .from(cloudLink)
        .where(eq(cloudLink.designId, "local-1"))
        .get();
      expect(row?.lastSyncedRevision).toBe(5);
      expect(row?.failedAttempts).toBe(0);
      expect(row?.lastError).toBeNull();
    } finally {
      stub.restore();
    }
  });

  test("records error on non-2xx response", async () => {
    insertLink(ctx.db);
    const logger = makeLogger();
    const stub = stubFetch([{ status: 409, body: "stale baseRevision" }]);
    try {
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({ type: "upsert_label", text: "X" }),
        newRevision: 5,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      const row = ctx.db
        .select()
        .from(cloudLink)
        .where(eq(cloudLink.designId, "local-1"))
        .get();
      expect(row?.lastError).toContain("409");
      expect(row?.failedAttempts).toBeGreaterThan(0);
    } finally {
      stub.restore();
    }
  });

  test("records error on network failure", async () => {
    insertLink(ctx.db);
    const logger = makeLogger();
    const stub = stubFetch([new Error("ECONNREFUSED")]);
    try {
      await mirrorCommand(ctx.db, logger, {
        designId: "local-1",
        envelope: makeEnvelope({ type: "upsert_label", text: "X" }),
        newRevision: 5,
        createdEntityId: null,
        placeComponentDetail: null,
        ctx: { cloudBearer: "tok", cloudApiUrl: "https://api.test" },
      });
      const row = ctx.db
        .select()
        .from(cloudLink)
        .where(eq(cloudLink.designId, "local-1"))
        .get();
      expect(row?.lastError).toContain("ECONNREFUSED");
      expect(logger.events.some((e) => e.level === "error")).toBe(true);
    } finally {
      stub.restore();
    }
  });
});

describe("linkDesignToCloud", () => {
  let ctx: { db: DbClient; close: () => void };
  beforeEach(() => {
    ctx = makeDb();
  });
  afterEach(() => {
    ctx.close();
  });

  test("returns existing link without HTTP calls when already linked", async () => {
    insertLink(ctx.db, { cloudDesignId: "cloud-existing" });
    const stub = stubFetch([]);
    try {
      const out = await linkDesignToCloud(ctx.db, {
        designId: "local-1",
        designName: "ignored",
        bearer: "tok",
        apiUrl: "https://api.test",
      });
      expect(out.cloudDesignId).toBe("cloud-existing");
      expect(stub.calls.length).toBe(0);
    } finally {
      stub.restore();
    }
  });

  test("happy path: fetches workspace + user + creates cloud design + persists link", async () => {
    const stub = stubFetch([
      { status: 200, body: { id: "ws-42" } },
      { status: 200, body: { id: "user-42" } },
      { status: 200, body: { id: "cloud-new" } },
    ]);
    try {
      const out = await linkDesignToCloud(ctx.db, {
        designId: "local-1",
        designName: "My Design",
        bearer: "tok",
        apiUrl: "https://api.test",
      });
      expect(out).toEqual({
        cloudDesignId: "cloud-new",
        workspaceId: "ws-42",
        userId: "user-42",
      });
      expect(stub.calls.map((c) => c.url)).toEqual([
        "https://api.test/v1/workspaces/me/personal",
        "https://api.test/v1/me",
        "https://api.test/v1/designs/workspaces/ws-42",
      ]);
      const createBody = stub.calls[2]!.body as { name: string };
      expect(createBody.name).toBe("My Design");

      const row = ctx.db
        .select()
        .from(cloudLink)
        .where(eq(cloudLink.designId, "local-1"))
        .get();
      expect(row?.cloudDesignId).toBe("cloud-new");
      expect(row?.cloudWorkspaceId).toBe("ws-42");
      expect(row?.cloudUserId).toBe("user-42");
      expect(row?.lastSyncedRevision).toBe(-1);
    } finally {
      stub.restore();
    }
  });

  test("existingCloudDesignId path: skips create-design POST", async () => {
    const stub = stubFetch([
      { status: 200, body: { id: "ws-7" } },
      { status: 200, body: { id: "user-7" } },
    ]);
    try {
      const out = await linkDesignToCloud(ctx.db, {
        designId: "local-1",
        designName: "imported",
        bearer: "tok",
        apiUrl: "https://api.test",
        existingCloudDesignId: "cloud-pre",
        lastSyncedRevision: 12,
      });
      expect(out.cloudDesignId).toBe("cloud-pre");
      expect(stub.calls.length).toBe(2);
      expect(stub.calls.map((c) => c.url)).toEqual([
        "https://api.test/v1/workspaces/me/personal",
        "https://api.test/v1/me",
      ]);
      const row = ctx.db
        .select()
        .from(cloudLink)
        .where(eq(cloudLink.designId, "local-1"))
        .get();
      expect(row?.cloudDesignId).toBe("cloud-pre");
      expect(row?.lastSyncedRevision).toBe(12);
    } finally {
      stub.restore();
    }
  });

  test("throws on workspace fetch failure", async () => {
    const stub = stubFetch([{ status: 500, body: "boom" }]);
    try {
      await expect(
        linkDesignToCloud(ctx.db, {
          designId: "local-1",
          designName: "x",
          bearer: "tok",
          apiUrl: "https://api.test",
        }),
      ).rejects.toThrow(/workspace fetch failed/);
    } finally {
      stub.restore();
    }
  });
});
