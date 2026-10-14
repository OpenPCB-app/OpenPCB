import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { AtomicRecordStore } from "../../../src/core/backend/storage/atomic-record-store";
import type { DraftJournal } from "../../../src/core/contracts/app/draft-journal";
import { getBackendPayload } from "./backend-server";

export function registerDraftJournalIpc(
  window: () => BrowserWindow | null,
  allowedUrl: (url: string) => boolean,
): void {
  let store: AtomicRecordStore | undefined;
  let storeScope: string | undefined;
  function authorized(event: IpcMainInvokeEvent): AtomicRecordStore {
    if (
      event.sender !== window()?.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame ||
      !allowedUrl(event.senderFrame.url) ||
      !getBackendPayload()
    )
      throw new Error("Draft journal unavailable to this frame");
    const root = process.env.APP_DATA_DIR;
    const db = process.env.OPENPCB_DB_PATH;
    if (!root || !db)
      throw new Error("Draft journal database scope unavailable");
    // Renderer origins change with the ephemeral backend port; the canonical DB path does not.
    const scope = createHash("sha256").update(realpathSync(db)).digest("hex");
    if (storeScope !== scope) {
      store = new AtomicRecordStore(join(root, `knowledge-drafts-${scope}`));
      storeScope = scope;
    }
    return store!;
  }
  ipcMain.handle("draft-journal:read", (event, key: string) =>
    authorized(event).read(key),
  );
  ipcMain.handle(
    "draft-journal:write",
    (event, input: Parameters<DraftJournal["write"]>[0]) =>
      authorized(event).write(input),
  );
  ipcMain.handle(
    "draft-journal:remove",
    (event, input: Parameters<DraftJournal["remove"]>[0]) =>
      authorized(event).remove(input),
  );
  ipcMain.handle("draft-journal:list", (event) => authorized(event).list());
}
