import { createHash } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import type { DesignerCommand, DesignerPcbProjection, DesignerSchematicProjection } from "../../src/sdks";
import { test, expect } from "./support/assistant-agentkit-fixture";

/*
 * T-133 (OPENPCB-54 / H06) production-consumer acceptance: the real Assistant
 * composer, comment composer + thread, free-pad inspector select and Export
 * dialog, on the isolated authenticated runtime (temp-dir SQLite, fixture
 * model). Typing shortcut letters inside them must issue zero design commands
 * or history writes and leave the persisted design hash unchanged, also after
 * reload. A final canvas Delete is the positive control that the same key
 * path is live.
 */

test.use({ trace: "off", video: "off" });

const SHORTCUT_KEYS = ["r", "v", "w", "g", "h", "n", "c", "u", "Delete", "Backspace",
  "ControlOrMeta+z", "ControlOrMeta+Shift+z", "Control+y", "ControlOrMeta+a"];

const PAD: DesignerCommand = { type: "pcb_add_free_pad", centerMm: { x: 0, y: 0 }, rotationDeg: 0,
  padType: "smd", shape: "rect", widthMm: 1.5, heightMm: 1.5, layer: "F.Cu" };

interface Harness { page: Page; backend: string; designId: string; writes: string[] }

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function projection<T>(h: Harness, view: "schematic" | "pcb"): Promise<T> {
  const response = await h.page.request.get(`${h.backend}/api/modules/designer/designs/${h.designId}/projection/${view}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { data: { projection: T } }).data.projection;
}

/** Persisted design state as the backend serves it (not the renderer's copy). */
async function designHash(h: Harness): Promise<string> {
  return sha256({
    schematic: await projection<DesignerSchematicProjection>(h, "schematic"),
    pcb: await projection<DesignerPcbProjection>(h, "pcb"),
  });
}

/** Every design command or history write the renderer sends. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (/\/designer\/designs\/[^/]+\/commands$/.test(path) || /\/history\/(undo|redo)$/.test(path))
      writes.push(path);
  });
  return writes;
}

async function dispatch(page: Page, command: DesignerCommand): Promise<void> {
  const result = await page.evaluate(async (command) => {
    const dispatch = window.__openpcbCapture?.dispatch;
    if (!dispatch) throw new Error("Designer dispatcher unavailable");
    return dispatch(command);
  }, command);
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

async function settled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__openpcbCapture?.sync?.().pendingCommands)).toBe(0);
}

/** Types every shortcut into `field` and asserts nothing reached the design. */
async function typeShortcuts(h: Harness, field: Locator): Promise<void> {
  await settled(h.page);
  const before = { writes: h.writes.length, hash: await designHash(h) };
  await field.focus();
  for (const key of SHORTCUT_KEYS) {
    await expect(field).toBeFocused();
    await h.page.keyboard.press(key);
  }
  await settled(h.page);
  expect(h.writes.slice(before.writes), "design commands / history writes").toEqual([]);
  expect(await designHash(h)).toBe(before.hash);
}

async function imeEscape(field: Locator): Promise<void> {
  await field.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown",
    { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
}

async function readyCanvas(page: Page, label: "Schematic canvas" | "PCB canvas"): Promise<Locator> {
  const area = page.getByLabel(label, { exact: true });
  // A new HTML canvas is visible at 300x150 before R3F measures its container.
  await expect.poll(() => area.locator("canvas").evaluate((node, label) => {
    const expected = node.closest(`[aria-label="${label}"]`)!.getBoundingClientRect();
    const actual = node.getBoundingClientRect();
    return Math.abs(actual.width - expected.width) < 1 && Math.abs(actual.height - expected.height) < 1;
  }, label)).toBe(true);
  return area;
}

async function openDesign(page: Page, origin: string, backend: string): Promise<Harness> {
  // The capture bridge (dispatch / sync / canvas projection) is keyed on the preload flag.
  await page.addInitScript(() => {
    const api = (window as { electronAPI?: Record<string, unknown> }).electronAPI;
    Object.defineProperty(window, "electronAPI", { configurable: true, value: { ...api, captureMode: true } });
  });
  const writes = recordWrites(page);
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  const created = page.waitForResponse((res) => res.url().endsWith("/api/modules/designer/designs") && res.request().method() === "POST");
  await page.getByRole("button", { name: "New Design" }).first().click();
  const designId = (await (await created).json() as { data: { design: { id: string } } }).data.design.id;
  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__openpcbCapture?.selectedDesignId)).toBe(designId);
  return { page, backend, designId, writes };
}

test("shortcut letters in production text/select/dialog surfaces never mutate the persisted design", async ({ page, agentkit }) => {
  const h = await openDesign(page, agentkit.origin, agentkit.bootstrap.url);
  await dispatch(page, { type: "place_gnd_port", positionNm: { x: 0, y: 0 } });

  await test.step("Assistant composer", async () => {
    await page.getByTitle("Open the assistant (⌘/Ctrl+I)").click();
    const composer = page.getByPlaceholder("Ask about this design…");
    await expect(composer).toBeEnabled();
    await typeShortcuts(h, composer);
    await composer.fill("");
  });

  await test.step("Comment composer keeps its draft through IME Escape", async () => {
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const canvas = await readyCanvas(page, "Schematic canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const composer = page.getByPlaceholder(/^Add a comment/);
    await expect(composer).toBeFocused();
    await typeShortcuts(h, composer);
    await composer.fill("H06 draft survives IME");
    await imeEscape(composer);
    await expect(composer).toHaveValue("H06 draft survives IME");
    await composer.press("ControlOrMeta+Enter");
    await expect(composer).toHaveCount(0);
  });

  await test.step("Comment thread: menu, then popup, close one Escape at a time", async () => {
    const reply = page.getByPlaceholder("Reply to thread…");
    await expect(reply).toBeVisible();
    await typeShortcuts(h, reply);
    await reply.fill("");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(reply).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reply).toHaveCount(0);
  });

  await test.step("Free-pad inspector select", async () => {
    await page.getByRole("tab", { name: "PCB", exact: true }).click();
    const canvas = await readyCanvas(page, "PCB canvas");
    await dispatch(page, PAD);
    await settled(page);
    await page.getByRole("button", { name: "Fit board", exact: true }).click();
    const projected = await page.evaluate(() => window.__openpcbCapture!.pcb!.project({ x: 0, y: 0 }));
    expect(projected.onScreen).toBe(true);
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + projected.x, box.y + projected.y);
    await page.getByRole("tablist", { name: "Side panel" }).getByRole("tab", { name: "Properties", exact: true }).click();
    const layer = page.getByRole("combobox", { name: "Layer", exact: true });
    await expect(layer).toHaveValue("F.Cu");
    await typeShortcuts(h, layer);
    await expect(layer).toHaveValue("F.Cu");
  });

  await test.step("Export dialog: keys stay inside, Escape closes and restores focus", async () => {
    const opener = page.getByTestId("pcb-export-button");
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Export manufacturing files" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Running DRC…")).toHaveCount(0);
    await typeShortcuts(h, dialog.getByRole("checkbox", { name: "Include BOM CSV" }));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  await test.step("Persisted design survives reload unchanged", async () => {
    const before = { writes: h.writes.length, hash: await designHash(h) };
    await page.reload();
    await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
    expect(await designHash(h)).toBe(before.hash);
    expect(h.writes.slice(before.writes)).toEqual([]);
    await page.getByRole("button", { name: "Designer", exact: true }).first().click();
    await expect(page.getByRole("tab", { name: "PCB", exact: true })).toBeVisible();
  });

  await test.step("Positive control: focused canvas Delete removes the selected pad", async () => {
    await page.getByRole("tab", { name: "PCB", exact: true }).click();
    const canvas = await readyCanvas(page, "PCB canvas");
    await page.getByRole("button", { name: "Fit board", exact: true }).click();
    const projected = await page.evaluate(() => window.__openpcbCapture!.pcb!.project({ x: 0, y: 0 }));
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + projected.x, box.y + projected.y);
    const writes = h.writes.length;
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await projection<DesignerPcbProjection>(h, "pcb")).freePads.length).toBe(0);
    expect(h.writes.length).toBeGreaterThan(writes);
  });
});
