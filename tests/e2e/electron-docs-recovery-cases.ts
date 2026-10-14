import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  launchNativeProfile,
  nativeScreenshot,
  type NativeProfile,
  type NativeSession,
  type NetworkRecord,
} from "./electron-native-helpers";
import {
  documentText,
  editor,
  openDocs,
  readDocument,
  rejectBodySaves,
  seedDocument,
  typeBody,
} from "./electron-docs-fixtures";

async function captureBeforeTermination(
  current: NativeSession,
  kind: string,
): Promise<void> {
  const requests = await current.app.evaluate(
    () =>
      (globalThis as unknown as { __openpcbNativeNetwork: NetworkRecord[] })
        .__openpcbNativeNetwork,
  );
  await nativeScreenshot(current, `before-${kind}`);
  const trace = current.info.outputPath(`initial-before-${kind}-trace.zip`);
  await current.app.context().tracing.stop({ path: trace });
  await current.info.attach(`initial-before-${kind}-trace.zip`, {
    path: trace,
    contentType: "application/zip",
  });
  await current.info.attach(`initial-before-${kind}-run.json`, {
    body: JSON.stringify(
      {
        requests,
        patches: current.patches,
        responses: current.responses,
        console: current.console,
        pageErrors: current.pageErrors,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await current.info.attach(`initial-before-${kind}-stdout.txt`, {
    body: current.stdout.join(""),
    contentType: "text/plain",
  });
  await current.info.attach(`initial-before-${kind}-stderr.txt`, {
    body: current.stderr.join(""),
    contentType: "text/plain",
  });
  expect(current.pageErrors).toEqual([]);
  expect(requests.filter((request) => request.blocked)).toEqual([]);
  expect(
    current.console.filter(
      (entry) =>
        entry.type === "error" &&
        !current.expectedResourceFailures.some(
          (failure) => entry.url === failure.url && entry.text === failure.text,
        ),
    ),
  ).toEqual([]);
}

async function terminateOwnedSession(
  current: NativeSession,
  kind: "window-close" | "process-kill",
): Promise<void> {
  if (kind === "window-close") {
    const window = await current.app.browserWindow(current.page);
    await window.evaluate((nativeWindow) => nativeWindow.close());
    await expect
      .poll(() => current.page.isClosed(), { timeout: 10_000 })
      .toBe(true);
    await current.app.close();
    return;
  }
  const process = current.app.process();
  const exit = new Promise<void>((resolve) =>
    process.once("exit", () => resolve()),
  );
  expect(
    process.kill("SIGKILL"),
    "Terminate only this isolated Electron process",
  ).toBe(true);
  await exit;
  expect(process.signalCode).toBe("SIGKILL");
}

export function registerNativeDocsRecoveryTests(
  getSession: () => NativeSession,
  getProfile: () => NativeProfile,
  replaceSession: (session: NativeSession | null) => void,
): void {
  test("native close and quit keep a non-durable draft open by default", async () => {
    const current = getSession();
    const document = await seedDocument(
      current,
      "Native close guard",
      "STORED_GUARD_BODY",
    );
    const root = path.join(await fs.realpath(getProfile().userData), "dev");
    const scope = createHash("sha256")
      .update(await fs.realpath(path.join(root, "openpcb.sqlite")))
      .digest("hex");
    const directory = path.join(root, `knowledge-drafts-${scope}`);
    await fs.mkdir(directory, { mode: 0o700 });
    const file = path.join(
      directory,
      `${createHash("sha256").update(document.id).digest("hex")}.json`,
    );
    const future = '{"version":99,"futureDraft":"MUST_SURVIVE"}';
    await fs.writeFile(file, future, { mode: 0o600 });
    // Electron's will-prevent-unload handler owns this decision. Playwright's
    // default dismissal races the native confirmation after it has resolved.
    current.page.on("dialog", (dialog) => {
      expect(dialog.type()).toBe("beforeunload");
    });
    await current.app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { __closePrompts: unknown[] };
      state.__closePrompts = [];
      dialog.showMessageBoxSync = (_window: unknown, options?: unknown) => {
        state.__closePrompts.push(options ?? _window);
        return 0;
      };
    });
    try {
      await openDocs(current, document.title);
      await typeBody(current, "VOLATILE_GUARD_BODY");
      await expect(
        current.page.getByRole("button", { name: "Retry save" }),
      ).toBeVisible();
      await expect(
        current.page.getByText(/Draft not durably retained on this Mac/),
      ).toBeVisible();
      const window = await current.app.browserWindow(current.page);
      await window.evaluate((nativeWindow) => nativeWindow.close());
      const readPrompts = () =>
        current.app.evaluate(
          () =>
            (globalThis as unknown as { __closePrompts: unknown[] })
              .__closePrompts,
        );
      await expect.poll(async () => (await readPrompts()).length).toBe(1);
      await current.app.evaluate(({ app }) => app.quit());
      await expect.poll(async () => (await readPrompts()).length).toBe(2);
      const prompts = await readPrompts();
      expect(prompts).toHaveLength(2);
      for (const prompt of prompts)
        expect(prompt).toMatchObject({
          defaultId: 0,
          cancelId: 0,
          buttons: ["Stay", "Leave without saving"],
        });
      expect(current.page.isClosed()).toBe(false);
      expect((await fetch(`${current.backend}/api/health`)).ok).toBe(true);
      await expect(editor(current)).toHaveText("VOLATILE_GUARD_BODY");
      expect(current.patches).toHaveLength(0);
      expect(documentText(await readDocument(current, document.id))).toBe(
        "STORED_GUARD_BODY",
      );
      expect(await fs.readFile(file, "utf8")).toBe(future);
      await current.info.attach("close-guard-prompts.json", {
        body: JSON.stringify(prompts, null, 2),
        contentType: "application/json",
      });
      await nativeScreenshot(current, "non-durable-draft-stays-open");
    } finally {
      // The test chooses discard only for its own fresh profile so teardown can exit.
      await current.app.evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      });
    }
  });
  for (const kind of ["window-close", "process-kill"] as const) {
    test(`failed native body draft remains recoverable after ${kind}`, async () => {
      const current = getSession();
      const document = await seedDocument(
        current,
        `Native recovery ${kind}`,
        "LAST_VALID_STORED_BODY",
      );
      await openDocs(current, document.title);
      await rejectBodySaves(current, document.id);
      const pending = `UNSAVED_NATIVE_DRAFT_AFTER_${kind.toUpperCase()}`;
      await typeBody(current, pending);
      await expect(
        current.page.getByRole("button", { name: "Retry save" }),
      ).toBeVisible();
      const before = await readDocument(current, document.id);
      expect(documentText(before)).toBe("LAST_VALID_STORED_BODY");
      await captureBeforeTermination(current, kind);
      replaceSession(null);
      await terminateOwnedSession(current, kind);
      const reopened = await launchNativeProfile(
        getProfile(),
        current.info,
        "recovered",
      );
      replaceSession(reopened);
      await openDocs(reopened, document.title);
      const after = await readDocument(reopened, document.id);
      await reopened.info.attach(
        `native-${kind}-recovery-characterization.json`,
        {
          body: JSON.stringify(
            {
              termination: kind,
              lastValidRevision: before.revision,
              reopenedRevision: after.revision,
              storedBody: documentText(after),
              visibleBody: await editor(reopened).innerText(),
              expectedRecoverableDraft: pending,
            },
            null,
            2,
          ),
          contentType: "application/json",
        },
      );
      await nativeScreenshot(reopened, `${kind}-reopened`);
      expect(
        documentText(after),
        "Prior acknowledged body must remain intact",
      ).toBe("LAST_VALID_STORED_BODY");
      expect(after.revision).toBe(before.revision);
      await expect(
        editor(reopened),
        "Failed pending characters must remain recoverable after native restart",
      ).toHaveText(pending, { timeout: 1000 });
      await expect(
        reopened.page.getByRole("button", { name: "Retry save" }),
      ).toBeVisible();
      expect(reopened.patches).toHaveLength(0);
      await reopened.page.getByRole("button", { name: "Retry save" }).click();
      await expect
        .poll(async () =>
          documentText(await readDocument(reopened, document.id)),
        )
        .toBe(pending);
      expect(reopened.patches).toHaveLength(1);
    });
  }
}
