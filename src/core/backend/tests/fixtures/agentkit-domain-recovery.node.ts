import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DomainRecoveryCheckpoint } from "./agentkit-domain-recovery-checkpoint";
import { isolatedHttpDomain, UI_SESSION, type HttpDomain } from "./agentkit-http-domain";

async function assertRecoveredIdentity(domain: HttpDomain, checkpoint: DomainRecoveryCheckpoint): Promise<void> {
  assert.equal(domain.provider.requests.length, 0);
  const proposal = await domain.service.host.store.proposals.get(checkpoint.proposalId);
  assert.equal(proposal?.status, "applied");
  assert.equal(proposal?.operationId, checkpoint.operationId);
  const outcome = await domain.service.host.store.proposals.getOutcome(checkpoint.operationId);
  assert.equal(outcome?.status, "applied", JSON.stringify(outcome));
  assert.equal(outcome?.appliedOps, 1);
  assert.equal(outcome?.revision, "1");
  assert.deepEqual(outcome?.failedOps, []);
  const recovered = JSON.parse(outcome?.resultJson ?? "{}") as {
    designId: string; receipts: Array<{ result: DomainRecoveryCheckpoint["result"] }>;
  };
  assert.equal(recovered.designId, checkpoint.designId);
  assert.deepEqual(recovered.receipts.map((receipt) => receipt.result), [checkpoint.result]);
  const lookup = await domain.designer.getOperationReceipt(checkpoint.envelope.commandId, checkpoint.identity);
  assert.equal(lookup.status, "found");
  if (lookup.status !== "found") throw new Error("Recovered canonical domain receipt missing");
  assert.deepEqual(lookup.receipt.result, checkpoint.result);
  assert.deepEqual(lookup.receipt.command, checkpoint.envelope.command);
  assert.equal((await domain.designer.listOperationReceipts("desktop", checkpoint.operationId)).length, 1);
  const projection = await domain.designer.getSchematicProjection(checkpoint.designId);
  assert.equal(projection?.revision, 1);
  assert.deepEqual(projection?.parts.map((part) => part.id), [checkpoint.result.createdEntityId]);
}

async function assertInterruptedWithoutModel(domain: HttpDomain, checkpoint: DomainRecoveryCheckpoint): Promise<void> {
  const initial = await domain.service.host.store.tasks.getTask(checkpoint.runId);
  assert.equal(initial?.status, "running");
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    assert.equal(domain.provider.requests.length, 0);
    const task = await domain.service.host.store.tasks.getTask(checkpoint.runId);
    if (task?.status === "interrupted") return;
    assert.equal(task?.status, "running");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Crashed native run did not become interrupted after lease expiry within 45000 ms");
}

async function assertReplayAndUndo(domain: HttpDomain, checkpoint: DomainRecoveryCheckpoint): Promise<void> {
  const projection = await domain.designer.getSchematicProjection(checkpoint.designId);
  const replay = await domain.request(`/v1/proposals/${checkpoint.proposalId}/apply`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId: checkpoint.operationId }),
  });
  assert.equal(replay.status, 200, await replay.text());
  assert.deepEqual(await domain.designer.getSchematicProjection(checkpoint.designId), projection);
  assert.equal((await domain.designer.listOperationReceipts("desktop", checkpoint.operationId)).length, 1);
  assert.equal(domain.provider.requests.length, 0);
  assert.equal((await domain.designer.getHistory(checkpoint.designId, UI_SESSION)).undoDepth, 1);
  assert.equal((await domain.designer.undo(checkpoint.designId, UI_SESSION)).ok, true);
  assert.equal((await domain.designer.getSchematicProjection(checkpoint.designId))?.parts.length, 0);
  assert.equal((await domain.designer.getSchematicProjection(checkpoint.designId))?.revision, 2);
  assert.equal((await domain.designer.redo(checkpoint.designId, UI_SESSION)).ok, true);
  assert.deepEqual((await domain.designer.getSchematicProjection(checkpoint.designId))?.parts.map((part) => part.id), [checkpoint.result.createdEntityId]);
  assert.equal((await domain.designer.getSchematicProjection(checkpoint.designId))?.revision, 3);
  assert.equal(domain.provider.requests.length, 0);
}

test("authenticated native write recovers after domain commit without model rerun or duplicate edit", async () => {
  const checkpointDirectory = await mkdtemp(path.join(os.tmpdir(), "openpcb-native-crash-checkpoint-"));
  const checkpointPath = path.join(checkpointDirectory, "checkpoint.json");
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "agentkit-domain-recovery-crash.node.mjs");
  let domain: HttpDomain | undefined;
  let domainDirectory: string | undefined;
  try {
    const child = spawnSync(process.execPath, [fixture], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15000,
      env: { ...process.env, OPENPCB_NATIVE_CRASH_CHECKPOINT: checkpointPath },
    });
    const saved = await readFile(checkpointPath, "utf8").catch(() => null);
    const checkpoint = saved ? JSON.parse(saved) as DomainRecoveryCheckpoint : null;
    domainDirectory = checkpoint?.directory;
    assert.equal(child.status, 73, child.stdout + child.stderr);
    assert.ok(checkpoint);
    assert.equal(checkpoint.modelRequests, 1);
    assert.equal(checkpoint.proposalStatusBeforeExit, "applying");
    assert.equal(checkpoint.outcomeBeforeExit, null);
    assert.equal(checkpoint.result.revision, 1);
    assert.ok(checkpoint.result.createdEntityId);

    domain = await isolatedHttpDomain([], false, { existingDirectory: checkpoint.directory, preserveDirectory: true });
    await assertRecoveredIdentity(domain, checkpoint);
    await assertInterruptedWithoutModel(domain, checkpoint);
    await assertReplayAndUndo(domain, checkpoint);
  } finally {
    await domain?.close();
    if (domainDirectory) await rm(domainDirectory, { recursive: true, force: true });
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});
