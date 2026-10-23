import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CLOUD_NET_IDENTITY_UNSUPPORTED, CLOUD_PIN_INTENT_UNSUPPORTED, compatibilityError } from "../../../modules/designer/backend/cloud-intent-guard";
import { linkDesignToCloud, mirrorCommand, pushCloudSnapshot } from "../../../modules/designer/backend/cloud-sync";
import { cloudLink, designHeads, netIdentityState, netIdentityRetired, schematicParts, schematicPins,
  schematicWires, schematicLabels, schematicPrimitives } from "../../../modules/designer/backend/schema";
import { envelope } from "./helpers/designer-runtime";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
const TS = "2026-10-22T00:00:00.000Z";
const cloud = { bearer: "test", apiUrl: "https://cloud.invalid" };
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const oldFetch = globalThis.fetch, oldSync = process.env.OPENPCB_FEATURE_CLOUD_SYNC;
let sqlite: Database, db: DbClient;
let requests: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  for (const table of [cloudLink, designHeads, netIdentityState, netIdentityRetired, schematicParts,
    schematicPins, schematicWires, schematicLabels, schematicPrimitives]) {
    const columns = Object.values(getTableColumns(table)).map((column) => `"${column.name}" ${column.getSQLType()}`);
    sqlite.exec(`CREATE TABLE "${getTableName(table)}" (${columns.join(", ")})`);
  }
  const rawDb = drizzle(sqlite) as unknown as DbClient;
  // Protocol-only pre-H08 fixture: a busy migration admits legacy requests.
  // The full-schema cloud-ensure suite separately proves real migration gates.
  db = new Proxy(rawDb, {
    get(target, key, receiver) {
      if (key === "transaction") return () => { throw Object.assign(new Error("migration busy"), { code: "SQLITE_BUSY" }); };
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  db.insert(designHeads).values({ id: "local", name: "Local", revision: 3, createdAt: TS, updatedAt: TS }).run();
  requests = [];
  process.env.OPENPCB_FEATURE_CLOUD_SYNC = "1";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) as unknown });
    return Response.json({ id: responseId(String(input)) });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  if (oldSync === undefined) delete process.env.OPENPCB_FEATURE_CLOUD_SYNC;
  else process.env.OPENPCB_FEATURE_CLOUD_SYNC = oldSync;
  sqlite.close();
});

function responseId(url: string): string {
  return url.endsWith("/personal") ? "workspace" : url.endsWith("/me") ? "user" : "remote";
}
function link(lastSyncedRevision = 1): void {
  db.insert(cloudLink).values({ designId: "local", cloudDesignId: "remote", cloudWorkspaceId: "workspace",
    cloudUserId: "user", linkedAt: TS, lastSyncedRevision, failedAttempts: 0, lastError: null }).run();
}
function state(status = "active", activeJson = "[]", designId = "local"): void {
  db.insert(netIdentityState).values({ designId, schemaVersion: 1, status, nextSeq: 40, activeJson,
    provenanceJson: "{}", lastError: status === "migration_failed" ? "failed migration" : null, updatedAt: TS }).run();
}
function retired(designId = "local"): void {
  db.insert(netIdentityRetired).values({ designId, netId: "net:abcdefghij:39", seq: 39, reason: "history",
    successorIdsJson: "[]", displayName: null, retiredAtRevision: 2, createdAt: TS, updatedAt: TS }).run();
}
function introduceState(): void {
  state();
  db.update(designHeads).set({ revision: 9 }).where(eq(designHeads.id, "local")).run();
}
function mirror(): Promise<void> {
  return mirrorCommand(db, logger, {
    designId: "local", envelope: envelope("local", 2, { type: "move_part", partId: "part", positionNm: { x: 0, y: 0 } }),
    newRevision: 3, createdEntityId: null, placeComponentDetail: null,
    ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
  });
}
function deferFetch(suffix: string): { reached: Promise<void>; release: () => void } {
  let reached!: () => void, release!: () => void;
  const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body ?? "null")) as unknown });
    if (url.endsWith(suffix)) { reached(); await gate; }
    return Response.json({ id: responseId(url) });
  }) as typeof fetch;
  return { reached: reachedPromise, release };
}

