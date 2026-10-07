/**
 * Compiler-agent live E2E (S3/P1.3): the real-designer counterpart of
 * `assistant-compiler.test.ts` / `assistant-compile-circuit-tool.test.ts`,
 * which run against a fake DesignerSDK. Here the full pipeline — role
 * resolution, expand → lower → apply, ERC — executes against a bootstrapped
 * ModuleRuntime with the real designer + library modules and the bundled
 * CoreLibrary pack, so pin ids, wire routing, power-port planning, net
 * derivation, undo history, and ERC all come from production code paths.
 *
 * The bundled-library env var is pinned to the repo's beta.2 pack: unpinned,
 * `locateBundledOpclib` prefers a sibling `../CoreLibrary/dist/*-dev.opclib`
 * when one exists, which would make role-ranking assertions machine-dependent.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { AiToolRegistry, type AiTool, type AiToolExecutionContext } from "agentkit/core";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { ContextResolver } from "../../../modules/assistant/backend/context-resolver";
import { applyCompiledPlan } from "../../../modules/assistant/backend/compiler/apply";
import {
  makeDesignerCompileCircuitTool,
  type CompileCircuitData,
} from "../../../modules/assistant/backend/compiler/compile-circuit-tool";
import { expandCircuit } from "../../../modules/assistant/backend/compiler/expander";
import type { CircuitIr } from "../../../modules/assistant/backend/compiler/ir";
import { lowerNetlist } from "../../../modules/assistant/backend/compiler/lowering";
import { resolveRoleToComponentId } from "../../../modules/assistant/backend/tools/library-tools";
import {
  MODULE_SDK_TOKENS,
  type DesignerSDK,
  type LibrarySDK,
} from "../../../sdks";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { MentionRegistry } from "../mentions";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const BUNDLED_PACK = path.resolve(
  REPO_ROOT,
  "../resources/core-library/openpcb-core-library-0.1.0-beta.2.opclib",
);

const RESISTOR_ID = "openpcb.core.passive.resistor";
const LED_ID = "openpcb.core.opto.led";
/** Must match the UI + assistant write tools (designer-tools.ts AI_DESIGNER_SESSION_ID). */
const UI_SESSION_ID = "designer-ui-session";

let prevBundleEnv: string | undefined;
let runtime: ModuleRuntime;
let designer: DesignerSDK;
let library: LibrarySDK;

