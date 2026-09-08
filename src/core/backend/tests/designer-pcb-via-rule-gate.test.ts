/**
 * The via insert gate resolves its minimums through the SAME `RuleResolver`
 * batch DRC uses (rule-semantics contract §5.1, §9): a scoped scalar rule
 * refuses a via exactly the way the board minimum does, and a via on a net the
 * rule does not name is still accepted at the board minimum.
 *
 * Scoped scalar rules were persisted-but-inert before S6 (§12 item 1), so a
 * board could carry a `viaDiameter` rule the gate ignored and batch DRC never
 * enforced.
 */
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { DesignerCommandEnvelope, DesignerSDK } from "../../../sdks";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { MentionRegistry } from "../mentions";

const SESSION = "designer-pcb-via-rule-gate";

async function createDesigner(testLabel: string): Promise<{
  sdk: DesignerSDK;
  designId: string;
}> {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${testLabel}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry: new ModuleRouterRegistry(),
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await moduleRuntime.bootstrap();
  const sdk = moduleRuntime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await sdk.createDesign({ name: testLabel });
  return { sdk, designId: design.id };
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

describe("via insert gate honours scoped scalar rules", () => {
  test("a net-scoped viaDiameter rule refuses the via the board minimum accepts", async () => {
    const { sdk, designId } = await createDesigner("via-rule-gate");
    const initial = await sdk.getPcbProjection(designId);
    const netClassId = initial!.board.netClasses[0]!.id;

    // Board minimum is 0.8; the rule demands 1.0 on HV_RAIL only.
    const rules = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-via-rules", initial!.revision, {
        type: "pcb_set_design_rules",
        drcRules: [
          {
            id: "hv-via",
            name: "HV via diameter",
            enabled: true,
            priority: 10,
            scopes: [{ kind: "net", netIds: ["n_hv"] }],
            constraint: { kind: "viaDiameter", minMm: 1.0 },
          },
        ],
      }),
    );
    expect(rules.ok).toBe(true);

    const afterRules = await sdk.getPcbProjection(designId);
    const refused = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-via-refused", afterRules!.revision, {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: "n_hv",
        netClassId,
        diameterMmOverride: 0.9,
        drillMmOverride: 0.4,
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(String((refused as { detail?: string }).detail)).toContain(
        "via diameter is below board minimum",
      );
    }
    // Nothing was inserted.
    expect((await sdk.getPcbProjection(designId))!.vias.length).toBe(0);

    // The SAME geometry on a net the rule does not name is accepted: the
    // resolution falls back to the 0.8 board minimum.
    const accepted = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-via-accepted", afterRules!.revision, {
        type: "pcb_add_via",
        centerMm: { x: 14, y: 10 },
        netId: "n_other",
        netClassId,
        diameterMmOverride: 0.9,
        drillMmOverride: 0.4,
      }),
    );
    expect(accepted.ok).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.vias.length).toBe(1);

    // And a via that satisfies the rule goes in.
    const after = await sdk.getPcbProjection(designId);
    const wide = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-via-wide", after!.revision, {
        type: "pcb_add_via",
        centerMm: { x: 18, y: 10 },
        netId: "n_hv",
        netClassId,
        diameterMmOverride: 1.0,
        drillMmOverride: 0.4,
      }),
    );
    expect(wide.ok).toBe(true);
    expect((await sdk.getPcbProjection(designId))!.vias.length).toBe(2);
  });

  test("a net-scoped annularRing rule refuses a via with too thin a ring", async () => {
    const { sdk, designId } = await createDesigner("via-rule-gate-annular");
    const initial = await sdk.getPcbProjection(designId);
    const netClassId = initial!.board.netClasses[0]!.id;

    const rules = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-annular-rules", initial!.revision, {
        type: "pcb_set_design_rules",
        drcRules: [
          {
            id: "hv-annular",
            name: "HV annular ring",
            enabled: true,
            priority: 10,
            scopes: [{ kind: "net", netIds: ["n_hv"] }],
            constraint: { kind: "annularRing", minMm: 0.35 },
          },
        ],
      }),
    );
    expect(rules.ok).toBe(true);

    // (1.0 − 0.4) / 2 = 0.3 — above the 0.2 board minimum, below the rule's.
    const afterRules = await sdk.getPcbProjection(designId);
    const refused = await sdk.dispatchCommand(
      designId,
      envelope(designId, "cmd-annular-refused", afterRules!.revision, {
        type: "pcb_add_via",
        centerMm: { x: 10, y: 10 },
        netId: "n_hv",
        netClassId,
        diameterMmOverride: 1.0,
        drillMmOverride: 0.4,
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(String((refused as { detail?: string }).detail)).toContain(
        "annular ring is below board minimum",
      );
    }
  });
});
