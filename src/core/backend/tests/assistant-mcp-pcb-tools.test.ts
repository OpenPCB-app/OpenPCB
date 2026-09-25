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
    expect(result.structuredContent.summary).toContain("Now: DRC:");
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
    const zone = await h.callTool("pcb_add_zone", {
      designId,
      layer: "B.Cu",
      net,
      region: "board",
    });
    expect(zone.structuredContent.ok).toBe(true);
    const keepout = await h.callTool("pcb_add_keepout", {
      designId,
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

    // Updating applies; deleting is its own, destructive tool and waits.
    const zoneId = after.zones.find((z) => z.layer === "B.Cu")!.id;
    const renamed = await h.callTool("pcb_update_zone", { designId, zoneId, name: "Ground pour" });
    expect(renamed.structuredContent.proposal?.status).toBe("applied");
    const removal = await h.callTool("pcb_delete_zone", { designId, zoneId });
    expect(removal.structuredContent.proposal?.status).toBe("pending");
    const tools = await h.listTools();
    const del = tools.find((t) => t.name === "pcb_delete_zone")!;
    const add = tools.find((t) => t.name === "pcb_add_zone")!;
    expect((del.annotations as { destructiveHint?: boolean }).destructiveHint).toBe(true);
    expect((add.annotations as { destructiveHint?: boolean }).destructiveHint).toBe(false);
  });
});

