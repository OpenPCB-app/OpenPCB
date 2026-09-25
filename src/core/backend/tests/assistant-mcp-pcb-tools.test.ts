/**
 * MCP-only PCB and design tools against the real runtime: placement, routing
 * by net name and pad address, approval-gated deletions and rule changes, the
 * undo ownership guard, zones/keepouts, design management.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getAssistantService } from "../../../modules/assistant/backend/assistant-service";
import type { DesignerCommandEnvelope } from "../../../sdks";
import { bootMcpHarness, type McpHarness, type McpToolCallResult } from "./helpers/mcp-harness";

let h: McpHarness;

beforeAll(async () => {
  h = await bootMcpHarness("assistant-mcp-pcb-tools");
});

interface Layout {
  revision: number;
  placements: Array<{
    ref: string;
    positionMm: { x: number; y: number };
    rotationDeg: number;
    side: string;
    pads?: Array<{ pad: string; net: string | null; xMm: number; yMm: number }>;
  }>;
  nets: Array<{ name: string; pads: string[]; traces: number; unrouted: number }>;
  unrouted: Array<{ net: string; from: string; to: string }>;
  traces?: Array<{ id: string; net: string; layer: string }>;
  zones: Array<{ id: string; net: string | null; layer: string }>;
  keepouts: Array<{ id: string }>;
}

/** Two resistors with R1.2 wired to R2.1 → one unrouted connection on the board. */
async function twoResistorDesign(name: string): Promise<string> {
  const created = await h.callTool("designer_create_design", { name });
  const designId = (created.structuredContent.data as { design: { id: string } }).design.id;
  await h.callTool("designer_place_components", {
    designId,
    components: [{ componentId: "openpcb.core.passive.resistor", quantity: 2 }],
  });
  const wired = await h.callTool("designer_propose_schematic_wires", {
    designId,
    title: "Join",
    summary: "R1.2 to R2.1",
    wires: [{ source: "R1.2", target: "R2.1" }],
  });
  expect(wired.structuredContent.ok).toBe(true);
  // Auto-sync drops footprints wherever there is room; pin them on a line so
  // the R1.2 → R2.1 route is a clear straight run in every test.
  const placed = await h.callTool("pcb_place_footprints", {
    designId,
    placements: [
      { ref: "R1", xMm: -6, yMm: 0, rotationDeg: 0 },
      { ref: "R2", xMm: 6, yMm: 0, rotationDeg: 0 },
    ],
  });
  expect(placed.structuredContent.ok).toBe(true);
  return designId;
}

async function layout(designId: string): Promise<Layout> {
  const result = await h.callTool("designer_get_pcb_layout", { designId });
  expect(result.structuredContent.ok).toBe(true);
  return result.structuredContent.data as Layout;
}

function chatOf(designId: string) {
  return getAssistantService()
    .conversation.listChats()
    .find(
      (c) =>
        (c.metadata as { designId?: string; mcp?: unknown } | null)?.designId === designId &&
        Boolean((c.metadata as { mcp?: unknown }).mcp),
    )!;
}

