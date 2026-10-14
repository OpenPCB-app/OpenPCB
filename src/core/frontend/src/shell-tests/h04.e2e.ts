import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

test.beforeEach(async ({ page }) => {
  await page.route(
    /^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)/,
    (route) => route.abort(),
  );
  await page.route(/\/src\/cloud\/config\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function readCloudConfig() { return { enabled: false, supabaseUrl: '', supabaseAnonKey: '', apiUrl: '', webUrl: '' }; }`,
    }),
  );
});

const router = `
import React from '/node_modules/.vite/deps/react.js';
import { useNavigationStore } from '/src/stores/navigation-store.ts';
import { ModuleSpaceHost } from '/src/components/ModuleSpaceHost.tsx';
export function AppRouter() {
  const route = useNavigationStore(s => s.currentRoute);
  if (route.kind === 'module') return React.createElement(ModuleSpaceHost, { module: {id:'tasks', namespace:'tasks'} });
  if (window.__rootCrash) throw new Error('Injected root crash');
  return React.createElement('section', {},
    React.createElement('input', {'aria-label':'Draft', defaultValue:'Unsaved draft'}),
    React.createElement('div', {contentEditable:true, 'aria-label':'Document'}, 'Editable text'),
    React.createElement('div', {'data-testid':'handled-row', onContextMenu:e => e.preventDefault()}, 'Handled row'),
    React.createElement('canvas', {'data-testid':'canvas', width:100, height:100}),
    React.createElement('button', {}, 'Recovery focus'),
    React.createElement('p', {'data-testid':'selected-text'}, 'Selectable chrome text'));
}`;

async function boot(page: Page): Promise<void> {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/registry")
        ? {
            modules: [
              {
                id: "tasks",
                namespace: "tasks",
                status: "loaded",
                sidebar: { label: "Tasks", icon: "List", order: 1 },
              },
            ],
          }
        : { ok: true },
    }),
  );
  await page.route(/\/src\/AppRouter\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: router }),
  );
  await page.route(
    /\/src\/modules\/tasks\/module\.frontend\.ts(?:\?.*)?$/,
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `
    import React from '/node_modules/.vite/deps/react.js';
    export default {Space: () => { if (window.__moduleCrash) throw new Error('Injected module crash'); return React.createElement('p', {}, 'Tasks recovered'); }};
  `,
      }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Draft", exact: true }),
  ).toBeVisible();
}

async function importStore(
  page: Page,
  name: string,
  script: string,
): Promise<unknown> {
  return page.evaluate(
    async ({ name, script, repoRoot }) => {
      const module = await import(
        /* @vite-ignore */ `/@fs${repoRoot}/src/shared/frontend/${name}`
      );
      return new Function("module", script)(module);
    },
    { name, script, repoRoot },
  );
}

test("mounted hosts resolve queued dialogs once and restore the body", async ({
  page,
}) => {
  await boot(page);
  await importStore(
    page,
    "ui/dialog-host-store.ts",
    `
    module.confirmDialog({title:'Confirm fixture'}).then(value => window.__confirmResult=value);
    module.promptDialog({title:'Prompt fixture', defaultValue:'draft'}).then(value => window.__promptResult=value);
  `,
  );
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Prompt fixture" }).fill("changed");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate("window.__confirmResult")).toBe(true);
  await expect
    .poll(() => page.evaluate("window.__promptResult"))
    .toBe("changed");
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(
    1,
  );
  await expect
    .poll(() => page.evaluate("document.body.style.pointerEvents"))
    .not.toBe("none");
});

test("module render crash preserves navigation and offers explicit scoped recovery", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate("window.__moduleCrash = true");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Unsaved");
  await expect(
    page.getByRole("button", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.evaluate("window.__moduleCrash = false");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Tasks recovered")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft", exact: true }),
  ).toBeVisible();
});

test("global errors remain diagnosed and use persistent safe actionable notices", async ({
  page,
}) => {
  await boot(page);
  const prevented = await page.evaluate(`(() => {
    const event = new PromiseRejectionEvent('unhandledrejection', {promise:Promise.resolve(), reason:new Error('token=secret fixture'), cancelable:true});
    window.dispatchEvent(event); return event.defaultPrevented;
  })()`);
  expect(prevented).toBe(false);
  const notice = page.getByRole("region", { name: "Notifications" });
  await expect(notice.getByRole("alert")).toBeVisible();
  await expect(notice).not.toContainText("secret");
  await expect(
    notice.getByRole("button", { name: "Copy details", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(8200);
  await expect(notice.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Draft", exact: true }),
  ).toHaveValue("Unsaved draft");
});

for (const [width, height] of [
  [1100, 720],
  [1440, 900],
  [1920, 1080],
] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`menu dispatch, focus and measured bounds ${width}×${height} ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme });
      await boot(page);
      const input = page.getByRole("textbox", { name: "Draft", exact: true });
      for (const target of [
        input,
        page.getByLabel("Document"),
        page.getByTestId("handled-row"),
        page.getByTestId("canvas"),
      ]) {
        await target.click({ button: "right" });
        await expect(page.getByTestId("app-context-menu")).toHaveCount(0);
      }
      await page.getByRole("button", { name: "Recovery focus" }).focus();
      await page
        .getByRole("button", { name: "Recovery focus" })
        .click({ button: "right" });
      const settingsShortcut = await page.evaluate(() =>
        /mac/i.test(navigator.platform) ? "⌘," : "Ctrl+,",
      );
      await expect(page.getByTestId("app-context-menu")).toContainText(
        settingsShortcut,
      );
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Recovery focus" }),
      ).toBeFocused();
      await importStore(
        page,
        "context-menu/index.ts",
        `module.openContextMenu({scope:'app',position:{x:${width - 1},y:${height - 1}},title:'Long menu title fixture',groups:[{id:'fixture',label:'Group title',items:[
        {kind:'action',id:'disabled',label:'Disabled item with a very long label',disabled:true,onSelect:()=>{}},
        {kind:'separator'},
        {kind:'action',id:'first',label:'First',onSelect:()=>window.__selected='first'},
        {kind:'action',id:'last',label:'Last',onSelect:()=>window.__selected='last'}]}]});`,
      );
      const menu = page.getByTestId("app-context-menu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 7);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height - 7);
      await expect(menu).toHaveCSS(
        "background-color",
        await page.evaluate(
          `(() => {const element = document.createElement('div'); element.style.backgroundColor='var(--menu-bg)'; document.body.append(element); const color=getComputedStyle(element).backgroundColor; element.remove(); return color;})()`,
        ),
      );
      await page.keyboard.press("End");
      await expect(
        page.getByRole("menuitem", { name: "Last", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Recovery focus" }),
      ).toBeFocused();
      const mode = colorScheme === "dark" ? "light" : "dark";
      await page.emulateMedia({ colorScheme: mode });
      await expect(page.locator("html")).toHaveAttribute(
        "data-color-mode",
        mode,
      );
      await expect(input).toHaveValue("Unsaved draft");
      const response = await page.request.get("/favicon.svg");
      expect(response.headers()["content-type"]).toContain("image/svg+xml");
    });
  }
}

