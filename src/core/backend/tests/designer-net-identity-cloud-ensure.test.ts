import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { CLOUD_NET_IDENTITY_UNSUPPORTED } from "../../../modules/designer/backend/cloud-intent-guard";
import { linkDesignToCloud, pushCloudSnapshot } from "../../../modules/designer/backend/cloud-sync";
import { insertDesign } from "../../../modules/designer/backend/design-initialization";
import { readNetIdentityState, readRawNetIdentityState, writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { isDurableNetIdOf, NET_IDENTITY_MIGRATOR_VERSION } from "../../../modules/designer/backend/net-identity/types";
import { cloudLink, designHeads, netIdentityState, schematicPins } from "../../../modules/designer/backend/schema";
import { migrationFixture, MIGRATION_TS, type MigrationFixture } from "./helpers/net-identity-migration-fixture";

const cloud = { bearer: "test", apiUrl: "https://cloud.invalid" };
const oldFetch = globalThis.fetch;
let fixture: MigrationFixture;
let requests: string[], warnings: unknown[], errors: unknown[];
const logger = {
  warn: (message: string, meta?: unknown) => { warnings.push({ message, meta }); },
  error: (message: string, meta?: unknown) => { errors.push({ message, meta }); },
};

beforeEach(() => {
  // Actual production migrations and frozen raw legacy rows; no ensure fault
  // injection or schema omissions can bypass the real preservation boundary.
  fixture = migrationFixture();
  // Isolate the identity error: the frozen topology also contains pin intent,
  // which intentionally takes precedence and is covered by its own suite.
  fixture.db.update(schematicPins).set({ electricalIntent: null })
    .where(eq(schematicPins.designId, fixture.designId)).run();
  requests = []; warnings = []; errors = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    requests.push(String(input));
    throw new Error("cloud preservation must reject before fetch");
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = oldFetch; fixture.sqlite.close(); });

function link(designId: string, lastSyncedRevision: number): void {
  fixture.db.insert(cloudLink).values({ designId, cloudDesignId: "remote", cloudWorkspaceId: "workspace",
    cloudUserId: "user", linkedAt: MIGRATION_TS, lastSyncedRevision, failedAttempts: 0, lastError: null }).run();
}
function linkCloud(designId: string): Promise<unknown> {
  return linkDesignToCloud(fixture.db, { designId, designName: "Cloud copy", ...cloud }, logger);
}
function snapshot(designId: string): Promise<unknown> {
  return pushCloudSnapshot(fixture.db, designId, cloud, logger);
}

describe("cloud writes ensure identity before compatibility or revision shortcuts", () => {
  for (const transport of ["new link", "existing link", "snapshot", "matching snapshot"] as const) {
    test(`uninitialized real legacy design migrates before ${transport} rejects without fetch`, async () => {
      const { db, designId } = fixture;
      const before = db.select().from(designHeads).where(eq(designHeads.id, designId)).get()!.revision;
      expect(readRawNetIdentityState(db, designId)).toBeNull();
      if (transport !== "new link") link(designId, before + (transport === "matching snapshot" ? 1 : 0));
      const action = transport.endsWith("link") ? linkCloud : snapshot;
      await expect(action(designId)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
      const state = readNetIdentityState(db, designId)!;
      expect(state.status).toBe("active");
      expect(state.active.length).toBeGreaterThan(0);
      expect(state.active.every((net) => isDurableNetIdOf(net.id, designId))).toBe(true);
      expect(state.nextSeq).toBeGreaterThan(1);
      expect(db.select().from(designHeads).where(eq(designHeads.id, designId)).get()!.revision).toBe(before + 1);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
      if (transport === "new link") expect(db.select().from(cloudLink).all()).toEqual([]);
      else expect(db.select().from(cloudLink).get()).toMatchObject({
        lastSyncedRevision: before + (transport === "matching snapshot" ? 1 : 0),
        failedAttempts: 1, lastError: CLOUD_NET_IDENTITY_UNSUPPORTED,
      });
    });
  }

  for (const transport of ["link", "snapshot"] as const) test(`empty native design is blocked before ${transport}`, async () => {
    const id = "empty-native";
    insertDesign(fixture.db, { name: "Native" }, id, MIGRATION_TS);
    const before = readRawNetIdentityState(fixture.db, id)!;
    expect(before.activeJson).toBe("[]");
    expect(before.nextSeq).toBe(1);
    if (transport === "snapshot") link(id, 0);
    await expect((transport === "link" ? linkCloud : snapshot)(id)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(readRawNetIdentityState(fixture.db, id)).toEqual(before);
    expect(requests).toEqual([]);
    expect(fixture.db.select().from(designHeads).where(eq(designHeads.id, id)).get()!.revision).toBe(0);
  });

  for (const status of ["migration_failed", "legacy_restored"] as const) test(`${status} watermark remains blocked and untouched`, async () => {
    const { db, designId } = fixture;
    writeNetIdentityState(db, { designId, schemaVersion: 1, status, nextSeq: 50, active: [],
      provenance: { origin: "legacy-migration", createdAt: MIGRATION_TS, migratorVersion: NET_IDENTITY_MIGRATOR_VERSION },
      lastError: status === "migration_failed" ? "derive: previous failure" : null, updatedAt: MIGRATION_TS });
    link(designId, 0);
    const before = readRawNetIdentityState(db, designId);
    await expect(linkCloud(designId)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    await expect(snapshot(designId)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(readRawNetIdentityState(db, designId)).toEqual(before);
    expect(requests).toEqual([]);
    expect(db.select().from(cloudLink).get()).toMatchObject({ failedAttempts: 2, lastSyncedRevision: 0, lastError: CLOUD_NET_IDENTITY_UNSUPPORTED });
  });

  test("corrupt raw state is retained and caller logger receives ensure failure", async () => {
    const { db, designId } = fixture;
    db.insert(netIdentityState).values({ designId, schemaVersion: 99, status: "future-status", nextSeq: 88,
      activeJson: "{invalid JSON", provenanceJson: "{}", lastError: "keep", updatedAt: MIGRATION_TS }).run();
    link(designId, 0);
    const before = readRawNetIdentityState(db, designId);
    await expect(linkCloud(designId)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    await expect(snapshot(designId)).rejects.toThrow(CLOUD_NET_IDENTITY_UNSUPPORTED);
    expect(readRawNetIdentityState(db, designId)).toEqual(before);
    expect(warnings).toHaveLength(2);
    expect(requests).toEqual([]);
  });
});