async function approve(designId: string, result: McpToolCallResult): Promise<void> {
  const proposalId = result.structuredContent.proposal!.id;
  const response = await h.fetch(
    `/api/modules/assistant/chats/${chatOf(designId).id}/write-proposals/${proposalId}/apply`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  expect(response.ok).toBe(true);
}

async function routeFirstUnrouted(designId: string): Promise<McpToolCallResult> {
  const before = await layout(designId);
  const connection = before.unrouted[0]!;
  return h.callTool("pcb_route", {
    designId,
    action_id: `route_${connection.net}_${designId}`,
    traces: [{ net: connection.net, layer: "F.Cu", from: connection.from, to: connection.to }],
  });
}

describe("placement and routing", () => {
  test("footprints move by reference designator", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Place me");
    const result = await h.callTool("pcb_place_footprints", {
      designId,
      placements: [
        { ref: "R1", xMm: 5, yMm: 5, rotationDeg: 90 },
        { ref: "R2", xMm: -5, yMm: 5 },
      ],
    });
    expect(result.structuredContent.proposal?.status).toBe("applied");
    expect(result.structuredContent.ok).toBe(true);
    const after = await layout(designId);
    const r1 = after.placements.find((p) => p.ref === "R1")!;
    expect(r1.positionMm).toEqual({ x: 5, y: 5 });
    expect(r1.rotationDeg).toBe(90);
    expect(after.placements.find((p) => p.ref === "R2")!.positionMm).toEqual({ x: -5, y: 5 });
  });

  test("a net routes pad to pad by name and the connection is no longer unrouted", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Route me");
    const before = await layout(designId);
    expect(before.unrouted.length).toBe(1);
    const result = await routeFirstUnrouted(designId);
    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.summary).toContain("DRC now reports");
    expect(result.structuredContent.proposal?.status).toBe("applied");
    const after = await layout(designId);
    expect(after.unrouted.length).toBe(0);
    expect(after.traces!.length).toBeGreaterThan(0);
    // Re-sending the same action_id does not duplicate copper.
    const again = await h.callTool("pcb_route", {
      designId,
      action_id: `route_${before.unrouted[0]!.net}_${designId}`,
      traces: [
        {
          net: before.unrouted[0]!.net,
          layer: "F.Cu",
          from: before.unrouted[0]!.from,
          to: before.unrouted[0]!.to,
        },
      ],
    });
    expect(again.structuredContent.ok).toBe(true);
    expect((await layout(designId)).traces!.length).toBe(after.traces!.length);
  });

  test("routing refuses a pad that is not on the named net", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Wrong pad");
    const before = await layout(designId);
    const net = before.unrouted[0]!.net;
    const foreign = before.placements
      .flatMap((p) => (p.pads ?? []).map((pad) => ({ address: `${p.ref}.${pad.pad}`, net: pad.net })))
      .find((pad) => pad.net !== net)!;
    const result = await h.callTool("pcb_route", {
      designId,
      traces: [{ net, layer: "F.Cu", from: before.unrouted[0]!.from, to: foreign.address }],
    });
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error?.message).toContain("is on net");
  });

  test("deleting routing waits for approval, then removes the copper", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Delete routing");
    await routeFirstUnrouted(designId);
    const routed = await layout(designId);
    const net = routed.traces![0]!.net;
    const result = await h.callTool("pcb_delete_routing", { designId, nets: [net] });
    expect(result.structuredContent.proposal?.status).toBe("pending");
    expect((await layout(designId)).traces!.length).toBe(routed.traces!.length);
    await approve(designId, result);
    expect((await layout(designId)).traces!.length).toBe(0);
  });
});

describe("board and rules", () => {
  test("the board outline changes", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Outline");
    const result = await h.callTool("pcb_set_board_outline", {
      designId,
      shape: "rect",
      widthMm: 40,
      heightMm: 25,
      centerMm: { x: 0, y: 0 },
    });
    expect(result.structuredContent.ok).toBe(true);
    const state = await h.callTool("designer_get_pcb_state", { designId });
    const board = (state.structuredContent.data as { board: { widthMm: number; heightMm: number } }).board;
    expect([board.widthMm, board.heightMm]).toEqual([40, 25]);
  });

  test("rule changes are never auto-applied", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Rules");
    const result = await h.callTool("pcb_set_design_rules", {
      designId,
      netClasses: [{ name: "Default", traceWidthMm: 0.3 }],
    });
    expect(result.structuredContent.proposal?.status).toBe("pending");
    await approve(designId, result);
    const pcb = await h.designer.getPcbProjection(designId);
    expect(pcb!.board.netClasses.find((c) => c.id === "default")!.traceWidthMm).toBe(0.3);
  });

  test("a new net class without explicit values is refused rather than guessed", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("No guessing");
    const result = await h.callTool("pcb_set_design_rules", {
      designId,
      netClasses: [{ name: "HighCurrent", traceWidthMm: 1 }],
    });
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error?.message).toContain("clearanceMm");
  });

  test("a board ground pour and a keepout can be added", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Pours");
    const net = (await layout(designId)).nets[0]!.name;
    const zone = await h.callTool("pcb_manage_zone", {
      designId,
      action: "add",
      layer: "B.Cu",
      net,
      region: "board",
    });
    expect(zone.structuredContent.ok).toBe(true);
    const keepout = await h.callTool("pcb_manage_keepout", {
      designId,
      action: "add",
      layers: ["F.Cu"],
      pointsMm: [
        { x: 10, y: 5 },
        { x: 14, y: 5 },
        { x: 14, y: 9 },
        { x: 10, y: 9 },
      ],
      forbid: ["tracks", "vias"],
    });
    expect(keepout.structuredContent.ok).toBe(true);
    const after = await layout(designId);
    expect(after.zones.some((z) => z.layer === "B.Cu")).toBe(true);
    expect(after.keepouts.length).toBe(1);
  });
});

