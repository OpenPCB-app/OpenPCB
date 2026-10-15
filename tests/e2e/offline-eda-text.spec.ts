import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page, Route } from "@playwright/test";
import type { DesignerCommand, DesignerPcbProjection, DesignerSchematicProjection } from "../../src/sdks";
import { test, expect } from "./support/assistant-agentkit-fixture";
import { expectCanvasGeometry, installedCanvasPackage, repinPending } from "./support/offline-canvas";

/*
 * OPENPCB-53 (H05) browser-mode acceptance on the isolated runtime. The fixture
 * aborts and records every off-host request except, until the r3f-eda-canvas
 * re-pin, Troika's font resolver (recorded as tolerated). Expectations that need
 * the offline text runtime are fixme'd while the installed package predates it.
 */

test.use({ trace: "off", video: "off" });

const canvasPackage = installedCanvasPackage();
const FONT_ROUTE = "**/fonts/eda/NotoSans-Regular.ttf";
const FONT_BYTES = readFileSync(path.resolve("src/core/frontend/public/fonts/eda/NotoSans-Regular.ttf"));

interface Session { page: Page; backend: string; designId: string; componentId: string }

async function dispatch(page: Page, command: DesignerCommand): Promise<string | null> {
  const result = await page.evaluate(async (command) => {
    const dispatch = window.__openpcbCapture?.dispatch;
    if (!dispatch) throw new Error("Designer dispatcher unavailable");
    return dispatch(command);
  }, command);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.ok ? result.createdEntityId : null;
}