describe("validation refuses what would be physically wrong", () => {
  test("layers must exist on this board's stack", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Two layers");
    const net = (await layout(designId)).nets[0]!.name;
    const zone = await h.callTool("pcb_add_zone", { designId, layer: "In1.Cu", net, region: "board" });
    expect(zone.structuredContent.ok).toBe(false);
    expect(zone.structuredContent.summary).toContain("not on this 2-layer board");
    const keepout = await h.callTool("pcb_add_keepout", {
      designId,
      layers: ["In2.Cu"],
      pointsMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      forbid: ["tracks"],
    });
    expect(keepout.structuredContent.ok).toBe(false);
    const before = await layout(designId);
    const connection = before.unrouted[0]!;
    const route = await h.callTool("pcb_route", {
      designId,
      traces: [{ net: connection.net, layer: "In1.Cu", from: connection.from, to: connection.to }],
    });
    expect(route.structuredContent.ok).toBe(false);
    expect(route.structuredContent.summary).toContain("F.Cu, B.Cu");
    const zeroWidth = await h.callTool("pcb_route", {
      designId,
      traces: [{ net: connection.net, layer: "F.Cu", from: connection.from, to: connection.to, widthMm: 0 }],
    });
    expect(zeroWidth.structuredContent.ok).toBe(false);
  });

  test("outlines: no invented radius, circles are round, polygons are simple", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Outlines");
    const noRadius = await h.callTool("pcb_set_board_outline", {
      designId,
      shape: "roundrect",
      widthMm: 40,
      heightMm: 30,
    });
    expect(noRadius.structuredContent.ok).toBe(false);
    expect(noRadius.structuredContent.summary).toContain("cornerRadiusMm");
    const tooRound = await h.callTool("pcb_set_board_outline", {
      designId,
      shape: "roundrect",
      widthMm: 40,
      heightMm: 30,
      cornerRadiusMm: 16,
    });
    expect(tooRound.structuredContent.ok).toBe(false);
    const circleWithBox = await h.callTool("pcb_set_board_outline", {
      designId,
      shape: "circle",
      widthMm: 40,
      heightMm: 30,
    });
    expect(circleWithBox.structuredContent.ok).toBe(false);
    const bowtie = await h.callTool("pcb_set_board_outline", {
      designId,
      shape: "polygon",
      pointsMm: [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 20, y: 0 },
        { x: 0, y: 20 },
      ],
    });
    expect(bowtie.structuredContent.ok).toBe(false);
    expect(bowtie.structuredContent.summary).toContain("crosses");

    const circle = await h.callTool("pcb_set_board_outline", { designId, shape: "circle", diameterMm: 30 });
    expect(circle.structuredContent.ok).toBe(true);
    let board = (await h.designer.getPcbProjection(designId))!.board.outline;
    expect([board.kind, board.widthMm, board.heightMm]).toEqual(["circle", 30, 30]);
    const oval = await h.callTool("pcb_set_board_outline", { designId, shape: "oval", widthMm: 40, heightMm: 20 });
    expect(oval.structuredContent.ok).toBe(true);
    board = (await h.designer.getPcbProjection(designId))!.board.outline;
    expect([board.widthMm, board.heightMm]).toEqual([40, 20]);
  });

  test("design rules: positive sizes, drill smaller than pad, unique ids and names", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Rule sanity");
    const zero = await h.callTool("pcb_set_design_rules", {
      designId,
      netClasses: [{ name: "Default", traceWidthMm: 0 }],
    });
    expect(zero.structuredContent.ok).toBe(false);
    expect(zero.structuredContent.summary).toContain("traceWidthMm must be a number > 0");
    const drill = await h.callTool("pcb_set_design_rules", {
      designId,
      netClasses: [{ name: "Fat drill", traceWidthMm: 0.3, clearanceMm: 0.2, viaDiameterMm: 0.6, viaDrillMm: 0.6 }],
    });
    expect(drill.structuredContent.ok).toBe(false);
    expect(drill.structuredContent.summary).toContain("smaller than viaDiameterMm");
    const clearance = await h.callTool("pcb_set_design_rules", {
      designId,
      clearanceMm: { traceToTraceMm: 0 },
    });
    expect(clearance.structuredContent.ok).toBe(false);
    const dupName = await h.callTool("pcb_set_design_rules", {
      designId,
      netClasses: [{ id: "power2", name: "Default", traceWidthMm: 0.3, clearanceMm: 0.2, viaDiameterMm: 0.6, viaDrillMm: 0.3 }],
    });
    expect(dupName.structuredContent.ok).toBe(false);
    expect(dupName.structuredContent.summary).toContain("used twice");
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

describe("stale approvals never apply", () => {
  async function approveExpectingRefusal(designId: string, result: McpToolCallResult) {
    const proposalId = result.structuredContent.proposal!.id;
    const response = await h.fetch(
      `/api/modules/assistant/chats/${chatOf(designId).id}/write-proposals/${proposalId}/apply`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(response.status).toBe(400);
    return proposalId;
  }

  test("an old design-delete proposal cannot delete newer work", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Keep newer work");
    const deletion = await h.callTool("designer_delete_design", { designId });
    expect(deletion.structuredContent.proposal?.status).toBe("pending");

    // The user keeps working after the agent proposed the deletion.
    const moved = await h.callTool("pcb_place_footprints", {
      designId,
      placements: [{ ref: "R1", xMm: -8, yMm: 0 }],
    });
    expect(moved.structuredContent.ok).toBe(true);

    const proposalId = await approveExpectingRefusal(designId, deletion);
    expect(await h.designer.getDesign(designId)).not.toBeNull();

    const record = getAssistantService().conversation.getWriteProposalById(proposalId)!;
    expect(record.status).toBe("failed");
    expect((record.applyResult as { code?: string }).code).toBe("STALE_PROPOSAL");

    const got = await h.callTool("assistant_get_proposal", { proposalId });
    expect(got.structuredContent.summary).toContain("NOT applied");
    expect(got.structuredContent.summary).toContain("design changed");
  });

  test("an old rules proposal is refused the same way", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Rules then edit");
    const rules = await h.callTool("pcb_set_design_rules", {
      designId,
      netClasses: [{ name: "Default", traceWidthMm: 0.35 }],
    });
    expect(rules.structuredContent.proposal?.status).toBe("pending");
    await h.callTool("pcb_place_footprints", {
      designId,
      placements: [{ ref: "R2", xMm: 8, yMm: 0 }],
    });
    await approveExpectingRefusal(designId, rules);
    const pcb = await h.designer.getPcbProjection(designId);
    expect(pcb!.board.netClasses.find((c) => c.id === "default")!.traceWidthMm).not.toBe(0.35);
  });
});

