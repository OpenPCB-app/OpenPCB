import { expect, test } from "@playwright/test";
import {
  nativeScreenshot,
  type NativeSession,
} from "./electron-native-helpers";
import {
  editor,
  expectSaved,
  openDocs,
  seedDocument,
} from "./electron-docs-fixtures";

export function registerNativeMenuTest(getSession: () => NativeSession): void {
  test("native context-menu edit roles dispatch clipboard effects", async () => {
    test.skip(
      process.platform !== "darwin",
      "Native first-responder dispatch is macOS-specific",
    );
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native clipboard roles",
      "NATIVE_CLIPBOARD_SELECTION",
    );
    await openDocs(current, document.title);
    const clipboardBefore = await current.app.evaluate(
      ({ clipboard, Menu }) => {
        const before = clipboard.availableFormats().map((format: string) => ({
          format,
          buffer: [...clipboard.readBuffer(format)],
        }));
        const original = Menu.buildFromTemplate;
        Menu.buildFromTemplate = (template: unknown[]) => {
          const menu = original.call(Menu, template);
          const observation = globalThis as unknown as {
            nativeQaMenu: typeof menu;
            nativeQaRoles: Array<{ role: string; enabled: boolean }>;
          };
          observation.nativeQaMenu = menu;
          observation.nativeQaRoles = menu.items.map(
            (item: { role: string; enabled: boolean }) => ({
              role: item.role,
              enabled: item.enabled,
            }),
          );
          return menu;
        };
        clipboard.writeText("NATIVE_PASTE_REPLACEMENT");
        return before;
      },
    );
    try {
      await editor(current).click();
      await current.page.keyboard.press("Meta+A");
      await editor(current).click({ button: "right" });
      const selectedRoles = await current.app.evaluate(
        () =>
          (
            globalThis as unknown as {
              nativeQaRoles: Array<{ role: string; enabled: boolean }>;
            }
          ).nativeQaRoles,
      );
      expect(selectedRoles).toEqual(
        expect.arrayContaining([
          { role: "cut", enabled: true },
          { role: "copy", enabled: true },
          { role: "paste", enabled: true },
        ]),
      );
      await current.app.evaluate(() => {
        (
          globalThis as unknown as { nativeQaMenu: { closePopup(): void } }
        ).nativeQaMenu.closePopup();
      });
      await current.app.evaluate(({ app }) => app.focus({ steal: true }));
      const nativeWindow = await current.app.browserWindow(current.page);
      await nativeWindow.evaluate((window) => {
        window.focus();
        window.webContents.focus();
      });
      await current.page.keyboard.press("Meta+A");
      await current.app.evaluate(({ Menu }) =>
        Menu.sendActionToFirstResponder("copy:"),
      );
      await expect
        .poll(() =>
          current.app.evaluate(({ clipboard }) => clipboard.readText()),
        )
        .toBe("NATIVE_CLIPBOARD_SELECTION");
      await current.app.evaluate(({ Menu }) =>
        Menu.sendActionToFirstResponder("cut:"),
      );
      await expect(editor(current)).toHaveText("");
      expect(
        await current.app.evaluate(({ clipboard }) => clipboard.readText()),
      ).toBe("NATIVE_CLIPBOARD_SELECTION");
      await current.app.evaluate(({ clipboard, Menu }) => {
        clipboard.writeText("NATIVE_PASTE_REPLACEMENT");
        Menu.sendActionToFirstResponder("paste:");
      });
      await expectSaved(
        current,
        document.id,
        document.title,
        "NATIVE_PASTE_REPLACEMENT",
      );
      await current.page.keyboard.press("ArrowRight");
      await editor(current).click({ button: "right" });
      const emptyRoles = await current.app.evaluate(
        () =>
          (
            globalThis as unknown as {
              nativeQaRoles: Array<{ role: string; enabled: boolean }>;
            }
          ).nativeQaRoles,
      );
      expect(emptyRoles).toEqual(
        expect.arrayContaining([
          { role: "cut", enabled: false },
          { role: "copy", enabled: false },
          { role: "paste", enabled: true },
        ]),
      );
      await current.app.evaluate(() =>
        (
          globalThis as unknown as { nativeQaMenu: { closePopup(): void } }
        ).nativeQaMenu.closePopup(),
      );
      await current.info.attach("native-edit-menu-roles.json", {
        body: JSON.stringify(
          {
            selectedRoles,
            emptyRoles,
            execution:
              "macOS native first-responder selectors; physical menu clicks remain unqualified",
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      await nativeScreenshot(current, "native-clipboard-effects");
    } finally {
      await current.app.evaluate(({ clipboard }, before) => {
        clipboard.clear();
        for (const entry of before)
          clipboard.writeBuffer(entry.format, Buffer.from(entry.buffer));
      }, clipboardBefore);
    }
  });
}