describe("history", () => {
  test("undo reverts this session's own change but refuses the user's", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Undo guard");
    await routeFirstUnrouted(designId);
    expect((await layout(designId)).traces!.length).toBeGreaterThan(0);

    const undo = await h.callTool("designer_undo", { designId });
    expect(undo.structuredContent.ok).toBe(true);
    expect((await layout(designId)).traces!.length).toBe(0);

    // The user now edits in the UI; Claude must not undo that.
    const head = await h.designer.getDesign(designId);
    const pcb = await h.designer.getPcbProjection(designId);
    const envelope: DesignerCommandEnvelope = {
      commandId: crypto.randomUUID(),
      sessionId: "designer-ui-session",
      aggregateId: designId,
      baseRevision: head!.head.revision,
      issuedAt: Date.now(),
      command: {
        type: "pcb_move_placement",
        placementId: pcb!.placements[0]!.id,
        positionMm: { x: 3, y: 3 },
      },
    };
    const user = await h.fetch(`/api/modules/designer/designs/${designId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    expect(user.ok).toBe(true);
    const refused = await h.callTool("designer_undo", { designId });
    expect(refused.structuredContent.ok).toBe(false);
    expect(refused.structuredContent.error?.message).toContain("not made by this session");
    expect((await h.designer.getPcbProjection(designId))!.placements[0]!.positionMm).toEqual({ x: 3, y: 3 });

    const history = await h.callTool("designer_get_history", { designId });
    expect((history.structuredContent.data as { nextUndo?: { commandType: string } }).nextUndo?.commandType).toBe(
      "pcb_move_placement",
    );
  });

  test("a stale expectedRevision is refused", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Stale undo");
    await routeFirstUnrouted(designId);
    const result = await h.callTool("designer_undo", { designId, expectedRevision: 0 });
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.error?.message).toContain("moved to revision");
  });
});

describe("design management", () => {
  test("rename, focus, and delete-with-approval", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Before rename");
    const renamed = await h.callTool("designer_rename_design", { designId, name: "After rename" });
    expect(renamed.structuredContent.ok).toBe(true);
    expect((await h.designer.getDesign(designId))!.head.name).toBe("After rename");

    const focus = await h.callTool("designer_focus_design", { designId });
    expect(focus.structuredContent.ok).toBe(true);

    const deletion = await h.callTool("designer_delete_design", { designId });
    expect(deletion.structuredContent.proposal?.status).toBe("pending");
    expect(await h.designer.getDesign(designId)).not.toBeNull();
    await approve(designId, deletion);
    expect(await h.designer.getDesign(designId)).toBeNull();
  });

  test("with writes off only the read tools are listed", async () => {
    h.enable({ writes: false });
    const names = (await h.listTools()).map((t) => t.name as string);
    expect(names).toContain("designer_get_pcb_layout");
    expect(names).toContain("designer_get_history");
    expect(names).not.toContain("pcb_route");
    expect(names).not.toContain("designer_delete_design");
  });
});
