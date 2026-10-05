import { expect, test } from "@playwright/test";
import {
  nativeScreenshot,
  type NativeSession,
} from "./electron-native-helpers";
import {
  documentText,
  editor,
  expectSaved,
  holdFirstMetadataSave,
  openDocs,
  readDocument,
  seedDocument,
  typeBody,
} from "./electron-docs-fixtures";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

async function replaceTitleWithoutBlur(
  session: NativeSession,
  title: string,
): Promise<void> {
  await session.page.getByRole("textbox", { name: "Page title" }).click();
  await session.page.keyboard.press(`${modifier}+A`);
  await session.page.keyboard.press("Backspace");
  await session.page.keyboard.type(title);
}

export function registerNativeDocsAcceptanceTests(
  getSession: () => NativeSession,
): void {
  test("title-only status never says Saved before native acknowledgement", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native title status",
      "Unchanged title-only body",
    );
    await openDocs(current, document.title);
    const held = await holdFirstMetadataSave(current, document.id);
    try {
      await replaceTitleWithoutBlur(current, "Native title-only acknowledged");
      await expect(
        current.page.getByRole("status", { name: "Page save status" }),
      ).toHaveText("Unsaved", {
        timeout: 250,
      });
      await current.page.keyboard.press("Tab");
      await held.entered;
      await expect(
        current.page.getByRole("status", { name: "Page save status" }),
      ).toHaveText("Saving…");
      await current.page.waitForTimeout(900);
      expect((await readDocument(current, document.id)).title).toBe(
        document.title,
      );
      expect(documentText(await readDocument(current, document.id))).toBe(
        "Unchanged title-only body",
      );
      await expect(
        current.page.getByRole("status", { name: "Page save status" }),
      ).toHaveText("Saving…");
      await nativeScreenshot(current, "title-only-awaiting-ack");
      held.release();
      await expectSaved(
        current,
        document.id,
        "Native title-only acknowledged",
        "Unchanged title-only body",
      );
      expect(current.patches).toHaveLength(1);
    } finally {
      held.release();
      await held.remove();
    }
  });

  test("leaving Docs before title debounce retains the originating rename", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native fast module leave",
      "Module leave body",
    );
    await openDocs(current, document.title);
    const held = await holdFirstMetadataSave(current, document.id);
    try {
      await replaceTitleWithoutBlur(current, "Native fast module rename");
      await current.page
        .getByRole("button", { name: "Home", exact: true })
        .click();
      await held.entered;
      expect((await readDocument(current, document.id)).title).toBe(
        document.title,
      );
      await current.page
        .getByRole("button", { name: "Docs", exact: true })
        .click();
      await current.page.getByText(document.title, { exact: true }).click();
      await expect(
        current.page.getByRole("textbox", { name: "Page title" }),
      ).toHaveValue("Native fast module rename");
      await expect(
        current.page.getByRole("status", { name: "Page save status" }),
      ).toHaveText("Saving…");
      await nativeScreenshot(current, "module-rename-awaiting-ack");
      held.release();
      await expectSaved(
        current,
        document.id,
        "Native fast module rename",
        "Module leave body",
      );
      expect(current.patches).toHaveLength(1);
    } finally {
      held.release();
      await held.remove();
    }
  });

  test("native Bold plain-caret and repeated history states update immediately", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native immediate toolbar",
      "alpha beta gamma",
    );
    await openDocs(current, document.title);
    const bold = current.page.getByRole("button", {
      name: "Bold",
      exact: true,
    });
    const undo = current.page.getByRole("button", {
      name: "Undo",
      exact: true,
    });
    const redo = current.page.getByRole("button", {
      name: "Redo",
      exact: true,
    });
    await editor(current).click();
    await current.page.keyboard.press(`${modifier}+ArrowLeft`);
    for (let i = 0; i < 6; i++) await current.page.keyboard.press("ArrowRight");
    for (let i = 0; i < 4; i++)
      await current.page.keyboard.press("Shift+ArrowRight");
    await bold.click();
    await expect(editor(current).locator("strong")).toHaveText("beta");
    await expect(bold).toHaveAttribute("aria-pressed", "true", {
      timeout: 250,
    });
    await expect(undo).toBeEnabled({ timeout: 250 });
    await current.page.keyboard.press(`${modifier}+ArrowLeft`);
    await expect(bold).toHaveAttribute("aria-pressed", "false", {
      timeout: 250,
    });
    await current.page.keyboard.press(`${modifier}+Z`);
    await expect(undo).toBeDisabled({ timeout: 250 });
    await expect(redo).toBeEnabled({ timeout: 250 });
    await current.page.keyboard.press(`${modifier}+Shift+Z`);
    await expect(undo).toBeEnabled({ timeout: 250 });
    await expect(redo).toBeDisabled({ timeout: 250 });
    await current.page.keyboard.press(`${modifier}+ArrowRight`);
    for (const digit of ["1", "2", "3", "4"]) {
      await current.page.keyboard.type(digit);
      // Separate real native history groups; assertions below precede autosave.
      await current.page.waitForTimeout(600);
    }
    for (let i = 0; i < 4; i++) {
      await current.page.keyboard.press(`${modifier}+Z`);
      await expect(redo).toBeEnabled({ timeout: 250 });
    }
    await expect(editor(current)).toHaveText("alpha beta gamma");
    for (let i = 0; i < 4; i++) {
      await current.page.keyboard.press(`${modifier}+Shift+Z`);
      await expect(undo).toBeEnabled({ timeout: 250 });
      if (i < 3) await expect(redo).toBeEnabled({ timeout: 250 });
    }
    await expect(redo).toBeDisabled({ timeout: 250 });
    await expect(editor(current)).toHaveText("alpha beta gamma1234");
    expect(documentText(await readDocument(current, document.id))).toBe(
      "alpha beta gamma1234",
    );
    await nativeScreenshot(current, "immediate-toolbar-history");
  });

  test("actual empty subpage resets the previous native word count", async () => {
    const current = getSession();
    const parent = await seedDocument(
      current,
      "Native six-word parent",
      "alpha beta gamma delta epsilon zeta",
    );
    await openDocs(current, parent.title);
    await expect(
      current.page.getByText("6 words", { exact: true }),
    ).toBeVisible();
    await current.page.getByText(parent.title, { exact: true }).hover();
    await current.page.getByTitle("Add subpage", { exact: true }).click();
    await expect(
      current.page.getByRole("textbox", { name: "Page title" }),
    ).toHaveValue("Untitled");
    await expect(editor(current)).toHaveText("");
    await expect(
      current.page.getByText("0 words", { exact: true }),
    ).toBeVisible();
    await current.page.waitForTimeout(900);
    expect(current.patches).toEqual([]);
    await nativeScreenshot(current, "new-empty-child-zero-words");
  });

  test("native content acknowledgement refreshes an actually aged edited timestamp", async () => {
    test.setTimeout(120_000);
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native aged metadata",
      "Before aged metadata save",
    );
    // Use elapsed wall time rather than changing clocks or editing the fixture DB.
    await current.page.waitForTimeout(30_000);
    await current.page.waitForTimeout(31_000);
    const before = await readDocument(current, document.id);
    expect(
      Date.now() - new Date(before.updated_at).getTime(),
    ).toBeGreaterThanOrEqual(60_000);
    await openDocs(current, document.title);
    await expect(
      current.page.getByText(/^edited [1-9]\d*m ago$/),
    ).toBeVisible();
    await typeBody(current, "After aged metadata save");
    await expectSaved(
      current,
      document.id,
      document.title,
      "After aged metadata save",
    );
    const after = await readDocument(current, document.id);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
    await expect(
      current.page.getByText("edited just now", { exact: true }),
    ).toBeVisible();
    await current.info.attach("native-edited-timestamp-refresh.json", {
      body: JSON.stringify(
        { before: before.updated_at, after: after.updated_at },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await nativeScreenshot(current, "aged-metadata-after-ack");
  });

  test("empty native title Enter moves body focus and Untitled is searchable", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native Enter blank title",
      "Enter focus body",
    );
    await openDocs(current, document.title);
    await replaceTitleWithoutBlur(current, "");
    await current.page.keyboard.press("Enter");
    await expect(editor(current)).toBeFocused();
    await expectSaved(current, document.id, "Untitled", "Enter focus body");
    await current.page
      .getByPlaceholder("Search...", { exact: true })
      .fill("Untitled");
    await current.page.getByRole("button", { name: "Untitled" }).click();
    await expect(
      current.page.getByRole("textbox", { name: "Page title" }),
    ).toHaveValue("Untitled");
    await expect(editor(current)).toHaveText("Enter focus body");
    await nativeScreenshot(current, "empty-title-enter-search");
  });
}
