import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesignerCommand } from "@sdks/designer/types";
import { keyboardPcbProjection } from "./h06-model.fixture";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function boot(page: Page) {
  const model = keyboardPcbProjection();
  const commands: DesignerCommand[] = [];
  const historyCalls: string[] = [];
  await page.route(
    /^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)/,
    (route) => route.abort(),
  );
  await page.route(/\/src\/cloud\/config\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function readCloudConfig() { return {enabled:false}; }`,
    }),
  );
  await page.route(/\/src\/AppRouter\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export {KeyboardSafetyFixture as AppRouter} from '/@fs${repoRoot}/src/modules/designer/frontend/keyboard-safety.fixture.tsx';`,
    }),
  );
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/h06/command")) {
      const command = route.request().postDataJSON() as DesignerCommand;
      commands.push(command);
      if (command.type === "pcb_rotate_placement")
        model.placements[0]!.rotationDeg = command.rotationDeg;
      model.revision += 1;
      await route.fulfill({
        json: { ok: true, revision: model.revision, createdEntityId: null },
      });
    } else if (/\/history\/(undo|redo)$/.test(url)) {
      historyCalls.push(url);
      await route.fulfill({
        json: {
          data: {
            result: {
              ok: true,
              revision: model.revision,
              history: {
                canUndo: true,
                canRedo: true,
                undoDepth: 1,
                redoDepth: 1,
              },
            },
          },
        },
      });
    } else {
      await route.fulfill({
        json: url.endsWith("/registry")
          ? { modules: [] }
          : url.endsWith("/projection/pcb")
            ? { data: { projection: model } }
            : url.includes("/history?")
              ? {
                  data: {
                    history: {
                      canUndo: true,
                      canRedo: true,
                      undoDepth: 1,
                      redoDepth: 1,
                    },
                  },
                }
              : { data: { report: null }, ok: true },
      });
    }
  });
  await page.goto("/");
  await expect(
    page.getByLabel("PCB canvas", { exact: true }).locator("canvas"),
  ).toHaveCount(1);
  return { model, commands, historyCalls };
}

async function inject(
  page: Page,
  key: string,
  options: Record<string, unknown> = {},
) {
  await page.evaluate(
    ({ key, options }) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      ),
    { key, options },
  );
}

const commandsToBlock = ["r", "g", "h", "n", "c", "u", "Delete", "Backspace"];

test("PCB typing in editable surfaces issues zero commands/history writes and preserves API model hash", async ({
  page,
}) => {
  const state = await boot(page);
  const before = hash(state.model);
  for (const field of [
    page.getByLabel("Assistant draft"),
    page.getByLabel("Property"),
    page.getByLabel("Editable draft"),
  ]) {
    await field.focus();
    for (const key of commandsToBlock) await inject(page, key);
    for (const key of ["a", "z", "y"])
      await inject(page, key, { ctrlKey: true });
    for (const key of ["a", "z"]) await inject(page, key, { metaKey: true });
  }
  await page.waitForTimeout(300);
  expect(state.commands).toEqual([]);
  expect(state.historyCalls).toEqual([]);
  expect(hash(state.model)).toBe(before);
});

async function cycleDisplayMode(page: Page) {
  await page.evaluate(async (repoRoot) => {
    const store = await import(
      /* @vite-ignore */ `/@fs${repoRoot}/src/modules/designer/frontend/pcb/pcb-view-store.ts`
    );
    store.usePcbViewStore.setState((state: { viewState: object }) => ({
      viewState: { ...state.viewState, displayMode: "normal" },
    }));
  }, repoRoot);
  const mac = await page.evaluate(async (repoRoot) => {
    const shortcut = await import(
      /* @vite-ignore */ `/@fs${repoRoot}/src/shared/frontend/ui/shortcut.ts`
    );
    return shortcut.isMacPlatform();
  }, repoRoot);
  await inject(page, "h", mac ? { metaKey: true } : { ctrlKey: true });
  const displayMode = await page.evaluate(async (repoRoot) => {
    const store = await import(
      /* @vite-ignore */ `/@fs${repoRoot}/src/modules/designer/frontend/pcb/pcb-view-store.ts`
    );
    return store.usePcbViewStore.getState().viewState.displayMode;
  }, repoRoot);
  return displayMode;
}

