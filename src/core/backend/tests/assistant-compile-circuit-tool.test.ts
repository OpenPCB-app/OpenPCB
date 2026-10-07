import { describe, expect, test } from "bun:test";
import type { AiTool, AiToolExecutionContext } from "agentkit/core";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import type { ContextResolver } from "../../../modules/assistant/backend/context-resolver";
import { makeDesignerCompileCircuitTool, type CompileCircuitData } from "../../../modules/assistant/backend/compiler/compile-circuit-tool";
import type { CircuitIr } from "../../../modules/assistant/backend/compiler/ir";
import {
  MODULE_SDK_TOKENS,
  type DesignerDesignRecord,
  type DesignerDispatchResult,
  type DesignerPin,
  type DesignerPlacedPart,
  type DesignerSchematicProjection,
  type DesignerSDK,
  type ErcReport,
  type LibraryComponent,
  type LibrarySDK,
} from "../../../sdks";

// ─── fixtures ──────────────────────────────────────────────────────────────

const COMPONENTS: LibraryComponent[] = [
  component("openpcb.core.opto.led", "LED", ["led", "opto", "diode"]),
  component("openpcb.core.passive.resistor", "Resistor", ["passive", "builtin", "system"]),
  // Same LDR trap as the resolver tests: it must lose to the generic Resistor.
  component("openpcb.core.sensor.ldr", "LDR Photoresistor", ["sensor", "light", "photoresistor", "ldr"]),
];

const PIN_TABLE: Record<string, Array<{ number: string; name: string }>> = {
  "openpcb.core.passive.resistor": [
    { number: "1", name: "" },
    { number: "2", name: "" },
  ],
  "openpcb.core.opto.led": [
    { number: "1", name: "K" },
    { number: "2", name: "A" },
  ],
};

function twoLedCircuit(): CircuitIr {
  return {
    version: 1,
    blocks: [
      { id: "led0", recipe: "led_indicator", params: { supplyV: 5, vf: 2.0, currentA: 0.01 } },
      { id: "led1", recipe: "led_indicator", params: { supplyV: 5, vf: 2.0, currentA: 0.01 } },
    ],
    nets: [
      { name: "DRV", ports: ["led0.IN", "led1.IN"] },
      { name: "GND", ports: ["led0.GND", "led1.GND"] },
    ],
    power: { vcc: "VCC", gnd: "GND" },
  };
}

// ─── tests ───────────────────────────────────────────────────────────────