beforeAll(async () => {
  prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  process.env.OPENPCB_BUNDLED_LIBRARY_PATH = BUNDLED_PACK;
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `assistant-compiler-live-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();
  runtime = new ModuleRuntime({
    moduleRegistry: new ModuleRouterRegistry(),
    workspaceRoot: REPO_ROOT,
  });
  await runtime.bootstrap();
  designer = runtime.getSdkRegistry().resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  library = runtime.getSdkRegistry().resolve<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
});

afterAll(() => {
  if (prevBundleEnv === undefined) delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = prevBundleEnv;
});

/** 5 LED indicators on a shared 5V rail — the P1.3 acceptance circuit. */
function fiveLedCircuit(): CircuitIr {
  return {
    version: 1,
    blocks: [0, 1, 2, 3, 4].map((i) => ({
      id: `led${i}`,
      recipe: "led_indicator",
      params: { supplyV: 5, vf: 2.0, currentA: 0.01 },
    })),
    nets: [
      { name: "VCC", ports: [0, 1, 2, 3, 4].map((i) => `led${i}.IN`) },
      { name: "GND", ports: [0, 1, 2, 3, 4].map((i) => `led${i}.GND`) },
    ],
    power: { vcc: "VCC", gnd: "GND" },
  };
}

async function resolveRoles(ir: CircuitIr): Promise<Map<string, string>> {
  const firstPass = expandCircuit(ir);
  const roleMap = new Map<string, string>();
  for (const role of new Set(firstPass.parts.map((p) => p.role))) {
    const componentId = await resolveRoleToComponentId(library, role);
    if (componentId) roleMap.set(role, componentId);
  }
  return roleMap;
}

function toolCtx(): CoreBackendModuleContext {
  return { sdk: runtime.getSdkRegistry() } as unknown as CoreBackendModuleContext;
}

function stubResolver(): ContextResolver {
  return { getPrimaryDesign: () => undefined } as unknown as ContextResolver;
}

function execCtx(): AiToolExecutionContext {
  return {
    runId: "run_live_test",
    chatId: "chat_live_test",
    bindings: [],
    limits: { profile: "medium", maxBytes: 64_000, maxItems: 200 },
  };
}

describe("assistant compiler — live backend (S3)", () => {
  describe("role resolution against the installed CoreLibrary pack", () => {
    test("'resistor' → generic Resistor, 'led' → LED (never a substitute)", async () => {
      expect(await resolveRoleToComponentId(library, "resistor")).toBe(RESISTOR_ID);
      expect(await resolveRoleToComponentId(library, "led")).toBe(LED_ID);
    });
  });

  describe("pipeline: expand → lower → apply on a real design", () => {
    test("applies the 5-LED plan: parts, values, wires, rails, nets, ERC, revision", async () => {
      const design = await designer.createDesign({ name: "Live 5-LED pipeline" });
      const ir = fiveLedCircuit();
      const roleMap = await resolveRoles(ir);
      const netlist = expandCircuit(ir, { resolveRole: (role) => roleMap.get(role) });
      const plan = lowerNetlist(netlist);
      expect(plan.unresolvedRoles).toEqual([]);

      const result = await applyCompiledPlan({
        designer,
        designId: design.id,
        baseRevision: design.revision,
        plan,
      });

      expect(result.errors).toEqual([]);
      expect(result.status).toBe("applied");
      expect(result.placedCount).toBe(10);
      expect(result.wiredCount).toBe(5); // 5 internal R→LED nets
      expect(result.portCount).toBe(10); // 5 VCC + 5 GND rail pins

      // 10 place + 5 value updates + 5 wires + 10 ports + 10 rail wires = 40 commands.
      const head = await designer.getDesign(design.id);
      expect(head?.head.revision).toBe(result.revision);
      expect(result.revision).toBe(40);

      const snapshot = await designer.getProjectionAndErc(design.id);
      expect(snapshot).not.toBeNull();
      const { projection, erc } = snapshot!;
      expect(projection.parts).toHaveLength(10);
      expect(projection.wires).toHaveLength(15); // 5 internal + 10 rail stubs
      expect(projection.primitives).toHaveLength(10);

      const resistors = projection.parts.filter((p) => p.componentId === RESISTOR_ID);
      const leds = projection.parts.filter((p) => p.componentId === LED_ID);
      expect(resistors).toHaveLength(5);
      expect(leds).toHaveLength(5);
      for (const r of resistors) expect(r.value).toBe("330Ω"); // (5V−2V)/10mA → E12
      expect(new Set(projection.parts.map((p) => p.reference)).size).toBe(10);

      // Rail ports union into exactly one derived net per rail, 5 part pins each.
      const vcc = projection.nets.filter((n) => n.name === "VCC");
      const gnd = projection.nets.filter((n) => n.name === "GND");
      expect(vcc).toHaveLength(1);
      expect(gnd).toHaveLength(1);
      expect(vcc[0]!.pinIds).toHaveLength(5);
      expect(gnd[0]!.pinIds).toHaveLength(5);

      expect(erc.summary.errors).toBe(0);

      // Compiled circuits must be undoable from the shared UI session.
      const history = await designer.getHistory(design.id, UI_SESSION_ID);
      expect(history.canUndo).toBe(true);
      expect(history.undoDepth).toBeGreaterThanOrEqual(30);
    });

    test("stale base revision aborts before placing anything", async () => {
      const design = await designer.createDesign({ name: "Live stale revision" });
      const ir = fiveLedCircuit();
      const roleMap = await resolveRoles(ir);
      const plan = lowerNetlist(
        expandCircuit(ir, { resolveRole: (role) => roleMap.get(role) }),
      );

      await expect(
        applyCompiledPlan({
          designer,
          designId: design.id,
          baseRevision: design.revision + 1,
          plan,
        }),
      ).rejects.toThrow(/Recompile/);

      const projection = await designer.getSchematicProjection(design.id);
      expect(projection?.parts ?? []).toHaveLength(0);
    });
  });

  describe("compile_circuit tool on the real backend", () => {
    test("5-LED IR passes the registered Ajv input schema", () => {
      const registry = new AiToolRegistry();
      registry.register(
        makeDesignerCompileCircuitTool(toolCtx(), stubResolver()) as unknown as AiTool,
      );
      const input = { ...fiveLedCircuit(), designId: "d-any" };
      expect(registry.validateInput("compile_circuit", input)).toEqual([]);
      // Missing required `power` must fail validation before execute.
      const { power: _power, ...invalid } = input;
      expect(registry.validateInput("compile_circuit", invalid).length).toBeGreaterThan(0);
    });

    test("end-to-end execute: applied, ERC clean, real BOM", async () => {
      const design = await designer.createDesign({ name: "Live 5-LED tool" });
      const tool = makeDesignerCompileCircuitTool(toolCtx(), stubResolver()) as unknown as AiTool<
        unknown,
        unknown
      >;

      const result = await tool.execute(execCtx(), {
        ...fiveLedCircuit(),
        designId: design.id,
      });
      const data = result.data as CompileCircuitData;

      // Assumption lines (Ohm's-law derivations) surface as warnings; nothing else may.
      expect(result.warnings.filter((w) => !/R = \(Vsupply/.test(w))).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.status).toBe("ok");
      expect(data.status).toBe("applied");
      expect(data.placedCount).toBe(10);
      expect(data.wiredCount).toBe(5);
      expect(data.portCount).toBe(10);
      expect(data.missingRoles).toEqual([]);
      expect(data.ercErrors).toEqual([]);
      expect(data.assumptions.some((a) => a.includes("330Ω"))).toBe(true);

      const bom = new Map(data.bom.map((b) => [b.componentId, b]));
      expect(bom.get(RESISTOR_ID)?.quantity).toBe(5);
      expect(bom.get(RESISTOR_ID)?.value).toBe("330Ω");
      expect(bom.get(LED_ID)?.quantity).toBe(5);
    });

    test("recompile into a non-empty design offsets below existing parts (no stacking shorts)", async () => {
      const design = await designer.createDesign({ name: "Live additive recompile" });
      const tool = makeDesignerCompileCircuitTool(toolCtx(), stubResolver()) as unknown as AiTool<
        unknown,
        unknown
      >;

      const first = await tool.execute(execCtx(), { ...fiveLedCircuit(), designId: design.id });
      expect((first.data as CompileCircuitData).status).toBe("applied");
      const second = await tool.execute(execCtx(), { ...fiveLedCircuit(), designId: design.id });
      expect((second.data as CompileCircuitData).status).toBe("applied");
      expect((second.data as CompileCircuitData).ercErrors).toEqual([]);

      const snapshot = await designer.getProjectionAndErc(design.id);
      const { projection, erc } = snapshot!;
      expect(projection.parts).toHaveLength(20);
      // The second grid must sit strictly below the first — no coincident parts
      // (stacked pins junction-merge the two compiles into ERC-invisible shorts).
      const positions = new Set(
        projection.parts.map((p) => `${p.positionNm.x},${p.positionNm.y}`),
      );
      expect(positions.size).toBe(20);
      // Same rail names union on purpose; every internal net stays pairwise.
      const vcc = projection.nets.find((n) => n.name === "VCC");
      const gnd = projection.nets.find((n) => n.name === "GND");
      expect(vcc?.pinIds).toHaveLength(10);
      expect(gnd?.pinIds).toHaveLength(10);
      const internal = projection.nets.filter((n) => n.name !== "VCC" && n.name !== "GND");
      expect(internal).toHaveLength(10);
      for (const net of internal) expect(net.pinIds).toHaveLength(2);
      expect(erc.summary.errors).toBe(0);
    });
  });
});
