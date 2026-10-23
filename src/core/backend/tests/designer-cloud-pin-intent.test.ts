import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { CLOUD_PIN_INTENT_UNSUPPORTED } from "../../../modules/designer/backend/cloud-intent-guard";
import { linkDesignToCloud, mirrorCommand, pushCloudSnapshot } from "../../../modules/designer/backend/cloud-sync";
import { replaceSchematicProjection } from "../../../modules/designer/backend/projection-world";
import { cloudLink, designHeads, netIdentityState, schematicPins } from "../../../modules/designer/backend/schema";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { getSharedDb, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore } from "./designer-operation-receipts-harness";
import { envelope } from "./helpers/designer-runtime";
import { ercPart, ercPin, ercProjection } from "./helpers/erc-fixtures";

const oldFetch = globalThis.fetch;
const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
const oldSync = process.env.OPENPCB_FEATURE_CLOUD_SYNC;
let folder: string;
let requests: Array<{ url: string; body: unknown }>;
beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "cloud-pin-intent-"));
  requests = [];
  process.env.OPENPCB_FEATURE_CLOUD_SYNC = "1";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) as unknown });
    return Response.json({ ok: true });
  }) as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = oldFetch;
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  for (const [key, value] of [["OPENPCB_DB_PATH", oldPath], ["OPENPCB_FEATURE_DATASET_CAPTURE", oldCapture], ["OPENPCB_FEATURE_CLOUD_SYNC", oldSync]]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
  await rm(folder, { recursive: true, force: true });
});

async function seed(intent?: string): Promise<string> {
  const store = await openReceiptStore(path.join(folder, "domain.sqlite"));
  const design = await store.createDesign();
  replaceSchematicProjection(getSharedDb(), design.id, ercProjection({
    designId: design.id, revision: 3,
    parts: [ercPart([{ ...ercPin("p", "input"), electricalIntent: intent }])],
  }), new Date().toISOString());
  // Model an existing pre-H08 design. The fresh native row has allocated no
  // identities; production designs never delete this state to enable sync.
  getSharedDb().delete(netIdentityState).where(eq(netIdentityState.designId, design.id)).run();
  return design.id;
}

function legacyCloudDb(): ReturnType<typeof getSharedDb> {
  // These protocol races remain reachable when migration is temporarily busy.
  // Guard reads/writes and acknowledgments still use the real SQLite database.
  return new Proxy(getSharedDb(), {
    get(target, key, receiver) {
      if (key === "transaction") return () => { throw Object.assign(new Error("migration busy"), { code: "SQLITE_BUSY" }); };
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

function link(designId: string): void {
  getSharedDb().insert(cloudLink).values({
    designId, cloudDesignId: "cloud", cloudWorkspaceId: "workspace", cloudUserId: "user",
    linkedAt: new Date().toISOString(), lastSyncedRevision: 1,
  }).run();
}
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const cloud = { bearer: "test", apiUrl: "https://cloud.invalid" };

function setIntent(designId: string): void {
  getSharedDb().update(schematicPins).set({ electricalIntent: "power_source" }).where(eq(schematicPins.designId, designId)).run();
  getSharedDb().update(designHeads).set({ revision: 4 }).where(eq(designHeads.id, designId)).run();
}

function deferFetch(suffix: string): { reached: Promise<void>; release: () => void } {
  let reached!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body ?? "null")) as unknown });
    if (url.endsWith(suffix)) {
      reached();
      await gate;
    }
    const id = url.endsWith("/personal") ? "workspace" : url.endsWith("/me") ? "user" : "cloud";
    return Response.json({ id });
  }) as typeof fetch;
  return { reached: pending, release };
}

function mirror(designId: string): Promise<void> {
  return mirrorCommand(legacyCloudDb(), logger, {
    designId, envelope: envelope(designId, 2, { type: "move_part", partId: "part", positionNm: { x: 0, y: 0 } }),
    newRevision: 3, createdEntityId: null, placeComponentDetail: null,
    ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
  });
}

