import { describe, expect, test } from "bun:test";
import type {
  DesignerSDK,
  DesignerSchematicProjection,
  ErcReport,
} from "../../../sdks";
import { runDefinitionOfDone } from "../../../modules/assistant/backend/verification/run-dod";
import { buildDesignContextSummary } from "../../../modules/assistant/backend/context-summary";
import type { BuildIntentStore } from "../../../modules/assistant/backend/verification/build-intent-store";
import type { BuildIntent } from "../../../modules/assistant/backend/verification/types";

// ── lightweight fakes ─────────────────────────────────────────────────────

function part(id: string, reference: string, componentId: string) {
  return {
    id,
    componentId,
    reference,
    value: "",
    rotationDeg: 0,
    mirrored: false,
    positionNm: { x: 0, y: 0 },
    symbol: {} as never,
    footprint: {} as never,
    pins: [],
    propertiesJson: {},
  };
}

function net(
  id: string,
  name: string,
  pinIds: string[],
  extra: Partial<{
    wireIds: string[];
    labelIds: string[];
    primitiveIds: string[];
  }> = {},
) {
  return {
    id,
    name,
    pinIds,
    wireIds: extra.wireIds ?? [],
    labelIds: extra.labelIds ?? [],
    primitiveIds: extra.primitiveIds ?? [],
  };
}

function schematic(
  overrides: Partial<DesignerSchematicProjection> = {},
): DesignerSchematicProjection {
  return {
    designId: "d1",
    revision: 1,
    parts: [],
    wires: [],
    labels: [],
    primitives: [],
    junctions: [],
    nets: [],
    ...overrides,
  };
}

function ercClean(): ErcReport {
  return {
    designId: "d1",
    revision: 1,
    violations: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
  };
}

function fakeDesigner(opts: {
  schematic: DesignerSchematicProjection | null;
  erc?: ErcReport | null;
  pcbPlacements?: Array<{ partId: string }>;
  /** When true, getProjectionAndErc throws (read failure). */
  projectionAndErcThrows?: boolean;
}): DesignerSDK {
  return {
    getDesign: async () =>
      ({ head: { id: "d1", name: "Test", revision: 1 } }) as never,
    getSchematicProjection: async () => opts.schematic,
    getPcbProjection: async () =>
      opts.pcbPlacements
        ? ({ placements: opts.pcbPlacements, ratsnest: [] } as never)
        : null,
    runErc: async () => opts.erc ?? ercClean(),
    // C2: same-revision snapshot. Returns null when there is no schematic
    // projection; otherwise pairs the projection with the (possibly clean) ERC.
    getProjectionAndErc: async () => {
      if (opts.projectionAndErcThrows) throw new Error("read failed");
      if (!opts.schematic) return null;
      return { projection: opts.schematic, erc: opts.erc ?? ercClean() };
    },
  } as unknown as DesignerSDK;
}

function memoryBuildIntents(intent: BuildIntent | null): BuildIntentStore {
  return {
    save: () => {},
    get: () => intent,
  } as unknown as BuildIntentStore;
}

const noopConversation = {
  listWriteProposals: () => [],
} as never;

const baseInput = {
  conversation: noopConversation,
  chatId: "chat1",
  taskId: "task1",
  designId: "d1",
};

// ── runDefinitionOfDone ────────────────────────────────────────────────────

