import { describe, expect, test } from "bun:test";

import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import { registerExtendedReadTools } from "../../../modules/assistant/backend/tools/read-tools";

// The manufacturing export REFUSES (422) a board it cannot build faithfully —
// non-through vias, more than four copper layers (contract 15 §7.1). Over MCP
// that is an answer about the design, not a tool crash.

type RegisteredTool = {
  definition: { name: string; description: string; inputSchema: unknown };
  execute(execCtx: unknown, input: unknown): Promise<{
    ok: boolean;
    warnings: string[];
  }>;
};

function exportTool(summary: (...args: unknown[]) => Promise<unknown>): RegisteredTool {
  const tools: RegisteredTool[] = [];
  const registry = { register: (tool: RegisteredTool) => tools.push(tool) };
  const ctx = {
    sdk: { get: () => ({ getManufacturingExportSummary: summary }) },
  } as unknown as CoreBackendModuleContext;
  registerExtendedReadTools(registry as never, ctx);
  const tool = tools.find(
    (t) => t.definition.name === "designer_export_manufacturing",
  );
  if (!tool) throw new Error("designer_export_manufacturing not registered");
  return tool;
}

describe("designer_export_manufacturing", () => {
  test("an export refusal is ok:false with the reason, not a throw", async () => {
    const refusal = Object.assign(new Error("at most four copper layers"), {
      status: 422,
    });
    const tool = exportTool(() => Promise.reject(refusal));
    const result = await tool.execute({ limits: {} }, { designId: "d1" });
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual(["at most four copper layers"]);
  });

  test("any other failure still throws", async () => {
    const tool = exportTool(() => Promise.reject(new Error("boom")));
    await expect(
      tool.execute({ limits: {} }, { designId: "d1" }),
    ).rejects.toThrow("boom");
  });

  test("schema has no includeInnerLayers; a stale input key is accepted and not forwarded", async () => {
    let seen: unknown;
    const tool = exportTool((_id, opts) => {
      seen = opts;
      return Promise.resolve({ bundleName: "b", files: [], warnings: [] });
    });
    expect(JSON.stringify(tool.definition.inputSchema)).not.toContain(
      "includeInnerLayers",
    );
    expect(tool.definition.description).not.toContain(
      "openpcb://design/{id}/export/gerber",
    );
    const result = await tool.execute(
      { limits: {} },
      { designId: "d1", includeInnerLayers: false },
    );
    expect(result.ok).toBe(true);
    expect(seen as object).not.toHaveProperty("includeInnerLayers");
  });
});
