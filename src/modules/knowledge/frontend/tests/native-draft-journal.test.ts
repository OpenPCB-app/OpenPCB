import { afterEach, expect, test, vi } from "vitest";
import { nativeDraftJournal } from "../lib/native-draft-journal";

const bridge = () => ({
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
});

afterEach(() => { vi.unstubAllGlobals(); });

test("Docs journal ignores the designer bridge; a missing bridge stays undefined", () => {
  expect(nativeDraftJournal()).toBeUndefined();
  vi.stubGlobal("window", { electronAPI: { designerRecoveryJournal: bridge() } });
  expect(nativeDraftJournal()).toBeUndefined();
  const docs = bridge();
  vi.stubGlobal("window", { electronAPI: { draftJournal: docs, designerRecoveryJournal: bridge() } });
  expect(nativeDraftJournal()).toBe(docs);
});