describe("DRC suppression needs the user and is always reported", () => {
  interface DrcData {
    violations: Array<{ id: string; code: string; ruleClass: string; waived?: boolean }>;
    counts: {
      active: number;
      waived: number;
      ignoredByRuleClass: number;
      raw: number;
    };
  }

  async function drc(designId: string): Promise<{ data: DrcData; summary: string }> {
    const result = await h.callTool("designer_run_drc", { designId });
    expect(result.structuredContent.ok).toBe(true);
    return { data: result.structuredContent.data as DrcData, summary: result.structuredContent.summary };
  }

  test("waiving waits for approval, needs a reason and a real id, and stays visible in counts", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Waive me");
    const before = await drc(designId);
    const target = before.data.violations.find((v) => !v.waived)!;
    expect(target).toBeTruthy();
    expect(before.data.counts.raw).toBe(before.data.counts.active);

    const noReason = await h.callTool("pcb_waive_drc_violations", { designId, waive: [target.id] });
    expect(noReason.structuredContent.ok).toBe(false);
    const unknown = await h.callTool("pcb_waive_drc_violations", {
      designId,
      waive: ["TRACE_WIDTH_MIN-v2-0000000000000000"],
      reason: "user accepted",
    });
    expect(unknown.structuredContent.ok).toBe(false);
    expect(unknown.structuredContent.summary).toContain("Not in the current DRC report");

    const waive = await h.callTool("pcb_waive_drc_violations", {
      designId,
      waive: [target.id],
      reason: "User accepts this for the prototype",
    });
    expect(waive.structuredContent.proposal?.status).toBe("pending");
    expect(waive.structuredContent.proposal?.kind).toBe("designer_pcb_drc_waivers");
    expect((await drc(designId)).data.counts.waived).toBe(0);

    await approve(designId, waive);
    const after = await drc(designId);
    expect(after.data.counts.waived).toBe(1);
    expect(after.data.counts.raw).toBe(before.data.counts.raw);
    expect(after.summary).toContain("1 waived");
    expect(after.summary).toContain("not describe the board as clean");

    const unwaive = await h.callTool("pcb_waive_drc_violations", { designId, unwaive: [target.id] });
    expect(unwaive.structuredContent.proposal?.status).toBe("applied");
    expect((await drc(designId)).data.counts.waived).toBe(0);
  });

  test("ignoring a rule class is never covered by a session allowance; hidden violations are counted", async () => {
    h.enable({ writes: true });
    const designId = await twoResistorDesign("Ignore class");
    const before = await drc(designId);
    const ruleClass = before.data.violations[0]!.ruleClass;

    const allow = await h.fetch(
      `/api/modules/assistant/chats/${chatOf(designId).id}/write-policy/session-allow`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "pcb_set_drc_rule_class_ignores",
          proposalKind: "designer_pcb_drc_rule_ignores",
          riskLevel: "high",
        }),
      },
    );
    expect(allow.status).toBe(201);

    const ignore = await h.callTool("pcb_set_drc_rule_class_ignores", {
      designId,
      ignore: [ruleClass],
      reason: "User reviews these by hand",
    });
    expect(ignore.structuredContent.proposal?.status).toBe("pending");
    // The approval card says what the user is agreeing to.
    const card = getAssistantService().conversation.getWriteProposalById(
      ignore.structuredContent.proposal!.id,
    )!;
    expect(card.summary).toContain("would hide");
    expect(card.summary).toContain("User reviews these by hand");

    await approve(designId, ignore);
    const after = await drc(designId);
    expect(after.data.counts.ignoredByRuleClass).toBeGreaterThan(0);
    expect(after.data.counts.raw).toBe(before.data.counts.raw);
    expect(after.summary).toContain("hidden by ignored rule classes");

    const state = await h.callTool("designer_get_pcb_state", { designId });
    expect(
      (state.structuredContent.data as { drcSuppression: { ignoredRuleClasses: string[] } })
        .drcSuppression.ignoredRuleClasses,
    ).toContain(ruleClass);

    const restore = await h.callTool("pcb_set_drc_rule_class_ignores", { designId, unignore: [ruleClass] });
    expect(restore.structuredContent.proposal?.status).toBe("applied");
    expect((await drc(designId)).data.counts.ignoredByRuleClass).toBe(0);
  });
});
