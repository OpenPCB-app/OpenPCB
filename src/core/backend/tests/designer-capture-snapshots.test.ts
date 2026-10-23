import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import type { SessionLogEntry } from "../../../modules/designer/backend/capture/types";
import { decompressSegment } from "../../../modules/designer/backend/capture/zstd-io";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
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
  return entries.sort((a, b) => a.seq - b.seq);
}

afterEach(() => {
  resetCaptureRuntimeForTesting();
  delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  delete process.env.OPENPCB_CAPTURE_DIR;
});

describe("milestone snapshots", () => {
  test("project-open proxy fires once; apply snapshots are content-addressed", async () => {
    const captureDir = setupEnv("capture-snapshots");
    const { server, sdk } = await createRuntime();
    const design = await sdk.createDesign({ name: "Snapshots" });
    const netId = await seedNet(sdk, design.id, "netS", 0);
    const proj = await sdk.getPcbProjection(design.id);
    const netClassId = proj!.board.netClasses[0]!.id;

    // Open twice — only one project_open snapshot per capture session.
    for (let i = 0; i < 2; i++) {
      const response = await server.fetch(
        new Request(`${BASE}/designs/${design.id}`),
      );
      expect(response.status).toBe(200);
    }

    // Apply a one-trace fake candidate → autolayout_applied snapshot.
    const applyResponse = await server.fetch(
      new Request(`${BASE}/designs/${design.id}/autoroute/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "designer-pcb-session",
          jobId: "job-snap",
          appliedCandidateId: "cand-snap",
          operations: [
            {
              id: "op-1",
              kind: "add_trace",
              title: "t",
              summary: "t",
              riskLevel: "safe",
              sources: [],
              warnings: [],
              payload: {
                type: "pcb_add_trace",
                layer: "F.Cu",
                pointsNm: [
                  { x: 0, y: 0 },
                  { x: 5_000_000, y: 0 },
                ],
                widthMm: 0.25,
                netId,
                netClassId,
                segmentMode: "manhattan-90",
              },
            },
          ],
        }),
      }),
    );
    expect(applyResponse.status).toBe(200);
    // Snapshot writes are fire-and-forget — give the microtask queue a beat.
    await new Promise((resolve) => setTimeout(resolve, 50));

    resetCaptureRuntimeForTesting();
    const entries = readEntries(captureDir);
    const snapshots = entries.filter((entry) => entry.kind === "milestone_snapshot");
    const triggers = snapshots.map((entry) => entry.snapshot?.trigger);
    expect(triggers.filter((t) => t === "project_open")).toHaveLength(1);
    expect(triggers.filter((t) => t === "autolayout_applied")).toHaveLength(1);

    // Files exist on disk under the session dir, content-addressed by sha.
    for (const entry of snapshots) {
      expect(existsSync(entry.snapshot!.path)).toBe(true);
      expect(entry.snapshot!.path).toContain(entry.snapshot!.sha256);
    }
    // Open vs post-apply snapshots differ (copper changed).
    expect(snapshots[0]?.snapshot?.sha256).not.toBe(snapshots[1]?.snapshot?.sha256);
  });
});
