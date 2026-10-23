import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { DesignerHistoryActionResult, DesignerPcbProjection } from "../../src/sdks/designer";
import { commandResult, dragFirstProbe, mergeThroughLabelRename, openDesign, reopenDesign, waitForCommand } from "./support/net-identity-browser";
import { drc, identity, pcb, schematic, seedIdentityScene, type IdentityScene } from "./support/net-identity-fixture";

// The rendered-pin locator targets the light theme's saturated blue terminals.
test.use({ colorScheme: "light" });

function copperAndRules(board: DesignerPcbProjection) {
  return { traces: board.traces, vias: board.vias,
    assignments: board.board.perNetClassAssignments,
    lengthGroups: board.board.lengthMatchGroups, rules: board.board.drcRules };
}

async function expectStoredReferences(request: APIRequestContext, scene: IdentityScene, netId: string): Promise<void> {
  const board = await pcb(request, scene.id);
  expect(board.traces.map((trace) => trace.id)).toEqual(scene.before.traces.map((trace) => trace.id));
  expect(board.traces.map((trace) => trace.netId)).toEqual([netId]);
  expect(board.traces.map((trace) => trace.pointsNm)).toEqual(scene.before.traces.map((trace) => trace.pointsNm));
  expect(board.board.perNetClassAssignments).toEqual({ [netId]: scene.before.board.netClasses[0]!.id });
  expect(board.board.lengthMatchGroups?.[0]?.netIds).toEqual([netId]);
  expect(board.board.drcRules?.[0]?.scopes).toEqual([{ kind: "net", netIds: [netId] }]);
}

async function expectOrphans(request: APIRequestContext, scene: IdentityScene, count: number): Promise<void> {
  const report = await drc(request, scene.id);
  const rows = report.violations.filter((entry) => entry.code === "NET_ORPHANED_COPPER");
  expect(rows).toHaveLength(count);
  if (count > 0) expect(rows[0]?.anchors).toEqual([{ kind: "trace", traceId: scene.before.traces[0]!.id }]);
  expect((await identity(request, scene.id)).orphanedCopperCount).toBe(count);
}

async function verifyMoveAndReopen(page: Page, request: APIRequestContext, scene: IdentityScene): Promise<void> {
  const before = await schematic(request, scene.id), part = scene.parts[0]!;
  await openDesign(page, scene.name);
  expect((await dragFirstProbe(page, part.id)).ok).toBe(true);
  const moved = await schematic(request, scene.id);
  expect(moved.parts.find((entry) => entry.id === part.id)?.positionNm).not.toEqual(part.positionNm);
  expect(moved.nets).toEqual(before.nets);
  expect(copperAndRules(await pcb(request, scene.id))).toEqual(copperAndRules(scene.before));
  expect((await pcb(request, scene.id)).ratsnest.filter((entry) => entry.netId === scene.routedId)).toEqual([]);
  await page.reload();
  await reopenDesign(page, scene.name);
  expect((await schematic(request, scene.id)).nets).toEqual(before.nets);
  expect(copperAndRules(await pcb(request, scene.id))).toEqual(copperAndRules(scene.before));
}

