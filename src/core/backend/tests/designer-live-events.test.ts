/**
 * Design change stream + shared undo (docs/assistant/mcp-claude-code.md §1,
 * B4): edits from outside the designer UI — the in-app assistant, MCP clients —
 * must (a) reach the UI's undo stack and (b) be announced on
 * `GET /api/modules/designer/events` so the canvas refreshes.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import type { DesignerCommandEnvelope } from "../../../sdks";
import { bootMcpHarness, type McpHarness } from "./helpers/mcp-harness";

const UI_SESSION = "designer-ui-session";
let h: McpHarness;

beforeAll(async () => {
  h = await bootMcpHarness("designer-live-events");
});

function envelope(
  designId: string,
  baseRevision: number,
  command: DesignerCommandEnvelope["command"],
): DesignerCommandEnvelope {
  return {
    commandId: crypto.randomUUID(),
    sessionId: UI_SESSION,
    aggregateId: designId,
    baseRevision,
    issuedAt: Date.now(),
    command,
  };
}

async function uiCommand(designId: string, baseRevision: number, command: DesignerCommandEnvelope["command"]) {
  const response = await h.fetch(`/api/modules/designer/designs/${designId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope(designId, baseRevision, command)),
  });
  expect(response.ok).toBe(true);
}

/** Collect SSE frames from the designer event stream until `until` matches. */
async function collectEvents(
  designId: string | null,
  action: () => Promise<void>,
  until: (events: Array<Record<string, unknown>>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const controller = new AbortController();
  const query = designId ? `?designId=${encodeURIComponent(designId)}` : "";
  const response = await h.fetch(`/api/modules/designer/events${query}`, {
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value);
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const data = buffer
          .slice(0, split)
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (data) events.push(JSON.parse(data.slice(5)) as Record<string, unknown>);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
      }
      if (until(events)) return;
    }
  })();
  await action();
  await Promise.race([pump, Bun.sleep(3_000)]);
  controller.abort();
  return events;
}

describe("shared undo stack", () => {
  test("the UI's undo reverts the assistant's newer edit, not the user's older one", async () => {
    const design = await h.designer.createDesign({ name: "Shared undo" });
    await uiCommand(design.id, 0, {
      type: "place_part",
      componentId: "openpcb.core.passive.resistor",
      positionNm: { x: 0, y: 0 },
    });
    // The UI reads its history (caching the session) before the agent edits.
    await h.fetch(`/api/modules/designer/designs/${design.id}/history?sessionId=${UI_SESSION}`);
    const head = await h.designer.getDesign(design.id);
    const agent = await h.designer.dispatchCommand(
      design.id,
      envelope(design.id, head!.head.revision, {
        type: "place_part",
        componentId: "openpcb.core.passive.capacitor",
        positionNm: { x: 10_000_000, y: 0 },
      }),
      { actor: "assistant" },
    );
    expect(agent.ok).toBe(true);

    const history = (await (
      await h.fetch(`/api/modules/designer/designs/${design.id}/history?sessionId=${UI_SESSION}`)
    ).json()) as { data: { history: { undoDepth: number } } };
    expect(history.data.history.undoDepth).toBe(2);

    await h.fetch(`/api/modules/designer/designs/${design.id}/history/undo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: UI_SESSION }),
    });
    const parts = (await h.designer.getSchematicProjection(design.id))?.parts ?? [];
    expect(parts.map((p) => p.componentId)).toEqual(["openpcb.core.passive.resistor"]);
  });
});

describe("design event stream", () => {
  test("an MCP write is announced with the assistant as actor", async () => {
    h.enable({ writes: true });
    const created = await h.callTool("designer_create_design", { name: "Streamed design" });
    const designId = (created.structuredContent.data as { design: { id: string } }).design.id;
    const events = await collectEvents(
      designId,
      async () => {
        const placed = await h.callTool("designer_place_components", {
          designId,
          components: [{ componentId: "openpcb.core.passive.resistor", quantity: 1 }],
        });
        expect(placed.structuredContent.ok).toBe(true);
      },
      (evts) => evts.some((e) => e.type === "design.changed"),
    );
    const change = events.find((e) => e.type === "design.changed");
    expect(change?.designId).toBe(designId);
    expect(change?.actor).toBe("assistant");
    expect(typeof change?.revision).toBe("number");
  });

  test("undo, focus requests and deletes are announced", async () => {
    const design = await h.designer.createDesign({ name: "Lifecycle" });
    await uiCommand(design.id, 0, {
      type: "place_part",
      componentId: "openpcb.core.passive.resistor",
      positionNm: { x: 0, y: 0 },
    });
    const events = await collectEvents(
      null,
      async () => {
        await h.designer.undo(design.id, UI_SESSION);
        expect(h.designer.requestFocus(design.id).delivered).toBe(true);
        expect(await h.designer.deleteDesign(design.id)).toBe(true);
      },
      (evts) => evts.some((e) => e.type === "design.deleted"),
    );
    const types = events.filter((e) => e.designId === design.id).map((e) => e.type);
    expect(types).toContain("design.changed");
    expect(types).toContain("design.focus");
    expect(types).toContain("design.deleted");
    expect(events.find((e) => e.type === "design.changed" && e.designId === design.id)?.source).toBe("undo");
    expect(await h.designer.deleteDesign(design.id)).toBe(false);
  });
});