describe("compile_circuit tool", () => {
  test("compiles a multi-LED circuit: resolves, places, wires, rails, ERC-clean", async () => {
    const { sdk, state } = makeFakeDesigner();
    const tool = makeDesignerCompileCircuitTool(
      fakeCtx(fakeLibrary(COMPONENTS), sdk),
      fakeResolver(),
    ) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), twoLedCircuit());
    const data = result.data as CompileCircuitData;

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(data.status).toBe("applied");
    expect(data.placedCount).toBe(4);
    expect(data.wiredCount).toBe(3);
    expect(data.portCount).toBe(2);
    expect(data.missingRoles).toEqual([]);
    expect(data.ercErrors).toEqual([]);
    expect(state.parts).toHaveLength(4);
    // BOM aggregates by componentId → generic resistor (x2) + LED (x2).
    const byComponent = new Map(data.bom.map((b) => [b.componentId, b]));
    expect(byComponent.get("openpcb.core.passive.resistor")?.quantity).toBe(2);
    expect(byComponent.get("openpcb.core.opto.led")?.quantity).toBe(2);
    // Ohm's-law derivation surfaced as an assumption.
    expect(data.assumptions.some((a) => a.includes("330Ω"))).toBe(true);
  });

  test("installed-parts-only: flags missing roles, places nothing, never substitutes", async () => {
    const { sdk, state } = makeFakeDesigner();
    const tool = makeDesignerCompileCircuitTool(
      fakeCtx(fakeLibrary([]), sdk), // empty library → nothing resolves
      fakeResolver(),
    ) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), twoLedCircuit());
    const data = result.data as CompileCircuitData;

    expect(result.ok).toBe(false);
    expect(data.status).toBe("unresolved");
    expect(data.placedCount).toBe(0);
    expect(data.missingRoles.sort()).toEqual(["led", "resistor"]);
    expect(state.parts).toHaveLength(0);
    expect(result.warnings.some((w) => /import/i.test(w))).toBe(true);
  });

  test("stale revision throw is caught and reported (never crosses to the model as a throw)", async () => {
    const { sdk } = makeFakeDesigner({ staleAfterFirstGetDesign: true });
    const tool = makeDesignerCompileCircuitTool(
      fakeCtx(fakeLibrary(COMPONENTS), sdk),
      fakeResolver(),
    ) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), twoLedCircuit());

    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/Recompile/);
  });

  test("malformed IR (unknown recipe) is reported as a fixable message, not a crash", async () => {
    const { sdk } = makeFakeDesigner();
    const tool = makeDesignerCompileCircuitTool(
      fakeCtx(fakeLibrary(COMPONENTS), sdk),
      fakeResolver(),
    ) as unknown as AiTool<unknown, unknown>;

    const ir: CircuitIr = {
      version: 1,
      blocks: [{ id: "x", recipe: "does_not_exist" }],
      nets: [],
      power: { vcc: "VCC", gnd: "GND" },
    };
    const result = await tool.execute(execCtx(), ir);

    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/Invalid circuit IR/);
    expect(result.warnings[0]).toMatch(/Unknown block recipe/);
  });

  test("floating block ports and dropped 1-pin nets flag the result partial", async () => {
    // LLM-smoke regression (S3): the model wired only per-LED drive nets
    // (1 pin each) and never referenced the GND ports — the circuit applied
    // "clean" but every cathode floated and the rails were absent.
    const { sdk, state } = makeFakeDesigner();
    const tool = makeDesignerCompileCircuitTool(
      fakeCtx(fakeLibrary(COMPONENTS), sdk),
      fakeResolver(),
    ) as unknown as AiTool<unknown, unknown>;

    const ir: CircuitIr = {
      version: 1,
      blocks: [
        { id: "led0", recipe: "led_indicator" },
        { id: "led1", recipe: "led_indicator" },
      ],
      nets: [
        { name: "CTRL0", ports: ["led0.IN"] },
        { name: "CTRL1", ports: ["led1.IN"] },
      ],
      power: { vcc: "+5V", gnd: "GND" },
    };
    const result = await tool.execute(execCtx(), ir);
    const data = result.data as CompileCircuitData;

    expect(data.status).toBe("applied"); // parts + internal wires still land
    expect(state.parts).toHaveLength(4);
    expect(result.ok).toBe(false); // ...but the result is flagged, not "clean"
    expect(result.status).toBe("partial");
    expect(result.warnings.some((w) => w.includes('"CTRL0"'))).toBe(true);
    expect(result.warnings.some((w) => w.includes("led0.GND"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("led1.GND"))).toBe(true);
  });

  test("ERC errors on the composed result surface in the tool output (ok=false)", async () => {
    const { sdk } = makeFakeDesigner({
      ercErrors: [{ code: "UNCONNECTED_INPUT_PIN", message: "U1 pin 3 floating" }],
    });
    const tool = makeDesignerCompileCircuitTool(
      fakeCtx(fakeLibrary(COMPONENTS), sdk),
      fakeResolver(),
    ) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), twoLedCircuit());
    const data = result.data as CompileCircuitData;

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(data.status).toBe("applied"); // apply succeeded; ERC gate failed it
    expect(data.ercErrors).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("UNCONNECTED_INPUT_PIN"))).toBe(true);
  });
});

// ─── fakes ───────────────────────────────────────────────────────────────

function component(id: string, name: string, tags: string[]): LibraryComponent {
  return {
    id,
    name,
    description: `${name} component.`,
    symbolId: `${id}.symbol`,
    footprintId: `${id}.footprint`,
    tags,
    isBuiltin: id.includes("passive"),
  };
}

function fakeLibrary(components: LibraryComponent[]): Pick<LibrarySDK, "searchComponents"> {
  return {
    async searchComponents(params) {
      const query = params.query?.trim().toLowerCase() ?? "";
      const tags = params.tags ?? [];
      const filtered = components.filter((c) => {
        const text = `${c.name} ${c.description}`.toLowerCase();
        if (query && !text.includes(query)) return false;
        for (const tag of tags) if (!c.tags.includes(tag)) return false;
        return true;
      });
      return filtered.slice(0, params.limit ?? 25);
    },
  };
}

