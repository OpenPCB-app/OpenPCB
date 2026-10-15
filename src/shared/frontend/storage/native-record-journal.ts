import type { DraftJournal } from "../../../core/contracts/app/draft-journal";

export type NativeRecordJournalName = "draftJournal" | "designerRecoveryJournal";

export type NativeJournalAvailability =
  | { kind: "native"; journal: DraftJournal }
  /** No `window.electronAPI` at all: browser dev or a test runner. */
  | { kind: "browser" }
  /** `electronAPI` present but this bridge is absent or invalid (renderer/preload skew). */
  | { kind: "missing-bridge" };

export function isDraftJournal(value: unknown): value is DraftJournal {
  return (
    !!value &&
    typeof value === "object" &&
    "read" in value &&
    typeof value.read === "function" &&
    "write" in value &&
    typeof value.write === "function" &&
    "remove" in value &&
    typeof value.remove === "function" &&
    "list" in value &&
    typeof value.list === "function"
  );
}

/** The module also runs in browsers and in compilers without Electron's ambient globals. */
export function nativeRecordJournal(
  name: NativeRecordJournalName,
): NativeJournalAvailability {
  if (typeof window === "undefined" || !("electronAPI" in window))
    return { kind: "browser" };
  const api: unknown = (window as unknown as { electronAPI?: unknown }).electronAPI;
  if (!api || typeof api !== "object") return { kind: "browser" };
  const bridge: unknown = (api as Record<string, unknown>)[name];
  return isDraftJournal(bridge)
    ? { kind: "native", journal: bridge }
    : { kind: "missing-bridge" };
}
