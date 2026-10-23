/**
 * A6 acceptance (SPEC_ML0_DATASET_FOUNDATION §0/§6): a full desktop session —
 * open → auto-layout apply → manual corrections → export — yields per-net
 * accepted/modified/ripped/rerouted labels derived correctly, and the
 * AutoCopperRegistry survives an undo/redo cycle of the touching edits.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import type {
  PerNetOutcome,
  SessionLogEntry,
} from "../../../modules/designer/backend/capture/types";
import { decompressSegment } from "../../../modules/designer/backend/capture/zstd-io";
import {
  getSharedSqlite,
  resetSharedSqliteForTesting,
} from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { MentionRegistry } from "../mentions";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

async function seedNet(
  sdk: DesignerSDK,
  designId: string,
  name: string,
  y: number,
): Promise<string> {
  const result = await sdk.dispatchCommand(designId, {
    commandId: crypto.randomUUID(),
    sessionId: "capture-fixture-setup",
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command: { type: "upsert_label", text: name, positionNm: { x: 0, y } },
  });
  expect(result.ok).toBe(true);
  const projection = await sdk.getSchematicProjection(designId);
  const net = projection?.nets.find((candidate) => candidate.name === name);
  if (!net) throw new Error(`Missing schematic net ${name}`);
  expect(net.id).toMatch(/^net:[a-z2-7]{10}:[1-9][0-9]*$/);
  return net.id;
}

const BASE = "http://localhost/api/modules/designer";
const SESSION = "designer-pcb-session";

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
  return { server, sdk };
}

function setupEnv(label: string): string {
  MentionRegistry.init();
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  const captureDir = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  process.env.OPENPCB_CAPTURE_DIR = captureDir;
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "1";
  resetCaptureRuntimeForTesting();
  return captureDir;
}

function readEntries(captureDir: string): SessionLogEntry[] {
  const entries: SessionLogEntry[] = [];
  const root = path.join(captureDir, "sessions");
  if (!existsSync(root)) return entries;
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory() && item.name !== "snapshots") walk(full);
      else if (item.isFile() && item.name.includes(".jsonl")) {
        const text = decompressSegment(readFileSync(full), item.name).toString();
        for (const line of text.split("\n")) {
          if (line.trim()) entries.push(JSON.parse(line));
        }
      }
    }
  };
  walk(root);
  // ULIDs are globally time-ordered; seq resets per capture session.
  return entries.sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function post(
  server: { fetch(req: Request): Promise<Response> | Response },
  url: string,
  body: unknown,
): Promise<Response> {
  return server.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
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

function registryRow(netId: string): { geometry_id: string } {
  const row = getSharedSqlite()
    .query<{ geometry_id: string }, [string]>(
      "SELECT geometry_id FROM designer_capture_auto_copper WHERE net_id = ?",
    )
    .get(netId);
  if (!row) throw new Error(`no registry row for ${netId}`);
  return row;
}

function envelopeBody(designId: string, commandId: string, command: unknown) {
  return {
    commandId,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision: null,
    issuedAt: Date.now(),
    command,
  };
}

function lastOutcomes(entries: SessionLogEntry[]): Map<string, PerNetOutcome> {
  const map = new Map<string, PerNetOutcome>();
  for (const entry of entries) {
    if (entry.kind === "per_net_outcome" && entry.outcome) {
      map.set(entry.outcome.netId, entry.outcome); // later exports overwrite
    }
  }
  return map;
}

afterEach(() => {
  resetCaptureRuntimeForTesting();
  delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  delete process.env.OPENPCB_CAPTURE_DIR;
});

describe("A6 — per-net outcomes from a scripted session", () => {
  test("open → apply(3 nets) → edit net2, delete net3 → export ⇒ accepted/modified/ripped; rerouted on re-add", async () => {
    const captureDir = setupEnv("capture-a6");
    const { server, sdk } = await createRuntime();
    const design = await sdk.createDesign({ name: "A6" });
    const net1 = await seedNet(sdk, design.id, "net1", 0);
    const net2 = await seedNet(sdk, design.id, "net2", 2_000_000);
    const net3 = await seedNet(sdk, design.id, "net3", 4_000_000);
    const proj = await sdk.getPcbProjection(design.id);
    const netClassId = proj!.board.netClasses[0]!.id;

    // 1. Open (project_open proxy).
    expect((await server.fetch(new Request(`${BASE}/designs/${design.id}`))).status).toBe(200);

    // 2. Apply a fake layout candidate: 3 nets auto-routed.
    const apply = await post(server, `${BASE}/designs/${design.id}/autoroute/apply`, {
      sessionId: SESSION,
      jobId: "job-1",
      appliedCandidateId: "cand-1",
      resultSummary: { determinism: { snapshotHash: "h", engineVersion: "v" } },
      operations: [
        traceOp("op-1", net1, netClassId, 0),
        traceOp("op-2", net2, netClassId, 2_000_000),
        traceOp("op-3", net3, netClassId, 4_000_000),
      ],
    });
    expect(apply.status).toBe(200);

    // 3. User edits net2's auto trace, deletes net3's, leaves net1 untouched.
    const net2Id = registryRow(net2).geometry_id;
    const net3Id = registryRow(net3).geometry_id;
    const modify = await post(
      server,
      `${BASE}/designs/${design.id}/commands`,
      envelopeBody(design.id, "cmd-a6-modify", {
        type: "pcb_update_trace_geometry",
        traceId: net2Id,
        pointsNm: [
          { x: 0, y: 2_000_000 },
          { x: 8_000_000, y: 2_000_000 },
        ],
      }),
    );
    expect(modify.status).toBe(200);
    const del = await post(
      server,
      `${BASE}/designs/${design.id}/commands`,
      envelopeBody(design.id, "cmd-a6-delete", {
        type: "pcb_delete_trace",
        traceId: net3Id,
      }),
    );
    expect(del.status).toBe(200);

    // 4. Export → outcomes derived.
    const export1 = await post(server, `${BASE}/designs/${design.id}/exports/gerber`, {});
    expect(export1.status).toBe(200);

    resetCaptureRuntimeForTesting();
    let outcomes = lastOutcomes(readEntries(captureDir));
    expect(outcomes.get(net1)).toMatchObject({
      outcome: "accepted",
      editCount: 0,
      jobId: "job-1",
      appliedCandidateId: "cand-1",
    });
    expect(outcomes.get(net2)).toMatchObject({ outcome: "modified", editCount: 1 });
    expect(outcomes.get(net3)).toMatchObject({ outcome: "ripped", editCount: 1 });

    // 5. Rerouted: delete net1's auto trace, hand-route a replacement, export.
    process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "1";
    process.env.OPENPCB_CAPTURE_DIR = captureDir;
    resetCaptureRuntimeForTesting();
    const { server: server2 } = await (async () => {
      resetSharedSqliteForTesting();
      return createRuntime();
    })();
    const net1Id = registryRow(net1).geometry_id;
    const rip = await post(
      server2,
      `${BASE}/designs/${design.id}/commands`,
      envelopeBody(design.id, "cmd-a6-rip-net1", {
        type: "pcb_delete_trace",
        traceId: net1Id,
      }),
    );
    expect(rip.status).toBe(200);
    expect(((await rip.json()) as { data?: { result?: { ok?: boolean } } }).data?.result?.ok).toBe(
      true,
    );
    const reroute = await post(
      server2,
      `${BASE}/designs/${design.id}/commands`,
      envelopeBody(design.id, "cmd-a6-reroute-net1", {
        type: "pcb_add_trace",
        layer: "F.Cu",
        pointsNm: [
          { x: 0, y: 0 },
          { x: 3_000_000, y: 0 },
          { x: 3_000_000, y: 1_000_000 },
        ],
        widthMm: 0.25,
        netId: net1,
        netClassId,
        segmentMode: "manhattan-90",
      }),
    );
    expect(reroute.status).toBe(200);
    expect(
      ((await reroute.json()) as { data?: { result?: { ok?: boolean } } }).data?.result?.ok,
    ).toBe(true);
    const export2 = await post(server2, `${BASE}/designs/${design.id}/exports/gerber`, {});
    expect(export2.status).toBe(200);

    resetCaptureRuntimeForTesting();
    outcomes = lastOutcomes(readEntries(captureDir));
    expect(outcomes.get(net1)?.outcome).toBe("rerouted");
    expect(outcomes.get(net2)?.outcome).toBe("modified");
    expect(outcomes.get(net3)?.outcome).toBe("ripped");
  });

  test("undo/redo cycle of the user's edits keeps outcomes stable", async () => {
    const captureDir = setupEnv("capture-a6-undo");
    const { server, sdk } = await createRuntime();
    const design = await sdk.createDesign({ name: "A6 undo" });
    const netA = await seedNet(sdk, design.id, "netA", 0);
    const netB = await seedNet(sdk, design.id, "netB", 2_000_000);
    const proj = await sdk.getPcbProjection(design.id);
    const netClassId = proj!.board.netClasses[0]!.id;

    await post(server, `${BASE}/designs/${design.id}/autoroute/apply`, {
      sessionId: SESSION,
      jobId: "job-2",
      appliedCandidateId: "cand-2",
      operations: [
        traceOp("op-1", netA, netClassId, 0),
        traceOp("op-2", netB, netClassId, 2_000_000),
      ],
    });
    const netBId = registryRow(netB).geometry_id;
    await post(
      server,
      `${BASE}/designs/${design.id}/commands`,
      envelopeBody(design.id, "cmd-a6u-del", {
        type: "pcb_delete_trace",
        traceId: netBId,
      }),
    );

    // Undo + redo the delete — registry must end back at 'deleted'.
    for (const action of ["undo", "redo"] as const) {
      const response = await post(
        server,
        `${BASE}/designs/${design.id}/history/${action}`,
        { sessionId: SESSION },
      );
      expect(response.status).toBe(200);
    }

    const export1 = await post(server, `${BASE}/designs/${design.id}/exports/gerber`, {});
    expect(export1.status).toBe(200);

    resetCaptureRuntimeForTesting();
    const outcomes = lastOutcomes(readEntries(captureDir));
    expect(outcomes.get(netA)?.outcome).toBe("accepted");
    expect(outcomes.get(netB)?.outcome).toBe("ripped");
  });
});
