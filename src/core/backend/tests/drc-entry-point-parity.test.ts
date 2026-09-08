/**
 * Every DRC entry point reports the same board (rule-semantics contract §8,
 * §12 item 4). `runDrc` defaults `severityOverrides`, `drcIgnoredRuleClasses`
 * and `drcWaivedViolationIds` from the projection, so the HTTP route, the SDK
 * (assistant / MCP) and the cloud apply path cannot drift — before S6 the
 * assistant's `run_drc` ignored the board's severity overrides entirely.
 *
 * Also pins the `HOLE_TO_BOARD_EDGE → HOLE_OFF_BOARD` override migration
 * (§12 item 3, Astra run 1 #13): the S6 code split must not resurrect a
 * breach a designer had already ignored.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type {
  DesignerCommandEnvelope,
  DesignerSDK,
  DrcReport,
} from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";

const SESSION = "drc-entry-point-parity";

async function createDesigner(testLabel: string) {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
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
  const design = await sdk.createDesign({ name: testLabel });
  return { sdk, server, designId: design.id };
}

function envelope(
  designId: string,
  commandId: string,
  baseRevision: number | null,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId,
    sessionId: SESSION,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

/** A drill that breaches the right board edge (default outline is 50x30). */
const OFF_BOARD_HOLE = {
  type: "pcb_add_free_hole" as const,
  centerMm: { x: 24.8, y: 0 },
  drillMm: 1.2,
  plated: false,
};

describe("DRC entry points agree", () => {
  test("the SDK's report deep-equals the HTTP route's for the same projection", async () => {
    const { sdk, server, designId } = await createDesigner("drc-parity");
    let revision = (await sdk.getPcbProjection(designId))!.revision;

    const hole = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-hole", revision, OFF_BOARD_HOLE),
    );
    expect(hole.ok).toBe(true);
    revision = (await sdk.getPcbProjection(designId))!.revision;

    // A board-level severity override AND a view-state waiver, so both
    // suppression channels are exercised.
    const overrides = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-overrides", revision, {
        type: "pcb_set_design_rules",
        drcSeverityOverrides: { TRACK_DANGLING: "ignore" },
      }),
    );
    expect(overrides.ok).toBe(true);
    revision = (await sdk.getPcbProjection(designId))!.revision;

    // Waive whatever the run produces first, by its real v2 id.
    const seed = runDrc((await sdk.getPcbProjection(designId))!);
    const waivedId = seed.violations[0]!.id;
    const waive = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-waive", revision, {
        type: "pcb_set_view_state",
        patch: { drcWaivedViolationIds: [waivedId] },
      }),
    );
    expect(waive.ok).toBe(true);

    const viaSdk = await sdk.runDrc(designId);
    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/designer/designs/${designId}/drc/run`,
        { method: "POST" },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { report: DrcReport } };
    expect(viaSdk).toEqual(body.data.report);

    // Not vacuous: the waiver and the override both did something.
    const waived = viaSdk!.violations.find((v) => v.id === waivedId);
    expect(waived?.waived).toBe(true);
    expect(viaSdk!.violations.some((v) => v.code === "TRACK_DANGLING")).toBe(
      false,
    );
  });

  test("an ignore on HOLE_TO_BOARD_EDGE still suppresses the S6 breach code", async () => {
    const { sdk, designId } = await createDesigner("drc-hole-override");
    let revision = (await sdk.getPcbProjection(designId))!.revision;

    const hole = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-hole", revision, OFF_BOARD_HOLE),
    );
    expect(hole.ok).toBe(true);
    revision = (await sdk.getPcbProjection(designId))!.revision;

    // Before the override the breach is reported under the new code.
    const before = runDrc((await sdk.getPcbProjection(designId))!);
    expect(before.violations.some((v) => v.code === "HOLE_OFF_BOARD")).toBe(
      true,
    );

    // A board saved before S6 carries the OLD code only. The read path copies
    // it forward, so the breach the designer had ignored stays ignored.
    const overrides = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-legacy-override", revision, {
        type: "pcb_set_design_rules",
        drcSeverityOverrides: { HOLE_TO_BOARD_EDGE: "ignore" },
      }),
    );
    expect(overrides.ok).toBe(true);

    const projection = (await sdk.getPcbProjection(designId))!;
    expect(projection.board.drcSeverityOverrides?.HOLE_OFF_BOARD).toBe(
      "ignore",
    );
    const after = runDrc(projection);
    expect(after.violations.some((v) => v.code === "HOLE_OFF_BOARD")).toBe(
      false,
    );
  });
});
