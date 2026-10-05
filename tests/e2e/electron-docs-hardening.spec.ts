import { registerNativeDocsLifecycleTests } from "./electron-docs-lifecycle-cases";
import { registerNativeMenuTest } from "./electron-native-menu-cases";
import { registerNativeDocsAcceptanceTests } from "./electron-docs-acceptance-cases";
import { registerNativeDocsRecoveryTests } from "./electron-docs-recovery-cases";
import { expect, test } from "@playwright/test";
import {
  closeNativeSession,
  createNativeProfile,
  launchNativeProfile,
  nativeScreenshot,
  preserveNativeDatabase,
  type NativeProfile,
  type NativeSession,
} from "./electron-native-helpers";
import {
  documentText,
  editor,
  expectNoOpeningWrites,
  expectSaved,
  holdFirstMetadataSave,
  openDocs,
  readDocument,
  rejectBodySaves,
  remoteWrite,
  seedDocument,
  selectDocument,
  typeBody,
  typeTitle,
  undoBody,
} from "./electron-docs-fixtures";

test.describe("Electron Docs development regressions", () => {
  test.describe.configure({ mode: "default", retries: 0 });
  test.skip(
    !process.env.OPENPCB_E2E_NO_WEBSERVER,
    "Native tests require OPENPCB_E2E_NO_WEBSERVER=1 and fresh development bundles",
  );
  test.skip(
    Boolean(process.env.OPENPCB_ELECTRON_EXECUTABLE),
    "This development harness does not qualify packaged distribution binaries",
  );
  let profile: NativeProfile;
  let session: NativeSession | null = null;

  test.beforeEach(async ({}, info) => {
    profile = await createNativeProfile();
    session = await launchNativeProfile(profile, info, "initial");
  });

  test.afterEach(async ({}, info) => {
    try {
      if (session) await closeNativeSession(session);
    } finally {
      session = null;
      if (profile) await preserveNativeDatabase(profile, info);
    }
  });

  test("native title acknowledgement preserves continuous body typing", async () => {
    const current = session!;
    const page = await seedDocument(current, "Native race", "Saved body");
    await openDocs(current, page.title);
    await expectNoOpeningWrites(current, page);
    const metadata = await holdFirstMetadataSave(current, page.id);
    try {
      await typeTitle(current, "Native title saved");
      await metadata.entered;
      await typeBody(current, "Native body");
      const typing = current.page.keyboard.type(" continuous body typing", {
        delay: 60,
      });
      await expect(editor(current)).toContainText("continuous");
      metadata.release();
      await typing;
      await expectSaved(
        current,
        page.id,
        "Native title saved",
        "Native body continuous body typing",
      );
      await nativeScreenshot(current, "title-body-race-saved");
    } finally {
      metadata.release();
      await metadata.remove();
    }
  });

  test("native 500 draft survives page/module switches until explicit Retry save", async () => {
    const current = session!;
    const a = await seedDocument(current, "Native retained A", "Stored A");
    const b = await seedDocument(current, "Native retained B", "Stored B");
    await openDocs(current, a.title);
    const restore = await rejectBodySaves(current, a.id);
    await typeBody(current, "Unsaved retained native draft");
    await expect(
      current.page.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    expect(current.patches).toHaveLength(1);
    await selectDocument(current, b.title);
    await expect(editor(current)).toHaveText("Stored B");
    await selectDocument(current, a.title);
    await expect(editor(current)).toHaveText("Unsaved retained native draft");
    await current.page
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await openDocs(current, a.title);
    await expect(editor(current)).toHaveText("Unsaved retained native draft");
    await expect(
      current.page.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    expect(documentText(await readDocument(current, a.id))).toBe("Stored A");
    expect(current.patches).toHaveLength(1);
    await nativeScreenshot(current, "retained-after-navigation");
    await restore();
    await current.page.getByRole("button", { name: "Retry save" }).click();
    await expectSaved(current, a.id, a.title, "Unsaved retained native draft");
    expect(current.patches).toHaveLength(2);
  });

  test("native CmdZ cannot copy another page's history and opening never writes", async () => {
    const current = session!;
    const a = await seedDocument(current, "Native undo A", "ALPHA_PAGE_ONLY");
    const b = await seedDocument(current, "Native undo B", "BRAVO_PAGE_ONLY");
    await openDocs(current, a.title);
    await expectNoOpeningWrites(current, a);
    await typeBody(current, "ALPHA_PAGE_ONLY edited");
    await expectSaved(current, a.id, a.title, "ALPHA_PAGE_ONLY edited");
    const writes = current.patches.length;
    await selectDocument(current, b.title);
    await current.page.waitForTimeout(900);
    expect(current.patches).toHaveLength(writes);
    await undoBody(current);
    await expect(editor(current)).toHaveText("BRAVO_PAGE_ONLY");
    await current.page.waitForTimeout(900);
    expect(current.patches).toHaveLength(writes);
    expect((await readDocument(current, b.id)).revision).toBe(b.revision);
    await nativeScreenshot(current, "cross-page-undo");
  });

  test("real SSE title/body conflict keeps draft until explicit keep resolution", async () => {
    const current = session!;
    const document = await seedDocument(
      current,
      "Native conflict",
      "Server original",
    );
    await openDocs(current, document.title);
    const restore = await rejectBodySaves(current, document.id);
    await typeBody(current, "Local body kept");
    await expect(
      current.page.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    await typeTitle(current, "Local title kept");
    await remoteWrite(current, document.id, "meta", "Remote title");
    await remoteWrite(current, document.id, "content", "Remote body");
    await expect(
      current.page.getByRole("button", { name: "Keep draft and retry" }),
    ).toBeVisible();
    await expect(
      current.page.getByRole("textbox", { name: "Page title" }),
    ).toHaveValue("Local title kept");
    await expect(editor(current)).toHaveText("Local body kept");
    await current.page.waitForTimeout(900);
    expect(documentText(await readDocument(current, document.id))).toBe(
      "Remote body",
    );
    expect(current.patches).toHaveLength(1);
    await nativeScreenshot(current, "sse-conflict-retained");
    await restore();
    await current.page
      .getByRole("button", { name: "Keep draft and retry" })
      .click();
    await expectSaved(
      current,
      document.id,
      "Local title kept",
      "Local body kept",
    );
    expect(current.patches).toHaveLength(3);
  });

  test("explicit remote discard resets undo without overwriting the remote page", async () => {
    const current = session!;
    const document = await seedDocument(
      current,
      "Native discard",
      "Server original",
    );
    await openDocs(current, document.title);
    const restore = await rejectBodySaves(current, document.id);
    await typeBody(current, "DISCARDED_LOCAL_CHARACTERS");
    await expect(
      current.page.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    await remoteWrite(current, document.id, "meta", "Accepted remote title");
    await remoteWrite(current, document.id, "content", "Accepted remote body");
    await expect(
      current.page.getByRole("button", { name: "Discard draft and reload" }),
    ).toBeVisible();
    await restore();
    await current.page
      .getByRole("button", { name: "Discard draft and reload" })
      .click();
    await expect(
      current.page.getByRole("textbox", { name: "Page title" }),
    ).toHaveValue("Accepted remote title");
    await expect(editor(current)).toHaveText("Accepted remote body");
    await undoBody(current);
    await expect(editor(current)).toHaveText("Accepted remote body");
    await current.page.waitForTimeout(900);
    expect(current.patches).toHaveLength(1);
    expect(documentText(await readDocument(current, document.id))).toBe(
      "Accepted remote body",
    );
    await nativeScreenshot(current, "remote-discard-undo");
  });

  test("clean native title/body state survives process restart", async ({}, info) => {
    const current = session!;
    const document = await seedDocument(
      current,
      "Native restart",
      "Stored before editing",
    );
    await openDocs(current, document.title);
    await typeTitle(current, "Native persisted title");
    await typeBody(current, "Native persisted body");
    await expectSaved(
      current,
      document.id,
      "Native persisted title",
      "Native persisted body",
    );
    await nativeScreenshot(current, "before-restart");
    await closeNativeSession(current);
    session = null;
    session = await launchNativeProfile(profile, info, "restarted");
    await openDocs(session, "Native persisted title");
    await expect(editor(session)).toHaveText("Native persisted body");
    const stored = await readDocument(session, document.id);
    expect(stored.title).toBe("Native persisted title");
    expect(documentText(stored)).toBe("Native persisted body");
    await expectNoOpeningWrites(session, stored);
    await nativeScreenshot(session, "after-restart");
  });

  registerNativeDocsLifecycleTests(() => session!);
  registerNativeMenuTest(() => session!);
  registerNativeDocsAcceptanceTests(() => session!);
  registerNativeDocsRecoveryTests(
    () => session!,
    () => profile,
    (value) => {
      session = value;
    },
  );
});
