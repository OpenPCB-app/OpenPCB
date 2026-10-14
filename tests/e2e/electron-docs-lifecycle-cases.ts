import { expect, test } from "@playwright/test";
import {
  nativeScreenshot,
  type NativeSession,
} from "./electron-native-helpers";
import {
  documentText,
  documentUrl,
  editor,
  expectNoOpeningWrites,
  expectSaved,
  holdFirstMetadataSave,
  openDocs,
  readDocument,
  remoteWrite,
  seedDocument,
  seedPdf,
  selectDocument,
  typeBody,
  typeTitle,
  undoBody,
} from "./electron-docs-fixtures";

export function registerNativeDocsLifecycleTests(
  getSession: () => NativeSession,
): void {
  test("real PDF alternation and current-page deletion leave editors isolated", async () => {
    const current = getSession();
    const a = await seedDocument(
      current,
      "Native lifecycle A",
      "LIFECYCLE_ALPHA",
    );
    const b = await seedDocument(
      current,
      "Native lifecycle B",
      "LIFECYCLE_BRAVO",
    );
    const pdf = await seedPdf(current);
    await openDocs(current, a.title);
    await current.page.getByText(pdf.title, { exact: true }).click();
    await expect(
      current.page.getByRole("link", { name: "Download" }),
    ).toBeVisible();
    await expect(current.page.locator("canvas")).toBeVisible();
    await expect(editor(current)).toHaveCount(0);
    await nativeScreenshot(current, "real-pdf-rendered");
    await selectDocument(current, a.title);
    await undoBody(current);
    await expect(editor(current)).toHaveText("LIFECYCLE_ALPHA");
    for (const title of [b.title, a.title, b.title, a.title])
      await selectDocument(current, title);
    await expect(
      current.page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
    await current.page
      .getByRole("button", { name: "Delete page", exact: true })
      .click();
    await current.page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(current.page.getByText(a.title, { exact: true })).toHaveCount(
      0,
    );
    await selectDocument(current, b.title);
    await undoBody(current);
    await expect(editor(current)).toHaveText("LIFECYCLE_BRAVO");
    await expectNoOpeningWrites(current, b);
    expect((await fetch(documentUrl(current, a.id))).status).toBe(404);
    expect(current.patches).toEqual([]);
    await nativeScreenshot(current, "after-current-delete");
  });

  test("title navigation before debounce saves only the originating page", async () => {
    const current = getSession();
    const a = await seedDocument(
      current,
      "Native navigation A",
      "Navigation A body",
    );
    const b = await seedDocument(
      current,
      "Native navigation B",
      "Navigation B body",
    );
    await openDocs(current, a.title);
    const title = current.page.getByRole("textbox", { name: "Page title" });
    await title.click();
    await current.page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await current.page.keyboard.type("Native navigation persisted", {
      delay: 0,
    });
    await selectDocument(current, b.title);
    await expect
      .poll(async () => (await readDocument(current, a.id)).title)
      .toBe("Native navigation persisted");
    await undoBody(current);
    await expect(editor(current)).toHaveText("Navigation B body");
    expect(
      current.patches.every(
        (request) => request.url === documentUrl(current, a.id, "/meta"),
      ),
    ).toBe(true);
    expect((await readDocument(current, b.id)).revision).toBe(b.revision);
    await selectDocument(current, "Native navigation persisted");
    await expect(editor(current)).toHaveText("Navigation A body");
    await nativeScreenshot(current, "title-navigation-saved");
  });

  test("real backend409 retains native body and requires explicit conflict resolution", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native backend conflict",
      "Conflict original",
    );
    await openDocs(current, document.title);
    const held = await holdFirstMetadataSave(current, document.id, "content");
    current.expectedResourceFailures.push({
      url: documentUrl(current, document.id, "/content"),
      text: "Failed to load resource: the server responded with a status of 409 (Conflict)",
    });
    try {
      await typeBody(current, "Native stale conditional body");
      await held.entered;
      expect(current.patches[0]?.ifUnmodifiedSince).toBeTruthy();
      await remoteWrite(
        current,
        document.id,
        "content",
        "Native newer remote body",
      );
      held.release();
      await expect
        .poll(
          () =>
            current.responses.filter(
              (response) =>
                response.url ===
                  documentUrl(current, document.id, "/content") &&
                response.status === 409,
            ).length,
        )
        .toBe(1);
      await expect(
        current.page.getByRole("button", { name: "Discard draft and reload" }),
      ).toBeVisible();
      await expect(editor(current)).toHaveText("Native stale conditional body");
      expect(documentText(await readDocument(current, document.id))).toBe(
        "Native newer remote body",
      );
      await nativeScreenshot(current, "real-backend409-retained");
      await held.remove();
      await current.page
        .getByRole("button", { name: "Discard draft and reload" })
        .click();
      await expect(editor(current)).toHaveText("Native newer remote body");
      await undoBody(current);
      await expect(editor(current)).toHaveText("Native newer remote body");
      expect(current.patches).toHaveLength(1);
    } finally {
      held.release();
      await held.remove();
    }
  });

  for (const theme of ["Light", "Dark"] as const) {
    test(`native toolbar and metadata remain correct in ${theme} theme`, async () => {
      const current = getSession();
      const document = await seedDocument(
        current,
        `Native ${theme} toolbar`,
        "Three native words",
      );
      await current.page.getByLabel("Settings", { exact: true }).click();
      await current.page
        .getByRole("button", { name: theme, exact: true })
        .click();
      await expect
        .poll(() =>
          current.page
            .locator("html")
            .evaluate((element) => element.classList.contains("dark")),
        )
        .toBe(theme === "Dark");
      await current.page.keyboard.press("Escape");
      await openDocs(current, document.title);
      const bold = current.page.getByRole("button", {
        name: "Bold",
        exact: true,
      });
      await expect(bold).toHaveAttribute("aria-pressed", "false");
      await expect(
        current.page.getByRole("button", { name: "Undo", exact: true }),
      ).toBeDisabled();
      await expect(
        current.page.getByText("3 words", { exact: true }),
      ).toBeVisible();
      await editor(current).click();
      await current.page.keyboard.press(
        process.platform === "darwin" ? "Meta+A" : "Control+A",
      );
      await bold.click();
      await expect(bold).toHaveAttribute("aria-pressed", "true");
      await expect(editor(current).locator("strong")).toHaveText(
        "Three native words",
      );
      await expectSaved(
        current,
        document.id,
        document.title,
        "Three native words",
      );
      await expect(
        current.page.getByRole("button", { name: "Undo", exact: true }),
      ).toBeEnabled();
      await nativeScreenshot(
        current,
        `${theme.toLowerCase()}-toolbar-metadata`,
      );
    });
  }

  test("native edited time ages while the page stays open", async () => {
    // Acceptance covers aging before open and refresh on save; this covers the
    // periodic metadata re-render with no input. It needs real elapsed time.
    test.setTimeout(150_000);
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native edited time",
      "Aging body",
    );
    await openDocs(current, document.title);
    await expect(
      current.page.getByText("edited just now", { exact: true }),
    ).toBeVisible();
    await expect(
      current.page.getByText("edited 1m ago", { exact: true }),
    ).toBeVisible({ timeout: 100_000 });
    expect(current.patches).toEqual([]);
    expect((await readDocument(current, document.id)).revision).toBe(
      document.revision,
    );
    await nativeScreenshot(current, "edited-time-aged-open");
  });

  test("connection-refused draft survives navigation until explicit retry", async () => {
    const current = getSession();
    const a = await seedDocument(
      current,
      "Native connection A",
      "Server connection A",
    );
    const b = await seedDocument(
      current,
      "Native connection B",
      "Server connection B",
    );
    await openDocs(current, a.title);
    const url = documentUrl(current, a.id, "/content");
    current.expectedResourceFailures.push({
      url,
      text: "Failed to load resource: net::ERR_CONNECTION_REFUSED",
    });
    await current.page.route(url, (route) =>
      route.request().method() === "PATCH"
        ? route.abort("connectionrefused")
        : route.continue(),
    );
    await typeBody(current, "ALL_CONNECTION_ERROR_DRAFT_CHARACTERS");
    await expect(
      current.page.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    await selectDocument(current, b.title);
    await selectDocument(current, a.title);
    await expect(editor(current)).toHaveText(
      "ALL_CONNECTION_ERROR_DRAFT_CHARACTERS",
    );
    await current.page.waitForTimeout(900);
    expect(current.patches).toHaveLength(1);
    expect(documentText(await readDocument(current, a.id))).toBe(
      "Server connection A",
    );
    await nativeScreenshot(current, "connection-draft-retained");
    await current.page.unroute(url);
    await current.page.getByRole("button", { name: "Retry save" }).click();
    await expectSaved(
      current,
      a.id,
      a.title,
      "ALL_CONNECTION_ERROR_DRAFT_CHARACTERS",
    );
    expect(current.patches).toHaveLength(2);
  });

  test("real Docs search navigation resets history without opening writes", async () => {
    const current = getSession();
    const a = await seedDocument(
      current,
      "Native searchable alpha",
      "SEARCH_ALPHA_ONLY",
    );
    const b = await seedDocument(
      current,
      "Native searchable bravo",
      "SEARCH_BRAVO_ONLY",
    );
    await openDocs(current, a.title);
    await typeBody(current, "SEARCH_ALPHA_ONLY edited");
    await expectSaved(current, a.id, a.title, "SEARCH_ALPHA_ONLY edited");
    const writes = current.patches.length;
    await current.page
      .getByPlaceholder("Search...", { exact: true })
      .fill("searchable bravo");
    await current.page.getByRole("button", { name: b.title }).click();
    await expect(
      current.page.getByRole("textbox", { name: "Page title" }),
    ).toHaveValue(b.title);
    await expect(
      current.page.getByPlaceholder("Search...", { exact: true }),
    ).toHaveValue("");
    await undoBody(current);
    await expect(editor(current)).toHaveText("SEARCH_BRAVO_ONLY");
    await current.page.waitForTimeout(900);
    expect(current.patches).toHaveLength(writes);
    expect((await readDocument(current, b.id)).revision).toBe(b.revision);
    await nativeScreenshot(current, "search-navigation-undo");
  });

  test("empty native title normalizes to Untitled and persists", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native blank title",
      "Blank title body",
    );
    await openDocs(current, document.title);
    await typeTitle(current, "");
    await expectSaved(current, document.id, "Untitled", "Blank title body");
    await current.page
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await openDocs(current, "Untitled");
    await expect(editor(current)).toHaveText("Blank title body");
    await nativeScreenshot(current, "empty-title-normalized");
  });
}