describe("runDefinitionOfDone", () => {
  test("passes when no design is bound (nothing to verify)", async () => {
    const report = await runDefinitionOfDone({
      ...baseInput,
      designId: null,
      designer: fakeDesigner({ schematic: null }),
      buildIntents: memoryBuildIntents(null),
    });
    expect(report.status).toBe("pass");
    expect(report.failing).toEqual([]);
  });

  test("BOM asks 2 resistors but only 1 placed → bom_placed fails with the missing item", async () => {
    const intent: BuildIntent = {
      chatId: "chat1",
      taskId: "task1",
      goal: "two resistors",
      items: [
        {
          role: "resistor",
          componentId: "comp-R",
          quantity: 2,
          value: "330",
          requiredNets: [],
        },
      ],
    };
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({
        schematic: schematic({ parts: [part("p1", "R1", "comp-R")] }),
      }),
      buildIntents: memoryBuildIntents(intent),
    });
    expect(report.status).toBe("partial");
    expect(report.failing).toContain("bom_placed");
    const bom = report.checks.find((c) => c.id === "bom_placed")!;
    expect(bom.passed).toBe(false);
    expect(bom.affectedIds).toContain("comp-R");
    expect(bom.message).toContain("1/2");
  });

  test("all BOM items placed and required nets wired → pass", async () => {
    const intent: BuildIntent = {
      chatId: "chat1",
      taskId: "task1",
      goal: "led blinker",
      items: [
        {
          role: "led",
          componentId: "comp-LED",
          quantity: 1,
          requiredNets: ["GND"],
        },
      ],
    };
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({
        schematic: schematic({
          parts: [part("p1", "D1", "comp-LED")],
          nets: [net("n1", "GND", ["pa", "pb"], { primitiveIds: ["g1"] })],
        }),
      }),
      buildIntents: memoryBuildIntents(intent),
    });
    expect(report.status).toBe("pass");
    expect(report.failing).toEqual([]);
  });

  test("required net not wired → nets_wired fails", async () => {
    const intent: BuildIntent = {
      chatId: "chat1",
      taskId: "task1",
      goal: "needs gnd",
      items: [
        {
          role: "gnd",
          componentId: "comp-X",
          quantity: 1,
          requiredNets: ["GND"],
        },
      ],
    };
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({
        schematic: schematic({ parts: [part("p1", "X1", "comp-X")] }),
      }),
      buildIntents: memoryBuildIntents(intent),
    });
    expect(report.failing).toContain("nets_wired");
    const check = report.checks.find((c) => c.id === "nets_wired")!;
    expect(check.affectedIds).toContain("GND");
  });

  test("ERC errors (real UNCONNECTED_INPUT_PIN/power_in) → erc_clean + no_dangling_power fail with anchors", async () => {
    // Mirrors erc-engine.ts: a floating power_in pin emits UNCONNECTED_INPUT_PIN
    // at severity "error". A floating signal input emits the same code at
    // severity "warning" — which must NOT count as a dangling power pin.
    const erc: ErcReport = {
      designId: "d1",
      revision: 1,
      violations: [
        {
          code: "UNCONNECTED_INPUT_PIN",
          severity: "error",
          message: "U1 VCC (power_in) is unconnected",
          anchors: [{ kind: "pin", pinId: "pin-vcc" }],
        },
        {
          code: "UNCONNECTED_INPUT_PIN",
          severity: "warning",
          message: "U1 D0 (input) is unconnected",
          anchors: [{ kind: "pin", pinId: "pin-d0" }],
        },
      ],
      summary: { errors: 1, warnings: 1, infos: 0 },
    };
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({ schematic: schematic(), erc }),
      buildIntents: memoryBuildIntents(null),
    });
    expect(report.status).toBe("partial");
    expect(report.failing).toContain("erc_clean");
    expect(report.failing).toContain("no_dangling_power");
    const power = report.checks.find((c) => c.id === "no_dangling_power")!;
    expect(power.affectedIds).toContain("pin-vcc");
    // The warning-severity input pin is NOT a dangling power pin.
    expect(power.affectedIds).not.toContain("pin-d0");
  });

  const buildIntent = (overrides: Partial<BuildIntent> = {}): BuildIntent => ({
    chatId: "chat1",
    taskId: "task1",
    goal: "build something",
    items: [
      {
        role: "resistor",
        componentId: "comp-R",
        quantity: 1,
        requiredNets: ["GND"],
      },
    ],
    ...overrides,
  });

  test("F3: snapshot returns null while a build intent exists → dependent checks FAIL (not pass)", async () => {
    const report = await runDefinitionOfDone({
      ...baseInput,
      // No schematic ⇒ getProjectionAndErc returns null.
      designer: fakeDesigner({ schematic: null }),
      buildIntents: memoryBuildIntents(buildIntent()),
    });
    expect(report.status).toBe("partial");
    expect(report.failing).toContain("bom_placed");
    expect(report.failing).toContain("nets_wired");
    expect(report.failing).toContain("no_dangling_power");
    expect(report.failing).toContain("erc_clean");
  });

  test("F3: getProjectionAndErc throws while a build intent exists → checks FAIL", async () => {
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({
        schematic: schematic(),
        projectionAndErcThrows: true,
      }),
      buildIntents: memoryBuildIntents(buildIntent()),
    });
    expect(report.status).toBe("partial");
    expect(report.failing).toContain("bom_placed");
    expect(report.failing).toContain("erc_clean");
    expect(report.failing).toContain("no_dangling_power");
  });

  test("no intent + no projection → pass (genuinely nothing to verify)", async () => {
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({ schematic: null }),
      buildIntents: memoryBuildIntents(null),
    });
    expect(report.status).toBe("pass");
    expect(report.failing).toEqual([]);
  });

  test("F7b: intent has items but ZERO required nets → nets_wired fails (not vacuous pass)", async () => {
    const intent = buildIntent({
      items: [
        {
          role: "resistor",
          componentId: "comp-R",
          quantity: 1,
          requiredNets: [],
        },
      ],
    });
    const report = await runDefinitionOfDone({
      ...baseInput,
      designer: fakeDesigner({
        schematic: schematic({ parts: [part("p1", "R1", "comp-R")] }),
      }),
      buildIntents: memoryBuildIntents(intent),
    });
    expect(report.status).toBe("partial");
    expect(report.failing).toContain("nets_wired");
    const nets = report.checks.find((c) => c.id === "nets_wired")!;
    expect(nets.passed).toBe(false);
  });
});

// ── buildDesignContextSummary ──────────────────────────────────────────────

describe("buildDesignContextSummary", () => {
  test("counts components/nets and reports unplaced + open nets", async () => {
    const designer = fakeDesigner({
      schematic: schematic({
        parts: [part("p1", "R1", "comp-R"), part("p2", "R2", "comp-R")],
        nets: [
          net("n1", "GND", ["a", "b"], { primitiveIds: ["g1"] }),
          net("n2", "FLOAT", ["solo"]),
        ],
      }),
      pcbPlacements: [{ partId: "p1" }],
    });
    const summary = await buildDesignContextSummary(designer, "d1");
    expect(summary).not.toBeNull();
    expect(summary!.schematic.componentCount).toBe(2);
    expect(summary!.schematic.netCount).toBe(2);
    expect(summary!.schematic.unplaced).toEqual(["R2"]);
    expect(summary!.schematic.openNets).toContain("FLOAT");
    expect(summary!.pcb.placed).toBe(1);
  });

  test("returns null when there is no schematic projection", async () => {
    const designer = fakeDesigner({ schematic: null });
    const summary = await buildDesignContextSummary(designer, "d1");
    expect(summary).toBeNull();
  });
});