describe("cloud pin-intent preservation boundary", () => {
  for (const intent of ["no_connect", "power_source", "future_intent", ""]) {
    test(`${JSON.stringify(intent)} refuses link, mirror and snapshot without network or loss`, async () => {
      const id = await seed(intent);
      const db = legacyCloudDb();
      await expect(linkDesignToCloud(db, { designId: id, designName: "Intent", ...cloud }, logger)).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
      expect(db.select().from(cloudLink).all()).toEqual([]);
      link(id);
      await expect(linkDesignToCloud(db, { designId: id, designName: "Intent", ...cloud }, logger)).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
      await mirrorCommand(db, logger, {
        designId: id, envelope: envelope(id, 2, { type: "move_part", partId: "part", positionNm: { x: 0, y: 0 } }),
        newRevision: 3, createdEntityId: null, placeComponentDetail: null,
        ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
      });
      await expect(pushCloudSnapshot(db, id, cloud, logger)).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
      expect(requests).toEqual([]);
      expect(db.select().from(cloudLink).get()).toMatchObject({
        lastSyncedRevision: 1, failedAttempts: 3, lastError: CLOUD_PIN_INTENT_UNSUPPORTED,
      });
      expect(db.select().from(schematicPins).get()!.electricalIntent).toBe(intent);
    });
  }

  test("snapshot still refuses intent when revision already claims synced", async () => {
    const id = await seed("future_intent");
    link(id);
    getSharedDb().update(cloudLink).set({ lastSyncedRevision: 3 }).where(eq(cloudLink.designId, id)).run();
    await expect(pushCloudSnapshot(legacyCloudDb(), id, cloud, logger)).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
    expect(requests).toEqual([]);
  });

  test("clearing last intent reseeds full snapshot and restores revision alignment", async () => {
    const id = await seed("no_connect");
    link(id);
    getSharedDb().update(schematicPins).set({ electricalIntent: null }).where(eq(schematicPins.designId, id)).run();
    await mirrorCommand(legacyCloudDb(), logger, {
      designId: id, envelope: envelope(id, 2, { type: "set_pin_electrical_intent", pinId: "p", intent: null }),
      newRevision: 3, createdEntityId: null, placeComponentDetail: null,
      ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://cloud.invalid/v1/designs/cloud/snapshot");
    expect(requests[0]!.body).toMatchObject({ revision: 3, projection: { parts: [{ pins: [{ id: "p" }] }] } });
    expect(getSharedDb().select().from(cloudLink).get()).toMatchObject({ lastSyncedRevision: 3, failedAttempts: 0, lastError: null });
  });

  for (const existingCloudDesignId of [undefined, "existing-cloud"]) {
    test(`intent added during metadata lookup refuses ${existingCloudDesignId ? "existing" : "new"} link before remote creation`, async () => {
      const id = await seed();
      const fetch = deferFetch("/me");
      const result = linkDesignToCloud(legacyCloudDb(), { designId: id, designName: "Intent", existingCloudDesignId, ...cloud }, logger);
      await fetch.reached;
      setIntent(id);
      fetch.release();
      await expect(result).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
      expect(requests.map((request) => request.url)).toEqual([
        "https://cloud.invalid/v1/workspaces/me/personal", "https://cloud.invalid/v1/me",
      ]);
      expect(getSharedDb().select().from(cloudLink).all()).toEqual([]);
    });
  }

  test("intent added during cloud creation retains shell and prevents seed", async () => {
    const id = await seed();
    const fetch = deferFetch("/designs/workspaces/workspace");
    const result = linkDesignToCloud(legacyCloudDb(), { designId: id, designName: "Intent", ...cloud }, logger);
    await fetch.reached;
    setIntent(id);
    fetch.release();
    await expect(result).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
    expect(requests.some((request) => request.url.endsWith("/seed"))).toBe(false);
    expect(getSharedDb().select().from(cloudLink).get()).toMatchObject({
      cloudDesignId: "cloud", lastSyncedRevision: -1, failedAttempts: 1, lastError: CLOUD_PIN_INTENT_UNSUPPORTED,
    });
  });

  test("intent added during seed keeps historical acknowledgment and visible failure", async () => {
    const id = await seed();
    const fetch = deferFetch("/seed");
    const result = linkDesignToCloud(legacyCloudDb(), { designId: id, designName: "Intent", ...cloud }, logger);
    await fetch.reached;
    const posted = requests.find((request) => request.url.endsWith("/seed"))!.body;
    expect(JSON.stringify(posted)).not.toContain("electricalIntent");
    expect(posted).toMatchObject({ revision: 3 });
    setIntent(id);
    fetch.release();
    await expect(result).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
    expect(getSharedDb().select().from(cloudLink).get()).toMatchObject({
      lastSyncedRevision: 3, failedAttempts: 1, lastError: CLOUD_PIN_INTENT_UNSUPPORTED,
    });
    expect(getSharedDb().select().from(schematicPins).get()!.electricalIntent).toBe("power_source");
  });

  for (const transport of ["snapshot", "mirror"] as const) {
    test(`old ${transport} success cannot clear newer unsupported intent failure`, async () => {
      const id = await seed();
      link(id);
      const fetch = deferFetch(transport === "snapshot" ? "/snapshot" : "/commands");
      const pending = transport === "snapshot" ? pushCloudSnapshot(legacyCloudDb(), id, cloud, logger) : mirror(id);
      await fetch.reached;
      expect(JSON.stringify(requests)).not.toContain("electricalIntent");
      setIntent(id);
      await mirror(id);
      expect(getSharedDb().select().from(cloudLink).get()!.lastError).toBe(CLOUD_PIN_INTENT_UNSUPPORTED);
      fetch.release();
      if (transport === "snapshot") await expect(pending).rejects.toThrow(CLOUD_PIN_INTENT_UNSUPPORTED);
      else await pending;
      expect(requests).toHaveLength(1);
      expect(getSharedDb().select().from(cloudLink).get()).toMatchObject({
        lastSyncedRevision: 3, lastError: CLOUD_PIN_INTENT_UNSUPPORTED,
      });
      expect(getSharedDb().select().from(cloudLink).get()!.failedAttempts).toBeGreaterThan(0);
    });
  }

  test("late acknowledgment cannot move historical synced revision backwards", async () => {
    const id = await seed();
    link(id);
    getSharedDb().update(cloudLink).set({ lastSyncedRevision: 5 }).where(eq(cloudLink.designId, id)).run();
    await mirror(id);
    expect(getSharedDb().select().from(cloudLink).get()!.lastSyncedRevision).toBe(5);
  });

  test("duplicate without intent reseeds snapshot instead of posting unknown command", async () => {
    const id = await seed();
    link(id);
    await mirrorCommand(legacyCloudDb(), logger, {
      designId: id, envelope: envelope(id, 2, {
        type: "duplicate_part", partId: "part", positionNm: { x: 1_000_000, y: 0 },
      }),
      newRevision: 3, createdEntityId: "copy", placeComponentDetail: null,
      ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://cloud.invalid/v1/designs/cloud/snapshot");
    expect(getSharedDb().select().from(cloudLink).get()).toMatchObject({ lastSyncedRevision: 3, failedAttempts: 0, lastError: null });
  });

  test("duplicate batch without intent reseeds snapshot", async () => {
    const id = await seed();
    link(id);
    await mirrorCommand(legacyCloudDb(), logger, {
      designId: id, envelope: envelope(id, 2, { type: "batch_commands", commands: [
        { type: "duplicate_part", partId: "part", positionNm: { x: 1_000_000, y: 0 } },
      ] }),
      newRevision: 3, createdEntityId: "copy", placeComponentDetail: null,
      ctx: { cloudBearer: cloud.bearer, cloudApiUrl: cloud.apiUrl },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://cloud.invalid/v1/designs/cloud/snapshot");
  });
});
