import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK } from "../../../sdks";
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

const SESSION = "designer-pcb-session";

function isolateTestDb(label: string): void {
  MentionRegistry.init();
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

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
  return { moduleRuntime, server };
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

function addTraceCommand(netId: string | null, netClassId: string) {
  return {
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
  } as DesignerCommandEnvelope["command"];
}

async function netClassId(sdk: DesignerSDK, designId: string): Promise<string> {
  const proj = await sdk.getPcbProjection(designId);
  return proj!.board.netClasses[0]!.id;
}

export function readSessionEntries(captureDir: string): SessionLogEntry[] {
  const entries: SessionLogEntry[] = [];
  const sessionsRoot = path.join(captureDir, "sessions");
  if (!existsSync(sessionsRoot)) return entries;
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name.includes(".jsonl")) {
        const text = decompressSegment(readFileSync(full), item.name).toString();
        for (const line of text.split("\n")) {
          if (line.trim()) entries.push(JSON.parse(line));
        }
      }
    }
  };
  walk(sessionsRoot);
  return entries.sort((a, b) => a.seq - b.seq);
}

afterEach(() => {
  resetCaptureRuntimeForTesting();
  delete process.env.OPENPCB_FEATURE_DATASET_CAPTURE;
  delete process.env.OPENPCB_CAPTURE_DIR;
});

describe("dataset capture flag", () => {
  test("default OFF in dev/test: zero capture writes", async () => {
    isolateTestDb("capture-flag-off");
    const captureDir = mkdtempSync(path.join(os.tmpdir(), "capture-off-"));
    process.env.OPENPCB_CAPTURE_DIR = captureDir;
    resetCaptureRuntimeForTesting();

    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Flag Off" });
    const cls = await netClassId(sdk, design.id);
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-off-1", addTraceCommand(null, cls)),
    );
    expect(result.ok).toBe(true);

    expect(existsSync(path.join(captureDir, "sessions"))).toBe(false);
    expect(readSessionEntries(captureDir)).toHaveLength(0);
  });

  test("force-enabled: session_start + command entries with tags land on disk", async () => {
    isolateTestDb("capture-flag-on");
    const captureDir = mkdtempSync(path.join(os.tmpdir(), "capture-on-"));
    process.env.OPENPCB_CAPTURE_DIR = captureDir;
    process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0";
    resetCaptureRuntimeForTesting();

    const { moduleRuntime: setupRuntime } = await createRuntime();
    const setupSdk = setupRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await setupSdk.createDesign({ name: "Flag On" });
    const netId = await seedNet(setupSdk, design.id, "net-42", 0);

    // Setup must not become the first captured command under test.
    process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "1";
    resetCaptureRuntimeForTesting();
    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const cls = await netClassId(sdk, design.id);
    const result = await sdk.dispatchCommand(
      design.id,
      envelope(design.id, "cmd-on-1", addTraceCommand(netId, cls)),
    );
    expect(result.ok).toBe(true);

    resetCaptureRuntimeForTesting(); // flush + end segments
    const entries = readSessionEntries(captureDir);
    const kinds = entries.map((entry) => entry.kind);
    expect(kinds[0]).toBe("session_start");
    const command = entries.find((entry) => entry.kind === "command");
    expect(command).toBeTruthy();
    expect(command?.actor).toBe("user");
    expect(command?.envelope?.commandId).toBe("cmd-on-1");
    expect(command?.result?.ok).toBe(true);
    expect(command?.tags?.opKinds).toEqual({ pcb_add_trace: 1 });
    expect(command?.tags?.touchedNetIds).toEqual([netId]);
    expect(command?.tags?.touchesAutoCopper).toBe(false);
  });

  test("tag derivation failure is isolated: raw entry still logged", async () => {
    isolateTestDb("capture-tag-fail");
    const captureDir = mkdtempSync(path.join(os.tmpdir(), "capture-tagfail-"));
    process.env.OPENPCB_CAPTURE_DIR = captureDir;
    process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "1";
    resetCaptureRuntimeForTesting();

    const { moduleRuntime } = await createRuntime();
    const sdk = moduleRuntime
      .getSdkRegistry()
      .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const design = await sdk.createDesign({ name: "Tag Fail" });

    // pcb_set_view_state's executor never reads `netId`, so a non-enumerable
    // throwing getter survives execution AND JSON serialization (stringify
    // skips non-enumerables) — only deriveTags' explicit access throws.
    const poisoned = envelope(design.id, "cmd-poison-1", {
      type: "pcb_set_view_state",
      patch: { viewSide: "top" },
    } as never);
    Object.defineProperty(poisoned.command, "netId", {
      get() {
        throw new Error("poisoned netId");
      },
      enumerable: false,
      configurable: true,
    });
    const result = await sdk.dispatchCommand(design.id, poisoned);
    expect(result.ok).toBe(true);

    resetCaptureRuntimeForTesting();
    const entries = readSessionEntries(captureDir);
    const command = entries.find((entry) => entry.kind === "command");
    expect(command).toBeTruthy();
    expect(command?.tags).toBeNull();
    expect(command?.tagError).toContain("poisoned netId");
    expect(command?.envelope?.commandId).toBe("cmd-poison-1");
  });
});
