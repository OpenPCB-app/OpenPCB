import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftJournal } from "../../../core/contracts/app/draft-journal";
import { isDraftJournal, nativeRecordJournal } from "./native-record-journal";

function bridge(): DraftJournal {
  return {
    read: vi.fn(async () => null),
    write: vi.fn(async (input) => ({ token: input.token, value: input.value })),
    remove: vi.fn(async () => true),
    list: vi.fn(async () => ({ records: [], unreadableCount: 0 })),
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("nativeRecordJournal", () => {
  it("is browser without a window or without electronAPI", () => {
    expect(nativeRecordJournal("designerRecoveryJournal")).toEqual({ kind: "browser" });
    vi.stubGlobal("window", {});
    expect(nativeRecordJournal("designerRecoveryJournal")).toEqual({ kind: "browser" });
  });

  it("is missing-bridge when electronAPI lacks or mangles the named bridge", () => {
    const docs = bridge();
    vi.stubGlobal("window", { electronAPI: { draftJournal: docs } });
    expect(nativeRecordJournal("designerRecoveryJournal")).toEqual({ kind: "missing-bridge" });
    vi.stubGlobal("window", { electronAPI: { designerRecoveryJournal: { read: () => null } } });
    expect(nativeRecordJournal("designerRecoveryJournal")).toEqual({ kind: "missing-bridge" });
  });

  it("returns each namespace's own bridge", () => {
    const docs = bridge();
    const designer = bridge();
    vi.stubGlobal("window", { electronAPI: { draftJournal: docs, designerRecoveryJournal: designer } });
    expect(nativeRecordJournal("designerRecoveryJournal")).toEqual({ kind: "native", journal: designer });
    expect(nativeRecordJournal("draftJournal")).toEqual({ kind: "native", journal: docs });
  });

  it("isDraftJournal requires all four functions", () => {
    expect(isDraftJournal(bridge())).toBe(true);
    expect(isDraftJournal({ ...bridge(), list: undefined })).toBe(false);
    expect(isDraftJournal(null)).toBe(false);
  });
});