async function mergeAndInspect(page: Page, request: APIRequestContext, scene: IdentityScene): Promise<void> {
  // Outline label rename deliberately joins named nets; physical wire drawing
  // and the separate S12 drag-merge gate are outside this browser scenario.
  const merged = await mergeThroughLabelRename(page, scene.routedLabelId);
  expect(merged.ok).toBe(true);
  if (!merged.ok) throw new Error("UI merge was not acknowledged");
  expect(merged.netIdentity?.events).toEqual([expect.objectContaining({
    kind: "merge", survivorNetId: scene.largerId, hasDependents: true,
    retired: expect.arrayContaining([expect.objectContaining({ netId: scene.routedId })]),
  })]);
  const nets = (await schematic(request, scene.id)).nets;
  expect(nets.find((entry) => entry.id === scene.largerId)?.pinIds).toHaveLength(5);
  expect(nets.some((entry) => entry.id === scene.routedId)).toBe(false);
  await expectStoredReferences(request, scene, scene.routedId);
  const toast = page.getByRole("status").filter({ hasText: "Net identity changed" });
  await expect(toast).toContainText("merged into 'MAIN'");
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await page.getByRole("tab", { name: "PCB", exact: true }).click();
  await expect(page.getByRole("status", { name: "1 unread net changes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "DRC", exact: true }).click();
  const panel = page.getByRole("region", { name: "Net identity", exact: true });
  await expect(panel.getByRole("group", { name: scene.routedId, exact: true })).toContainText("Reason: retired");
  await expect(panel).toContainText("Recent net changes");
  await expect(panel).toContainText("merged into 'MAIN'");
  await expect(page.getByRole("status", { name: "1 unread net changes", exact: true })).toHaveCount(0);
  await expectOrphans(request, scene, 1);
}

async function repairFromPanel(page: Page, request: APIRequestContext, scene: IdentityScene): Promise<void> {
  const panel = page.getByRole("region", { name: "Net identity", exact: true });
  const group = panel.getByRole("group", { name: scene.routedId, exact: true });
  const repair = group.getByRole("button", { name: "Accept suggestion: MAIN", exact: true });
  await expect(repair).toBeEnabled();
  const acknowledgement = waitForCommand(page, (command) => command.type === "pcb_rebind_net_references"
    && command.bindings.length === 1 && command.bindings[0]?.fromNetId === scene.routedId
    && command.bindings[0]?.toNetId === scene.largerId);
  await repair.click();
  const result = await commandResult(await acknowledgement);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Suggested repair was not acknowledged");
  expect(result.netIdentity?.events ?? []).toEqual([]);
  expect(result.netRebind).toMatchObject({ traces: 1, assignments: 1, lengthGroups: 1, drcRules: 1 });
  await expect(panel.getByLabel("Repair receipt")).toContainText("Updated: 1 traces");
  await expect(panel).toContainText("Identity references resolved.");
  await expectStoredReferences(request, scene, scene.largerId);
  await expectOrphans(request, scene, 0);
}

async function historyFromPcb(page: Page, scene: IdentityScene, action: "undo" | "redo"): Promise<void> {
  const response = page.waitForResponse((entry) => entry.url().endsWith(`/designs/${scene.id}/history/${action}`)
    && entry.request().method() === "POST"
    && (entry.request().postDataJSON() as { sessionId: string }).sessionId === "designer-pcb-session");
  await page.getByRole("toolbar", { name: "PCB tools" }).getByRole("button", {
    name: action === "undo" ? "Undo" : "Redo", exact: true,
  }).click();
  const acknowledgement = await response;
  expect(acknowledgement.ok()).toBe(true);
  const result = (await acknowledgement.json() as { data: { result: DesignerHistoryActionResult } }).data.result;
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.netIdentity?.events ?? []).toEqual([]);
  await expect(page.getByText("Net identity changed", { exact: true })).toHaveCount(0);
}

test("durable routed net survives drag, then explicit UI merge is repaired with undo and reopen", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const scene = await seedIdentityScene(request);
  await verifyMoveAndReopen(page, request, scene);
  await mergeAndInspect(page, request, scene);
  await repairFromPanel(page, request, scene);
  await historyFromPcb(page, scene, "undo");
  await expectStoredReferences(request, scene, scene.routedId);
  await expectOrphans(request, scene, 1);
  await historyFromPcb(page, scene, "redo");
  await expectStoredReferences(request, scene, scene.largerId);
  await expectOrphans(request, scene, 0);
  await page.reload();
  await reopenDesign(page, scene.name);
  await page.getByRole("tab", { name: "PCB", exact: true }).click();
  await expect(page.getByRole("button", { name: "DRC", exact: true })).toBeVisible();
  await expectStoredReferences(request, scene, scene.largerId);
  await expectOrphans(request, scene, 0);
  await page.screenshot({ path: info.outputPath("net-identity-repaired.png") });
  await info.attach("Durable net identity fixture", { body: JSON.stringify({
    designId: scene.id, retiredNetId: scene.routedId, survivorNetId: scene.largerId,
    traceIds: scene.before.traces.map((entry) => entry.id),
  }, null, 2), contentType: "application/json" });
});
