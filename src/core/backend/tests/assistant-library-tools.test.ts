import { describe, expect, test } from "bun:test";
import type { AiTool, AiToolExecutionContext } from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import { makeLibraryResolveBomTool, makeLibrarySearchComponentsTool } from "../../../modules/assistant/backend/tools/library-tools";
import { MODULE_SDK_TOKENS, type LibraryComponent, type LibrarySDK } from "../../../sdks";

const COMPONENTS: LibraryComponent[] = [
  component("openpcb.core.ic.ne555-soic-8", "NE555 Timer SOIC-8", ["ic", "timer", "555", "soic-8"]),
  component("openpcb.core.opto.led", "LED", ["led", "opto", "diode"]),
  component("openpcb.core.transistor.npn-sot-23-ebc", "NPN Transistor SOT-23 EBC", ["transistor", "bjt", "npn", "sot-23"]),
  component("openpcb.core.passive.resistor", "Resistor", ["passive", "builtin", "system"]),
  component("openpcb.core.passive.capacitor", "Capacitor", ["passive", "builtin", "system"]),
];

interface SearchOutput {
  rewrittenQuery: string;
  normalizedRequirements: Record<string, string | string[]>;
  results: Array<{ componentId: string; name: string }>;
  noLocalMatch: boolean;
}

interface BomOutput {
  readyForPlacement: boolean;
  defaults: { supplyVoltage: string; blinkRate: string; packagePreference: string };
  items: Array<{
    role: string;
    value: string | null;
    selected: { componentId: string; name: string } | null;
    attributes: Record<string, string | string[] | number | boolean>;
    status: string;
  }>;
}

describe("assistant library tools", () => {
  test("search resolves color-specific LED query to generic LED", async () => {
    const tool = makeLibrarySearchComponentsTool(fakeCtx()) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), { query: "LED red", limit: 3 });
    const data = result.data as SearchOutput;

    expect(result.ok).toBe(true);
    expect(data.noLocalMatch).toBe(false);
    expect(data.rewrittenQuery).toBe("led");
    expect(data.results[0]?.componentId).toBe("openpcb.core.opto.led");
    expect(data.normalizedRequirements.attributes).toContain("color:red");
  });

  test("search resolves order-insensitive transistor query", async () => {
    const tool = makeLibrarySearchComponentsTool(fakeCtx()) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), { query: "transistor NPN", limit: 3 });
    const data = result.data as SearchOutput;

    expect(data.noLocalMatch).toBe(false);
    expect(data.results[0]?.componentId).toBe("openpcb.core.transistor.npn-sot-23-ebc");
  });

  test("BOM resolver carries defaults and instance attributes", async () => {
    const tool = makeLibraryResolveBomTool(fakeCtx()) as unknown as AiTool<unknown, unknown>;

    const result = await tool.execute(execCtx(), {
      goal: "Two opposite blinking LEDs with a 555 timer",
      items: [
        { role: "timer", query: "555 timer", quantity: 1 },
        { role: "red indicator", query: "LED red", quantity: 1 },
        { role: "green indicator", query: "LED green", quantity: 1 },
        { role: "current limit", query: "330 ohm resistor", quantity: 2, value: "330Ω" },
        { role: "timing capacitor", query: "10uF capacitor", quantity: 1, value: "10µF" },
      ],
    });
    const data = result.data as BomOutput;

    expect(result.ok).toBe(true);
    expect(data.readyForPlacement).toBe(true);
    expect(data.defaults.supplyVoltage).toBe("5V");
    expect(data.defaults.blinkRate).toBe("~1Hz");
    expect(data.items.find((item) => item.role === "red indicator")?.selected?.componentId).toBe("openpcb.core.opto.led");
    expect(data.items.find((item) => item.role === "red indicator")?.attributes.color).toBe("red");
    expect(data.items.find((item) => item.role === "current limit")?.value).toBe("330Ω");
  });
});

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

function fakeCtx(): CoreBackendModuleContext {
  const library: Pick<LibrarySDK, "searchComponents"> = {
    async searchComponents(params) {
      const query = params.query?.trim().toLowerCase() ?? "";
      const tags = params.tags ?? [];
      const filtered = COMPONENTS.filter((component) => {
        const text = `${component.name} ${component.description}`.toLowerCase();
        if (query && !text.includes(query)) return false;
        for (const tag of tags) {
          if (!component.tags.includes(tag)) return false;
        }
        return true;
      });
      return filtered.slice(0, params.limit ?? 25);
    },
  };
  return {
    sdk: {
      get(token: string) {
        return token === MODULE_SDK_TOKENS.LIBRARY ? library : null;
      },
    },
  } as unknown as CoreBackendModuleContext;
}

function execCtx(): AiToolExecutionContext {
  return {
    runId: "run_test",
    chatId: "chat_test",
    bindings: [],
    limits: { profile: "medium", maxBytes: 64_000, maxItems: 200 },
  };
}
