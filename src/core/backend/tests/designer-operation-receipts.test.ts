import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { DesignerOperationIdentity } from "../../../sdks/designer";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { openReceiptStore, receiptEnvelope, receiptIdentity } from "./designer-operation-receipts-harness";

let folder: string;
let file: string;
const oldPath = process.env.OPENPCB_DB_PATH;
const oldCapture = process.env.OPENPCB_FEATURE_DATASET_CAPTURE;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "designer-receipts-"));
  file = path.join(folder, "domain.sqlite");
});

afterEach(async () => {
  resetCaptureRuntimeForTesting();
  resetSharedSqliteForTesting();
  if (oldPath === undefined) delete process.env.OPENPCB_DB_PATH;
  else process.env.OPENPCB_DB_PATH = oldPath;
  if (oldCapture === undefined) delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  else process.env.OPENPCB_FEATURE_DATASET_CAPTURE = oldCapture;
  await rm(folder, { recursive: true, force: true });
});

describe("designer domain operation receipts", () => {
  test("legacy command replay preserves idempotent result and one undo entry", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const envelope = receiptEnvelope(design.id);
    const first = await store.dispatchCommand(design.id, envelope);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.code);
    expect(await store.dispatchCommand(design.id, envelope)).toEqual({ ...first, idempotent: true });
    expect((await store.getHistory(design.id, envelope.sessionId)).undoDepth).toBe(1);
  });

  test("protected edit requires nonnegative revision and bounded identity; command key order is canonical", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const envelope = receiptEnvelope(design.id);
    const identity = receiptIdentity(envelope);
    const first = await store.dispatchOperation(design.id, envelope, identity);
    const reordered = { ...envelope, command: {
      drillMm: 1, centerMm: { y: 4, x: 3 }, type: "pcb_add_free_hole" as const,
    } };
    expect(await store.dispatchOperation(design.id, reordered, identity)).toEqual(first);
    for (const expectedRevision of [null, -1, 0.5]) {
      const next = { ...envelope, commandId: "invalid", baseRevision: expectedRevision };
      expect(await store.dispatchOperation(design.id, next, { ...identity, expectedRevision })).toEqual({
        ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: "invalid",
      });
    }
    expect((await store.dispatchOperation(design.id, envelope, { ...identity, actorScope: "x".repeat(513) })).ok).toBe(false);
  });

  test("design creation and receipt commit atomically, replay original ID after restart, reject identity or input reuse", async () => {
    let store = await openReceiptStore(file);
    const identity = { ...receiptIdentity(receiptEnvelope("new-design")), actionId: "create-unit", expectedRevision: null };
    const input = { name: "Created once" };
    const first = await store.createDesignOperation(input, identity);
    expect(first.ok).toBe(true);
    expect(await store.createDesignOperation(input, identity)).toEqual(first);
    expect(await store.createDesignOperation({ name: "Changed" }, identity)).toEqual({
      ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: "create-unit",
    });
    for (const patch of [{ actorScope: "other" }, { designId: "other" }, { expectedRevision: 1 }]) {
      expect((await store.createDesignOperation(input, { ...identity, ...patch })).ok).toBe(false);
    }
    store = await openReceiptStore(file);
    expect(await store.createDesignOperation(input, identity)).toEqual(first);
    expect((await store.getDesignCreationReceipt(identity)).status).toBe("found");
    expect(await store.listDesignCreationReceipts(identity.actorScope, identity.operationId)).toHaveLength(1);
    expect(await store.listDesignCreationReceipts("other", identity.operationId)).toHaveLength(0);
    expect(await store.listDesigns()).toHaveLength(1);
    expect((await store.getHistory(identity.designId, "receipt-session")).undoDepth).toBe(0);
    const otherActor = { ...identity, actorScope: "other", designId: "other-design" };
    expect((await store.createDesignOperation(input, otherActor)).ok).toBe(true);
    expect((await store.getDesignCreationReceipt(otherActor)).status).toBe("found");
    expect(await store.listDesigns()).toHaveLength(2);
  });

  test("creation receipt failure rolls back new design and board", async () => {
    const store = await openReceiptStore(file);
    const identity = { ...receiptIdentity(receiptEnvelope("new-design")), actionId: "create-unit", expectedRevision: null };
    getSharedSqlite().exec("CREATE TRIGGER deny_creation BEFORE INSERT ON designer_design_creation_receipts BEGIN SELECT RAISE(ABORT, 'creation-receipt-fault'); END;");
    await expect(store.createDesignOperation({}, identity)).rejects.toThrow("creation-receipt-fault");
    expect(await store.listDesigns()).toHaveLength(0);
    expect((await store.getDesignCreationReceipt(identity)).status).toBe("missing");
    expect(getSharedSqlite().query<{ count: number }>("SELECT count(*) AS count FROM designer_pcb_entities").get()?.count).toBe(0);
  });

  test("exact replay precedes stale revision checks; restart restores canonical result and real undo", async () => {
    let store = await openReceiptStore(file);
    const design = await store.createDesign();
    const envelope = receiptEnvelope(design.id);
    const identity = receiptIdentity(envelope);
    const first = await store.dispatchOperation(design.id, envelope, identity);
    expect(first.ok).toBe(true);
    expect(await store.dispatchOperation(design.id, envelope, identity)).toEqual(first);
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(1);
    expect((await store.getHistory(design.id, envelope.sessionId)).undoDepth).toBe(1);

    store = await openReceiptStore(file);
    const lookup = await store.getOperationReceipt(envelope.commandId, identity);
    expect(lookup.status).toBe("found");
    if (lookup.status === "found") expect(lookup.receipt.result).toEqual(first);
    expect(await store.dispatchOperation(design.id, envelope, identity)).toEqual(first);
    expect((await store.undo(design.id, envelope.sessionId)).ok).toBe(true);
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);
    store = await openReceiptStore(file);
    expect((await store.getHistory(design.id, envelope.sessionId)).redoDepth).toBe(1);
    expect((await store.redo(design.id, envelope.sessionId)).ok).toBe(true);
    expect((await store.getPcbProjection(design.id))?.freeHoles?.[0]?.id ?? null).toEqual(first.ok ? first.createdEntityId : null);
  });

  test("actor, target, action, tool, fingerprint, revision and command reuse conflict without mutation", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const other = await store.createDesign();
    const envelope = receiptEnvelope(design.id);
    const identity = receiptIdentity(envelope);
    await store.dispatchOperation(design.id, envelope, identity);
    const altered: Partial<DesignerOperationIdentity>[] = [
      { actorScope: "local:other" }, { operationId: "other" }, { actionId: "other" },
      { toolName: "other" }, { argumentFingerprint: "other" }, { expectedRevision: 1 },
      { designId: other.id },
    ];
    for (const patch of altered) {
      expect(await store.dispatchOperation(design.id, envelope, { ...identity, ...patch })).toEqual({
        ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: envelope.commandId,
      });
      expect((await store.getOperationReceipt(envelope.commandId, { ...identity, ...patch })).status).toBe("conflict");
    }
    expect((await store.dispatchOperation(design.id, {
      ...envelope, command: { ...envelope.command, drillMm: 2 },
    } as typeof envelope, identity)).ok).toBe(false);
    expect((await store.dispatchCommand(design.id, envelope)).ok).toBe(false);
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(1);
    expect((await store.getPcbProjection(design.id))?.revision).toBe(1);
  });

  test("fresh stale unit persists original refusal; operation listing isolates actor scope", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const first = receiptEnvelope(design.id);
    await store.dispatchOperation(design.id, first, receiptIdentity(first));
    const stale = receiptEnvelope(design.id, "unit-2");
    const refusal = await store.dispatchOperation(design.id, stale, receiptIdentity(stale));
    expect(refusal).toEqual({ ok: false, code: "REVISION_CONFLICT", conflict: { expected: 0, actual: 1 } });
    expect(await store.dispatchOperation(design.id, stale, receiptIdentity(stale))).toEqual(refusal);
    expect(await store.listOperationReceipts("local:chat-1", "operation-1")).toHaveLength(2);
    expect(await store.listOperationReceipts("local:other", "operation-1")).toHaveLength(0);
    expect((await store.getOperationReceipt("unknown", receiptIdentity(first))).status).toBe("missing");
  });

  test("history write failure rolls back geometry, receipt, revision and in-memory history", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const envelope = receiptEnvelope(design.id);
    getSharedSqlite().exec("CREATE TRIGGER deny_history BEFORE INSERT ON designer_session_histories BEGIN SELECT RAISE(ABORT, 'receipt-history-fault'); END;");
    expect((await store.dispatchOperation(design.id, envelope, receiptIdentity(envelope))).ok).toBe(false);
    expect((await store.getOperationReceipt(envelope.commandId, receiptIdentity(envelope))).status).toBe("missing");
    expect((await store.getPcbProjection(design.id))?.revision).toBe(0);
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);
    expect((await store.getHistory(design.id, envelope.sessionId)).undoDepth).toBe(0);
    getSharedSqlite().exec("DROP TRIGGER deny_history;");
    expect((await store.dispatchOperation(design.id, envelope, receiptIdentity(envelope))).ok).toBe(true);
  });

  test("undo and redo history persistence failures roll back geometry and both stacks", async () => {
    const store = await openReceiptStore(file);
    const design = await store.createDesign();
    const envelope = receiptEnvelope(design.id);
    await store.dispatchOperation(design.id, envelope, receiptIdentity(envelope));
    const deny = (): void => { getSharedSqlite().exec("CREATE TRIGGER deny_history BEFORE INSERT ON designer_session_histories BEGIN SELECT RAISE(ABORT, 'history-replay-fault'); END;"); };
    deny();
    await expect(store.undo(design.id, envelope.sessionId)).rejects.toThrow("history-replay-fault");
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(1);
    expect((await store.getHistory(design.id, envelope.sessionId)).undoDepth).toBe(1);
    expect((await store.getPcbProjection(design.id))?.revision).toBe(1);
    getSharedSqlite().exec("DROP TRIGGER deny_history;");
    await store.undo(design.id, envelope.sessionId);
    deny();
    await expect(store.redo(design.id, envelope.sessionId)).rejects.toThrow("history-replay-fault");
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);
    expect((await store.getHistory(design.id, envelope.sessionId)).redoDepth).toBe(1);
    expect((await store.getPcbProjection(design.id))?.revision).toBe(2);
  });

  test("hard exit after SQLite commit before publication recovers outcome and undo on reopen", async () => {
    let store = await openReceiptStore(file);
    const design = await store.createDesign();
    resetSharedSqliteForTesting();
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "designer-operation-receipts-crash.fixture.ts")], {
      env: { ...process.env, OPENPCB_RECEIPT_CRASH_DB: file, OPENPCB_RECEIPT_CRASH_DESIGN: design.id },
      stdout: "pipe", stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ exit, stdout, stderr }).toEqual({ exit: 73, stdout: "", stderr: "" });
    store = await openReceiptStore(file);
    const envelope = receiptEnvelope(design.id);
    expect((await store.getOperationReceipt(envelope.commandId, receiptIdentity(envelope))).status).toBe("found");
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(1);
    expect((await store.getHistory(design.id, envelope.sessionId)).undoDepth).toBe(1);
    await store.undo(design.id, envelope.sessionId);
    expect((await store.getPcbProjection(design.id))?.freeHoles).toHaveLength(0);
  });

  test("hard exit after design creation recovers original creation receipt", async () => {
    await openReceiptStore(file);
    resetSharedSqliteForTesting();
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "designer-operation-receipts-crash.fixture.ts")], {
      env: { ...process.env, OPENPCB_RECEIPT_CRASH_DB: file,
        OPENPCB_RECEIPT_CRASH_DESIGN: "crash-created", OPENPCB_RECEIPT_CRASH_CREATE: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ exit, stdout, stderr }).toEqual({ exit: 73, stdout: "", stderr: "" });
    const store = await openReceiptStore(file);
    const identity = { ...receiptIdentity(receiptEnvelope("crash-created")), actionId: "create-unit", expectedRevision: null };
    const lookup = await store.getDesignCreationReceipt(identity);
    expect(lookup.status).toBe("found");
    if (lookup.status === "found") {
      expect(await store.createDesignOperation({ name: "Recovered design" }, identity)).toEqual({ ok: true, design: lookup.receipt.design });
    }
    expect(await store.listDesigns()).toHaveLength(1);
  });
});