interface FakeDesignerOptions {
  ercErrors?: Array<{ code: string; message: string }>;
  /** Return an incrementing revision per getDesign call to simulate a concurrent edit. */
  staleAfterFirstGetDesign?: boolean;
}

interface FakeState {
  revision: number;
  parts: DesignerPlacedPart[];
  primitives: string[];
  wires: Array<{ source: string; target: string }>;
}

function makeFakeDesigner(opts: FakeDesignerOptions = {}): { sdk: DesignerSDK; state: FakeState } {
  const state: FakeState = { revision: 0, parts: [], primitives: [], wires: [] };
  let seq = 0;
  let getDesignCalls = 0;
  const projection = (): DesignerSchematicProjection => ({
    designId: "d1",
    revision: state.revision,
    parts: state.parts,
    wires: [],
    labels: [],
    primitives: [],
    junctions: [],
    nets: [],
  });
  const sdk = {
    async getDesign() {
      const revision = opts.staleAfterFirstGetDesign ? getDesignCalls++ : state.revision;
      return {
        head: { revision } as unknown as DesignerDesignRecord["head"],
        entities: [],
      };
    },
    async getSchematicProjection() {
      return projection();
    },
    async getProjectionAndErc() {
      const errors = opts.ercErrors ?? [];
      const erc: ErcReport = {
        designId: "d1",
        revision: state.revision,
        violations: errors.map((e) => ({ code: e.code, severity: "error", message: e.message, anchors: [] })),
        summary: { errors: errors.length, warnings: 0, infos: 0 },
      };
      return { projection: projection(), erc };
    },
    async dispatchCommand(_designId: string, envelope: { baseRevision: number; command: { type: string; [k: string]: unknown } }): Promise<DesignerDispatchResult> {
      if (envelope.baseRevision !== state.revision) {
        return {
          ok: false,
          code: "REVISION_CONFLICT",
          conflict: { expected: envelope.baseRevision, actual: state.revision },
        };
      }
      const cmd = envelope.command;
      state.revision++;
      if (cmd.type === "place_part") {
        const componentId = cmd.componentId as string;
        const partId = `part${seq++}`;
        const pins: DesignerPin[] = (PIN_TABLE[componentId] ?? []).map((d, i) => ({
          id: `${partId}:p${d.number}`,
          originPinKey: d.number,
          number: d.number,
          name: d.name,
          electricalType: "passive",
          unit: 1,
          localPositionNm: { x: 0, y: i * 1_000_000 },
          worldPositionNm: { x: 0, y: i * 1_000_000 },
        }));
        state.parts.push({
          id: partId,
          componentId,
          reference: `P${seq}`,
          value: "",
          rotationDeg: 0,
          mirrored: false,
          positionNm: (cmd.positionNm as { x: number; y: number }) ?? { x: 0, y: 0 },
          pins,
        } as unknown as DesignerPlacedPart);
        return { ok: true, revision: state.revision, createdEntityId: partId };
      }
      if (cmd.type === "create_wire") {
        state.wires.push({ source: cmd.sourcePinId as string, target: cmd.targetPinId as string });
        return { ok: true, revision: state.revision, createdEntityId: `wire${seq++}` };
      }
      if (cmd.type === "place_gnd_port" || cmd.type === "place_pwr_port" || cmd.type === "place_net_portal") {
        const primId = `prim${seq++}`;
        state.primitives.push(primId);
        return { ok: true, revision: state.revision, createdEntityId: primId };
      }
      return { ok: true, revision: state.revision, createdEntityId: null };
    },
  };
  return { sdk: sdk as unknown as DesignerSDK, state };
}

function fakeCtx(
  library: Pick<LibrarySDK, "searchComponents">,
  designer: DesignerSDK,
): CoreBackendModuleContext {
  return {
    sdk: {
      get(token: string) {
        if (token === MODULE_SDK_TOKENS.LIBRARY) return library;
        if (token === MODULE_SDK_TOKENS.DESIGNER) return designer;
        return null;
      },
    },
  } as unknown as CoreBackendModuleContext;
}

function fakeResolver(): ContextResolver {
  return {
    getPrimaryDesign: () => ({ refId: "d1", status: "active" }),
  } as unknown as ContextResolver;
}

function execCtx(): AiToolExecutionContext {
  return {
    runId: "run_test",
    chatId: "chat_test",
    bindings: [],
    limits: { profile: "medium", maxBytes: 64_000, maxItems: 200 },
  };
}