test("PCB focused exact action runs once; consumed, IME, repeat and wrong modifiers stay inert", async ({
  page,
}) => {
  const state = await boot(page);
  const root = page.getByLabel("PCB canvas", { exact: true });
  await root.focus();
  const before = hash(state.model);
  for (const options of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
  ])
    await inject(page, "r", options);
  await root.evaluate((element) => {
    element.addEventListener("keydown", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
  });
  await inject(page, "r");
  expect(state.commands).toEqual([]);
  expect(hash(state.model)).toBe(before);
  expect(await cycleDisplayMode(page)).toBe("dim");
  expect(state.commands).toEqual([]);
  expect(hash(state.model)).toBe(before);
  await page.keyboard.press("r");
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.type).toBe("pcb_rotate_placement");
  expect(state.model.placements[0]?.rotationDeg).toBe(90);
});

test("open modal blocks leaked canvas focus; focus loss cancels tool before module remount", async ({
  page,
}) => {
  const state = await boot(page);
  const root = page.getByLabel("PCB canvas", { exact: true });
  await root.focus();
  await page.keyboard.press("m");
  await expect(page.getByLabel("Tool hint")).toContainText("Click start point");
  const armedHint = await page.getByLabel("Tool hint").textContent();
  await page.getByLabel("Assistant draft").focus();
  await expect(page.getByLabel("Tool hint")).not.toHaveText(armedHint ?? "");
  await page.getByRole("button", { name: "Toggle overlay" }).click();
  await root.focus();
  const before = hash(state.model);
  for (const key of commandsToBlock) await inject(page, key);
  await inject(page, "z", { metaKey: true });
  expect(state.commands).toEqual([]);
  expect(state.historyCalls).toEqual([]);
  expect(hash(state.model)).toBe(before);
  await page.getByRole("button", { name: "Toggle overlay" }).click();
  await root.focus();
  await page.keyboard.down("Shift");
  await page.getByRole("button", { name: "Toggle editor" }).click();
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Toggle editor" }).click();
  await expect(page.getByLabel("Tool hint")).not.toHaveText(armedHint ?? "");
  expect(state.commands).toEqual([]);
});

test("schematic typing stays inert; focused select-all/delete dispatches once", async ({
  page,
}) => {
  const state = await boot(page);
  await page.getByRole("button", { name: "Switch canvas" }).click();
  const root = page.getByLabel("Schematic canvas", { exact: true });
  await expect(root.locator("canvas")).toHaveCount(1);
  await root.focus();
  await inject(page, "a", { ctrlKey: true });
  await inject(page, "a", { metaKey: true });
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+r");
  expect(state.commands).toEqual([]);
  const before = hash(state.model);
  await page.getByLabel("Assistant draft").focus();
  for (const key of commandsToBlock) await inject(page, key);
  expect(state.commands).toEqual([]);
  expect(hash(state.model)).toBe(before);
  await root.focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.type).toBe("delete_entity");
});

test("owned route HUD portal retains session while typing width; outside focus abandons it", async ({
  page,
}) => {
  const state = await boot(page);
  const root = page.getByLabel("PCB canvas", { exact: true });
  await root.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await expect(page.getByLabel("Tool hint")).toContainText("Click a pad");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const canvas = root.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(
    page.getByRole("region", { name: "Route status" }),
  ).toBeVisible();
  await page.keyboard.press("Alt+w");
  const width = page.getByRole("spinbutton", { name: "Trace width (mm)" });
  await expect(width).toBeFocused();
  const before = hash(state.model);
  for (const key of commandsToBlock) await inject(page, key);
  expect(state.commands).toEqual([]);
  expect(hash(state.model)).toBe(before);
  await expect(
    page.getByRole("region", { name: "Route status" }),
  ).toBeVisible();
  await width.fill("0.35");
  await width.press("Enter");
  await expect(width).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Route status" }),
  ).toContainText("0.35");
  expect(state.commands).toEqual([]);
  await page.getByLabel("Assistant draft").focus();
  await expect(page.getByRole("region", { name: "Route status" })).toHaveCount(
    0,
  );
  await canvas.dispatchEvent("pointerup", { button: 0, pointerId: 1 });
  expect(state.commands).toEqual([]);
  expect(state.historyCalls).toEqual([]);
  expect(hash(state.model)).toBe(before);
});