test("root recovery keeps runtime hosts mounted through explicit reset", async ({
  page,
}) => {
  await page.route(/\/src\/AppShell\.tsx(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "export function AppShell() {",
        `export function AppShell() { if (window.__rootCrash) throw new Error('Injected shell crash');`,
      ),
    });
  });
  await page.addInitScript("window.__rootCrash = true");
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/registry")
        ? { modules: [] }
        : { ok: true },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "OpenPCB stopped working" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(
    1,
  );
  await importStore(
    page,
    "ui/dialog-host-store.ts",
    `module.confirmDialog({title:'Recovery confirmation'}).then(value => window.__confirmResult=value);`,
  );
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate("window.__confirmResult")).toBe(false);
  await expect
    .poll(() => page.evaluate("document.body.style.pointerEvents"))
    .not.toBe("none");
  await page.evaluate("window.__rootCrash = false");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(
    1,
  );
});

test("oversized menu remains bounded, scrollable and keyboard actionable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await boot(page);
  await importStore(
    page,
    "context-menu/index.ts",
    `module.openContextMenu({scope:'app',position:{x:1099,y:719},groups:[{id:'long',items:Array.from({length:80},(_,i)=>({kind:'action',id:String(i),label:'Action '+i,onSelect:()=>window.__selected=i}))}]});`,
  );
  const menu = page.getByTestId("app-context-menu");
  await expect(menu).toBeVisible();
  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(713);
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Action 79", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate("window.__selected")).toBe(79);
  await expect(menu).toHaveCount(0);
});

test("system theme updates DOM before scheduling React mode", async ({
  page,
}) => {
  await page.route(
    /\/src\/providers\/ThemeProvider\.tsx(?:\?.*)?$/,
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain("setMode(nextMode);");
      await route.fulfill({
        response,
        body: body.replace(
          "setMode(nextMode);",
          `
      if (document.documentElement.dataset.colorMode !== nextMode) window.__themeMismatch=true;
      setMode(nextMode);
    `,
        ),
      });
    },
  );
  await page.addInitScript("window.__themeMismatch = false");
  await page.emulateMedia({ colorScheme: "dark" });
  await boot(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-mode",
    "light",
  );
  expect(await page.evaluate("window.__themeMismatch")).toBe(false);
});

test("selected chrome text keeps the native Copy menu path unprevented", async ({
  page,
}) => {
  await boot(page);
  const text = page.getByTestId("selected-text");
  await text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await page.evaluate(
    `window.addEventListener('contextmenu', event => {window.__nativeMenuAllowed=!event.defaultPrevented}, {once:true});`,
  );
  await text.click({ button: "right" });
  await expect(page.getByTestId("app-context-menu")).toHaveCount(0);
  expect(await page.evaluate("window.__nativeMenuAllowed")).toBe(true);
});
