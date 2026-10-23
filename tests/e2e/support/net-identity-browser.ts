import { expect, type Page, type Response } from "@playwright/test";
import type { DesignerCommand, DesignerDispatchResult } from "../../../src/sdks/designer";
import { expectCanvasGeometry } from "./offline-canvas";

export async function commandResult(response: Response): Promise<DesignerDispatchResult> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { data: { result: DesignerDispatchResult } }).data.result;
}

export function waitForCommand(page: Page, matches: (command: DesignerCommand) => boolean): Promise<Response> {
  return page.waitForResponse((response) => {
    if (!response.url().endsWith("/commands") || response.request().method() !== "POST") return false;
    const envelope = response.request().postDataJSON() as { command: DesignerCommand };
    return matches(envelope.command);
  });
}

export async function openDesign(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await reopenDesign(page, name);
}

export async function reopenDesign(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  await page.getByText(name, { exact: true }).first().dblclick();
  await expect(page.getByRole("searchbox", { name: "Filter outline" })).toBeVisible();
}

interface PinDot { x: number; y: number }

/** Locate real rendered pin pixels; no canvas state or test-only editor hooks. */
async function pinDots(page: Page): Promise<PinDot[]> {
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width; surface.height = bitmap.height;
    const context = surface.getContext("2d");
    if (!context) throw new Error("Screenshot decoder has no 2D context");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const pending = new Set<number>();
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!;
      if (b > 140 && r < 110 && b - g > 50) pending.add(index / 4);
    }
    const dots: PinDot[] = [];
    while (pending.size > 0) {
      const first = pending.values().next().value!;
      pending.delete(first);
      const stack = [first]; let count = 0, sx = 0, sy = 0;
      while (stack.length > 0) {
        const index = stack.pop()!, x = index % bitmap.width, y = Math.floor(index / bitmap.width);
        count++; sx += x; sy += y;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx!, ny = y + dy!, next = ny * bitmap.width + nx;
          if (nx >= 0 && nx < bitmap.width && ny >= 0 && ny < bitmap.height && pending.delete(next)) stack.push(next);
        }
      }
      if (count >= 2) dots.push({ x: sx / count, y: sy / count });
    }
    return dots.sort((a, b) => a.x - b.x || a.y - b.y);
  }, png.toString("base64"));
}

export async function dragFirstProbe(page: Page, partId: string): Promise<DesignerDispatchResult> {
  const canvas = page.locator("canvas").first();
  await page.getByRole("button", { name: "Fit schematic", exact: true }).click();
  await expectCanvasGeometry(page, canvas, "Net identity schematic");
  await expect.poll(async () => (await pinDots(page)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(10);
  const [left, right] = await pinDots(page), box = await canvas.boundingBox();
  if (!left || !right || !box) throw new Error("Rendered probe pin pair is unavailable");
  expect(right.x - left.x).toBeGreaterThan(12);
  const x = box.x + (left.x + right.x) / 2, y = box.y + (left.y + right.y) / 2;
  const acknowledgement = waitForCommand(page, (command) => command.type === "batch_commands"
    && command.commands.some((entry) => entry.type === "move_part" && entry.partId === partId));
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(x, y + 100 * step / 8);
  await page.mouse.up();
  await page.mouse.move(x + 120, y - 60);
  return commandResult(await acknowledgement);
}

export async function mergeThroughLabelRename(page: Page, labelId: string): Promise<DesignerDispatchResult> {
  await page.getByRole("group", { name: "Outline view" }).getByRole("button", { name: "Labels", exact: true }).click();
  const row = page.getByRole("button").filter({ has: page.locator('span[title="ROUTED"]') });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Rename", exact: true });
  await input.fill("MAIN");
  const refusal = waitForCommand(page, (command) => command.type === "upsert_label"
    && command.labelId === labelId && command.text === "MAIN" && command.confirmMerge !== true);
  await input.press("Enter");
  expect(await commandResult(await refusal)).toMatchObject({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM" });
  const dialog = page.getByRole("alertdialog", { name: "Merge nets?" });
  await expect(dialog).toBeVisible();
  const acknowledgement = waitForCommand(page, (command) => command.type === "upsert_label"
    && command.labelId === labelId && command.text === "MAIN" && command.confirmMerge === true);
  await dialog.getByRole("button", { name: "Merge nets", exact: true }).click();
  return commandResult(await acknowledgement);
}