describe("cloud durable identity preservation boundary", () => {
  for (const [label, prepare] of [
    ["empty active records", () => state()],
    ["failed migration watermark", () => state("migration_failed")],
    ["restored legacy watermark", () => state("legacy_restored")],
    ["corrupt state", () => state("unknown", "{invalid JSON")],
    ["retired ledger without state", () => retired()],
  ] as const) test(`${label}: link, existing link, mirror and snapshot send nothing`, async () => {
    prepare();
    const before = db.select().from(netIdentityState).all();
    await expect(linkDesignToCloud(db, { designId: "local", designName: "Local", ...cloud }, logger)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(db.select().from(cloudLink).all()).toEqual([]);
    link();
    await expect(linkDesignToCloud(db, { designId: "local", designName: "Local", ...cloud }, logger)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    await mirror();
    await expect(pushCloudSnapshot(db, "local", cloud, logger)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(requests).toEqual([]);
    expect(db.select().from(cloudLink).get()).toMatchObject({
      lastSyncedRevision: 1, failedAttempts: 3, lastError: CLOUD_NET_IDENTITY_UNSUPPORTED,
    });
    expect(db.select().from(netIdentityState).all()).toEqual(before);
    if (label === "retired ledger without state") expect(db.select().from(netIdentityRetired).all()).toHaveLength(1);
  });

  test("already-synced revision cannot bypass identity guard", async () => {
    state(); link(3);
    await expect(pushCloudSnapshot(db, "local", cloud, logger)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(requests).toEqual([]);
  });

  test("pin-intent error has deterministic priority over identity error", async () => {
    state(); link();
    sqlite.query("INSERT INTO designer_schematic_pins (id, design_id, electrical_intent) VALUES (?, ?, ?)").run("pin", "local", "future_intent");
    expect(compatibilityError(db, "local")).toBe(CLOUD_PIN_INTENT_UNSUPPORTED);
    await expect(pushCloudSnapshot(db, "local", cloud, logger)).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
    expect(db.select().from(cloudLink).get()!.lastError).toBe(CLOUD_PIN_INTENT_UNSUPPORTED);
    expect(requests).toEqual([]);
  });

  test("another design's state and ledger do not block a compatible legacy design", async () => {
    state("active", "[]", "other"); retired("other"); link();
    await mirror();
    expect(requests).toHaveLength(1);
    expect(db.select().from(cloudLink).get()).toMatchObject({ lastSyncedRevision: 3, failedAttempts: 0, lastError: null });
  });

  test("missing actual identity tables fail visibly instead of being treated as no state", async () => {
    link(); sqlite.exec("DROP TABLE designer_net_identity_state");
    await expect(linkDesignToCloud(db, { designId: "local", designName: "Local", ...cloud }, logger)).rejects.toThrow("no such table");
    await expect(mirror()).rejects.toThrow("no such table");
    await expect(pushCloudSnapshot(db, "local", cloud, logger)).rejects.toThrow("no such table");
    expect(requests).toEqual([]);
  });

  for (const suffix of ["/personal", "/me"]) test(`identity appearing during ${suffix} stops before remote creation`, async () => {
    const fetch = deferFetch(suffix);
    const pending = linkDesignToCloud(db, { designId: "local", designName: "Local", ...cloud }, logger);
    await fetch.reached; introduceState(); fetch.release();
    await expect(pending).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(requests.every((request) => request.body === null)).toBe(true);
    expect(db.select().from(cloudLink).all()).toEqual([]);
  });

  test("identity appearing during remote creation keeps recoverable shell and prevents seed", async () => {
    const fetch = deferFetch("/designs/workspaces/workspace");
    const pending = linkDesignToCloud(db, { designId: "local", designName: "Local", ...cloud }, logger);
    await fetch.reached; introduceState(); fetch.release();
    await expect(pending).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(requests).toHaveLength(3);
    expect(requests.some((request) => request.url.endsWith("/seed"))).toBe(false);
    expect(db.select().from(cloudLink).get()).toMatchObject({
      cloudDesignId: "remote", lastSyncedRevision: -1, failedAttempts: 1, lastError: CLOUD_NET_IDENTITY_UNSUPPORTED,
    });
  });

  test("identity appearing during seed retains only historical acknowledgment", async () => {
    const fetch = deferFetch("/seed");
    const pending = linkDesignToCloud(db, { designId: "local", designName: "Local", ...cloud }, logger);
    await fetch.reached;
    expect(requests.at(-1)!.body).toMatchObject({ revision: 3 });
    introduceState(); fetch.release();
    await expect(pending).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(db.select().from(cloudLink).get()).toMatchObject({
      lastSyncedRevision: 3, failedAttempts: 1, lastError: CLOUD_NET_IDENTITY_UNSUPPORTED,
    });
    expect(db.select().from(designHeads).get()!.revision).toBe(9);
  });

  for (const transport of ["snapshot", "mirror"] as const) test(`late ${transport} acknowledgment cannot clear new guard`, async () => {
    link();
    const fetch = deferFetch(transport === "snapshot" ? "/snapshot" : "/commands");
    const pending = transport === "snapshot" ? pushCloudSnapshot(db, "local", cloud, logger) : mirror();
    await fetch.reached; introduceState();
    await mirror();
    expect(db.select().from(cloudLink).get()!.lastError).toBe(CLOUD_NET_IDENTITY_UNSUPPORTED);
    fetch.release();
    if (transport === "snapshot") await expect(pending).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    else await pending;
    expect(requests).toHaveLength(1);
    expect(db.select().from(cloudLink).get()).toMatchObject({
      lastSyncedRevision: 3, failedAttempts: 2, lastError: CLOUD_NET_IDENTITY_UNSUPPORTED,
    });
  });

  test("conflict makes one request and never retries through snapshot", async () => {
    link();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push({ url: String(input), body: null });
      return new Response("diverged", { status: 409 });
    }) as typeof fetch;
    await mirror();
    expect(requests.map((request) => request.url)).toEqual(["https://cloud.invalid/v1/designs/remote/commands"]);
    expect(db.select().from(cloudLink).get()).toMatchObject({ lastSyncedRevision: 1, failedAttempts: 1 });
    expect(db.select().from(cloudLink).get()!.lastError).toContain("REVISION_CONFLICT");
  });
});
