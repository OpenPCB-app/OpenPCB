import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { MentionRegistry } from "../mentions";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const SESSION = "designer-pcb-session";
const BASE = "http://localhost/api/modules/designer";

async function createRuntime() {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: repoRoot,
  });
  await moduleRuntime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  return { moduleRuntime, server, sdk };
}

function traceOp(opId: string, netId: string, netClassId: string, y: number) {
  return {
    id: opId,
    kind: "add_trace",
    title: opId,
    summary: opId,
    riskLevel: "safe",
    sources: [],
    warnings: [],
    payload: {
      type: "pcb_add_trace",
      layer: "F.Cu",
      pointsNm: [
        { x: 0, y },
        { x: 5_000_000, y },
      ],
      widthMm: 0.25,
      netId,
      netClassId,
      segmentMode: "manhattan-90",
    },
  };
}

interface CopperRow {
  geometry_id: string;
  net_id: string | null;
  job_id: string;
  status: string;
  touches_json: string;
}

function copperRows(): CopperRow[] {
  return getSharedSqlite()
    .query<CopperRow>(
      "SELECT geometry_id, net_id, job_id, status, touches_json FROM designer_capture_auto_copper ORDER BY net_id",
    )
    .all();
}

async function applyFakeCandidate(
  server: { fetch(req: Request): Promise<Response> | Response },
  designId: string,
  netClassId: string,
): Promise<void> {
  const response = await server.fetch(
    new Request(`${BASE}/designs/${designId}/autoroute/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION,
        jobId: "job-1",
        appliedCandidateId: "cand-1",
        resultSummary: {
          determinism: { snapshotHash: "snap-h", engineVersion: "0.8.1" },
        },
        operations: [
          traceOp("op-1", "net1", netClassId, 0),
          traceOp("op-2", "net2", netClassId, 2_000_000),
          traceOp("op-3", "net3", netClassId, 4_000_000),
        ],
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data?: { appliedCount?: number } };
  expect(body.data?.appliedCount).toBe(3);
}

async function history(
  server: { fetch(req: Request): Promise<Response> | Response },
  designId: string,
  action: "undo" | "redo",
): Promise<void> {
  // HTTP history requires the revision the caller saw (OPENPCB-103).
  const head = (await (
    await server.fetch(new Request(`${BASE}/designs/${designId}/recovery-head`))
  ).json()) as { data: { head: { headRevision: number } } };
  const response = await server.fetch(
    new Request(`${BASE}/designs/${designId}/history/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION,
        expectedRevision: head.data.head.headRevision,
      }),
    }),
  );
  expect(response.status).toBe(200);
}