async function startRoute(page: Page) {
  const root = page.getByLabel("PCB canvas", { exact: true });
  await root.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await expect(page.getByLabel("Tool hint")).toContainText("Click a pad");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const canvas = root.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const center = { x: box!.width / 2, y: box!.height / 2 };
  await canvas.click({ position: center });
  await expect(
    page.getByRole("region", { name: "Route status" }),
  ).toBeVisible();
  return { root, canvas, center };
}

test("canvas-owned route menu retains session; Escape closes only menu and Finish writes once", async ({
  page,
}) => {
  const state = await boot(page);
  const { root, canvas, center } = await startRoute(page);
  await canvas.click({
    button: "right",
    position: { x: center.x + 80, y: center.y },
  });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const owner = await menu.getAttribute("data-shortcut-owner");
  expect(owner).toBeTruthy();
  await expect(
    page.getByRole("region", { name: "Route status" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(root).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Route status" }),
  ).toBeVisible();
  await canvas.click({
    button: "right",
    position: { x: center.x + 80, y: center.y },
  });
  await page
    .getByRole("menuitem", { name: "Finish route", exact: false })
    .click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.type).toBe("pcb_commit_route");
  await expect(menu).toHaveCount(0);
});

test("leaving owned route menu or changing editor discards stale callbacks without writes", async ({
  page,
}) => {
  const state = await boot(page);
  let { canvas, center } = await startRoute(page);
  await canvas.click({
    button: "right",
    position: { x: center.x + 80, y: center.y },
  });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByLabel("Assistant draft").focus();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Route status" })).toHaveCount(
    0,
  );
  expect(state.commands).toEqual([]);
  ({ canvas, center } = await startRoute(page));
  await canvas.click({
    button: "right",
    position: { x: center.x + 80, y: center.y },
  });
  await page
    .getByRole("button", { name: "Switch canvas" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.evaluate(async (repoRoot) => {
    const store = await import(
      /* @vite-ignore */ `/@fs${repoRoot}/src/shared/frontend/context-menu/use-context-menu-store.ts`
    );
    store.useContextMenuStore.getState().selectFocused();
  }, repoRoot);
  expect(state.commands).toEqual([]);
  expect(state.historyCalls).toEqual([]);
  await page.evaluate(async (repoRoot) => {
    const store = await import(
      /* @vite-ignore */ `/@fs${repoRoot}/src/shared/frontend/context-menu/use-context-menu-store.ts`
    );
    store.openContextMenu({
      scope: "app",
      ownerId: "sibling-owner",
      position: { x: 100, y: 100 },
      groups: [
        {
          id: "sibling",
          items: [
            {
              kind: "action",
              id: "sibling",
              label: "Sibling action",
              onSelect: () => {},
            },
          ],
        },
      ],
    });
  }, repoRoot);
  await expect(page.getByRole("menu")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle editor" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole("menu")).toHaveAttribute(
    "data-shortcut-owner",
    "sibling-owner",
  );
});

test("schematic primitive menu retains rotation actions without unsupported R hints", async ({
  page,
}) => {
  const state = await boot(page);
  await page.getByRole("button", { name: "Switch canvas" }).click();
  const canvas = page
    .getByLabel("Schematic canvas", { exact: true })
    .locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByLabel("Schematic zoom")).not.toHaveText("0");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const box = await canvas.boundingBox();
  await canvas.click({
    button: "right",
    position: { x: box!.width / 2, y: box!.height / 2 },
  });
  const rotate = page.getByRole("menuitem", {
    name: "Rotate 90° clockwise",
    exact: true,
  });
  await expect(rotate).toHaveText("Rotate 90° clockwise");
  await expect(
    page.getByRole("menuitem", {
      name: "Rotate 90° counter-clockwise",
      exact: true,
    }),
  ).toHaveText("Rotate 90° counter-clockwise");
  await rotate.click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.type).toBe("rotate_primitive");
});