async function projection<T>(s: Session, view: "schematic" | "pcb"): Promise<T> {
  const response = await s.page.request.get(`${s.backend}/api/modules/designer/designs/${s.designId}/projection/${view}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { data: { projection: T } }).data.projection;
}

async function openDesign(page: Page, origin: string, backend: string, componentId: string): Promise<Session> {
  // The capture bridge (dispatch / sync) is keyed on the preload flag.
  await page.addInitScript(() => {
    const api = (window as { electronAPI?: Record<string, unknown> }).electronAPI;
    Object.defineProperty(window, "electronAPI", { configurable: true, value: { ...api, captureMode: true } });
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  const created = page.waitForResponse((res) => res.url().endsWith("/api/modules/designer/designs") && res.request().method() === "POST");
  await page.getByRole("button", { name: "New Design" }).first().click();
  const designId = (await (await created).json() as { data: { design: { id: string } } }).data.design.id;
  await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__openpcbCapture?.selectedDesignId)).toBe(designId);
  return { page, backend, designId, componentId };
}

async function readyCanvas(page: Page, area: Locator): Promise<Locator> {
  const canvas = area.locator("canvas").first();
  // A new HTML canvas is visible at 300x150 before R3F measures its container.
  await expect.poll(async () => {
    const [actual, expected] = await Promise.all([canvas.boundingBox(), area.boundingBox()]);
    return !!actual && !!expected && Math.abs(actual.width - expected.width) < 2 && Math.abs(actual.height - expected.height) < 2;
  }).toBe(true);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  return canvas;
}

/** Schematic, PCB, 3D and Library preview; `check` runs once per mounted canvas. */
async function visitCanvasSurfaces(s: Session, check: (canvas: Locator, surface: string) => Promise<void>): Promise<void> {
  const { page } = s;
  await dispatch(page, { type: "place_part", componentId: s.componentId, positionNm: { x: 0, y: 0 } });
  await dispatch(page, { type: "upsert_label", text: "VCC", positionNm: { x: 5_080_000, y: 0 } });

  await page.getByRole("button", { name: "Fit schematic" }).click();
  await check(await readyCanvas(page, page.getByLabel("Schematic canvas", { exact: true })), "schematic");

  await page.getByRole("tab", { name: "PCB", exact: true }).click();
  const pcb = await readyCanvas(page, page.getByLabel("PCB canvas", { exact: true }));
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  await check(pcb, "pcb");

  await page.getByTestId("designer-view-3d").click();
  await expect(page.getByTestId("designer-3d-board-geometry")).toBeAttached({ timeout: 20_000 });
  await check(await readyCanvas(page, page.getByTestId("designer-3d-canvas")), "3d");

  await page.getByRole("button", { name: /Library/ }).first().click();
  await page.getByTestId(`library-component-row-${s.componentId}`).dblclick();
  await check(await readyCanvas(page, page.getByTestId("footprint-preview-canvas")), "library-preview");
}

async function attachScreenshot(page: Page, name: string): Promise<void> {
  await test.info().attach(`${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
}

test("every EDA canvas surface renders geometry with off-host requests recorded", async ({ page, agentkit, offHostRequests }) => {
  const s = await openDesign(page, agentkit.origin, agentkit.bootstrap.url, agentkit.componentId);
  await visitCanvasSurfaces(s, async (canvas, surface) => {
    await expectCanvasGeometry(page, canvas, surface);
    await attachScreenshot(page, surface);
  });
  // The fixture constrains the off-host requests; this only reports them.
  test.info().annotations.push({ type: "r3f-eda-canvas", description:
    `${canvasPackage.version}, denied ${offHostRequests.denied.length}, tolerated ${offHostRequests.tolerated.length}` });
});

test("every EDA canvas renders geometry offline and makes zero off-host requests", async ({ page, agentkit, offHostRequests }) => {
  test.fixme(!canvasPackage.offlineText, repinPending(canvasPackage));
  const s = await openDesign(page, agentkit.origin, agentkit.bootstrap.url, agentkit.componentId);
  await visitCanvasSurfaces(s, async (canvas, surface) => {
    await expectCanvasGeometry(page, canvas, surface);
    await attachScreenshot(page, surface);
  });
  expect([...offHostRequests.denied, ...offHostRequests.tolerated], "Cold-offline canvases must not go off-host").toEqual([]);
});

const FONT_FAILURES: Array<{ name: string; respond: (route: Route) => Promise<void> }> = [
  { name: "HTTP 404", respond: (route) => route.fulfill({ status: 404, body: "missing" }) },
  { name: "corrupt bytes", respond: (route) => route.fulfill({ status: 200, contentType: "font/ttf",
    body: FONT_BYTES.subarray(0, 1024) }) },
  // A structurally valid font whose bytes no longer match the pinned SHA-256.
  { name: "SHA-256 mismatch", respond: (route) => route.fulfill({ status: 200, contentType: "font/ttf",
    body: Buffer.concat([FONT_BYTES, Buffer.alloc(4)]) }) },
];

for (const failure of FONT_FAILURES) {
  test(`bundled font ${failure.name}: geometry still renders with fallback markers`, async ({ page, agentkit, offHostRequests }) => {
    test.fixme(!canvasPackage.offlineText, repinPending(canvasPackage));
    const fontRequests: string[] = [];
    await page.route(FONT_ROUTE, async (route) => { fontRequests.push(route.request().url()); await failure.respond(route); });
    const s = await openDesign(page, agentkit.origin, agentkit.bootstrap.url, agentkit.componentId);
    await visitCanvasSurfaces(s, async (canvas, surface) => {
      await expectCanvasGeometry(page, canvas, `${surface} with ${failure.name}`);
      await attachScreenshot(page, `${surface}-${failure.name.replace(/\W+/g, "-")}`);
    });
    // One verified font generation: a failed font is not retried, and nothing falls back to a CDN.
    expect(fontRequests).toHaveLength(1);
    expect([...offHostRequests.denied, ...offHostRequests.tolerated]).toEqual([]);
  });
}

test("Unicode and transformed labels render offline and survive save/reopen verbatim", async ({ page, agentkit, offHostRequests }) => {
  test.fixme(!canvasPackage.offlineText, repinPending(canvasPackage));
  const s = await openDesign(page, agentkit.origin, agentkit.bootstrap.url, agentkit.componentId);
  // Greek, Cyrillic, micro and ohm are covered by the bundled font; CJK must show the replacement glyph.
  const labels = ["Ω_µ_ΔV", "ЖИЛА_3V3", "电源_中"];
  for (const [index, text] of labels.entries())
    await dispatch(page, { type: "upsert_label", text, positionNm: { x: 0, y: (index + 1) * 2_540_000 } });
  const rotated = await dispatch(page, { type: "place_part", componentId: s.componentId,
    positionNm: { x: 10_160_000, y: 0 }, rotationDeg: 90, mirrored: true });
  expect(rotated).toBeTruthy();
  await dispatch(page, { type: "update_part_properties", partId: rotated!, value: "4.7µF Ω" });
  await page.getByRole("button", { name: "Fit schematic" }).click();
  const schematic = await readyCanvas(page, page.getByLabel("Schematic canvas", { exact: true }));
  await expectCanvasGeometry(page, schematic, "schematic Unicode labels");
  await attachScreenshot(page, "schematic-unicode-rotated-mirrored");

  await page.getByRole("tab", { name: "PCB", exact: true }).click();
  const pcb = await readyCanvas(page, page.getByLabel("PCB canvas", { exact: true }));
  const silk = [
    { layer: "F.SilkS", text: "Ωµ Ж", rotationDeg: 90, mirror: false },
    { layer: "B.SilkS", text: "Ω 中", rotationDeg: 180, mirror: true },
  ] as const;
  for (const [index, item] of silk.entries())
    await dispatch(page, { type: "pcb_add_overlay_text", ...item, positionMm: { x: 5 * index, y: 5 }, fontSizeMm: 1 });
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  await expectCanvasGeometry(page, pcb, "PCB rotated/mirrored silk text");
  await attachScreenshot(page, "pcb-unicode-rotated-mirrored");
  test.info().annotations.push({ type: "visual-review",
    description: "Greek/Cyrillic/µ/Ω legible, CJK as '?' replacement, rotated + mirrored labels readable" });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible();
  const schematicAfter = await projection<DesignerSchematicProjection>(s, "schematic");
  expect(schematicAfter.labels.map((label) => label.text)).toEqual(expect.arrayContaining(labels));
  expect(schematicAfter.parts.find((part) => part.id === rotated)?.value).toBe("4.7µF Ω");
  const pcbAfter = await projection<DesignerPcbProjection>(s, "pcb");
  expect(pcbAfter.overlayTexts.map((text) => text.text)).toEqual(expect.arrayContaining(silk.map((item) => item.text)));
  expect([...offHostRequests.denied, ...offHostRequests.tolerated]).toEqual([]);
});