function envelope(
  designId: string,
  commandId: string,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

afterEach(() => {
  resetCaptureRuntimeForTesting();
  delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  delete process.env.OPENPCB_CAPTURE_DIR;
});

function setupEnv(label: string): void {
  MentionRegistry.init();
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  process.env.OPENPCB_CAPTURE_DIR = mkdtempSync(path.join(os.tmpdir(), `${label}-cap-`));
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "1";
  resetCaptureRuntimeForTesting();
}

describe("AutoCopperRegistry", () => {
  test("apply registers geometry↔net under job/candidate; touches update status", async () => {
    setupEnv("capture-registry");
    const { server, sdk } = await createRuntime();
    const design = await sdk.createDesign({ name: "Registry" });
    const proj = await sdk.getPcbProjection(design.id);
    const netClassId = proj!.board.netClasses[0]!.id;

    await applyFakeCandidate(server, design.id, netClassId);

    let rows = copperRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.net_id)).toEqual(["net1", "net2", "net3"]);
    expect(rows.every((r) => r.job_id === "job-1" && r.status === "active")).toBe(true);

    const jobs = getSharedSqlite()
      .query<{ job_id: string; snapshot_hash: string; applied_candidate_id: string }>(
        "SELECT job_id, snapshot_hash, applied_candidate_id FROM designer_capture_autolayout_jobs",
      )
      .all();
    expect(jobs).toEqual([
      { job_id: "job-1", snapshot_hash: "snap-h", applied_candidate_id: "cand-1" },
    ]);

    // User edits net2's auto trace and deletes net3's.
    const net2 = rows.find((r) => r.net_id === "net2")!;
    const net3 = rows.find((r) => r.net_id === "net3")!;
    const modify = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-modify-net2", {
        type: "pcb_update_trace_geometry",
        traceId: net2.geometry_id,
        pointsNm: [
          { x: 0, y: 2_000_000 },
          { x: 7_000_000, y: 2_000_000 },
        ],
      } as never),
      { actor: "user" },
    );
    expect(modify.ok).toBe(true);
    const del = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-delete-net3", {
        type: "pcb_delete_trace",
        traceId: net3.geometry_id,
      } as never),
      { actor: "user" },
    );
    expect(del.ok).toBe(true);

    rows = copperRows();
    expect(rows.find((r) => r.net_id === "net1")?.status).toBe("active");
    expect(rows.find((r) => r.net_id === "net2")?.status).toBe("modified");
    expect(rows.find((r) => r.net_id === "net3")?.status).toBe("deleted");
    expect(JSON.parse(rows.find((r) => r.net_id === "net2")!.touches_json)).toHaveLength(1);
  });

  test("undo/redo cycle: registrations removed on undo of apply, restored on redo", async () => {
    setupEnv("capture-registry-undo");
    const { server, sdk } = await createRuntime();
    const design = await sdk.createDesign({ name: "Registry Undo" });
    const proj = await sdk.getPcbProjection(design.id);
    const netClassId = proj!.board.netClasses[0]!.id;

    await applyFakeCandidate(server, design.id, netClassId);
    const idsBefore = copperRows().map((r) => r.geometry_id);

    // Undo the whole apply (3 commands share the pcb session's undo stack).
    for (let i = 0; i < 3; i++) await history(server, design.id, "undo");
    expect(copperRows().every((r) => r.status === "undone")).toBe(true);

    // Redo restores registrations with IDENTICAL geometry ids (patch replay).
    for (let i = 0; i < 3; i++) await history(server, design.id, "redo");
    const after = copperRows();
    expect(after.every((r) => r.status === "active")).toBe(true);
    expect(after.map((r) => r.geometry_id)).toEqual(idsBefore);

    // Touch-undo: modify net2 (via HTTP — same store instance as the undo
    // route; the two-store history divergence is a pre-existing hazard),
    // undo → back to active; redo → modified again.
    const net2 = after.find((r) => r.net_id === "net2")!;
    const touchResponse = await server.fetch(
      new Request(`${BASE}/designs/${design.id}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          envelope(design.id, "cmd-touch-net2", {
            type: "pcb_update_trace_geometry",
            traceId: net2.geometry_id,
            pointsNm: [
              { x: 0, y: 2_000_000 },
              { x: 9_000_000, y: 2_000_000 },
            ],
          } as never),
        ),
      }),
    );
    expect(touchResponse.status).toBe(200);
    expect(copperRows().find((r) => r.net_id === "net2")?.status).toBe("modified");
    await history(server, design.id, "undo");
    expect(copperRows().find((r) => r.net_id === "net2")?.status).toBe("active");
    await history(server, design.id, "redo");
    expect(copperRows().find((r) => r.net_id === "net2")?.status).toBe("modified");
  });

  test("registry survives a runtime restart (same DB)", async () => {
    setupEnv("capture-registry-restart");
    const { server, sdk } = await createRuntime();
    const design = await sdk.createDesign({ name: "Registry Restart" });
    const proj = await sdk.getPcbProjection(design.id);
    await applyFakeCandidate(server, design.id, proj!.board.netClasses[0]!.id);
    const before = copperRows();
    expect(before).toHaveLength(3);

    // Restart: new runtime over the SAME sqlite file.
    resetCaptureRuntimeForTesting();
    resetSharedSqliteForTesting();
    await createRuntime();
    expect(copperRows()).toEqual(before);
  });
});
