import type { DraftJournal } from "../../../../core/contracts/app/draft-journal";

function isDraftJournal(value: unknown): value is DraftJournal {
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
export function nativeDraftJournal(): DraftJournal | undefined {
  if (typeof window === "undefined" || !("electronAPI" in window)) return;
  const api = window.electronAPI;
  if (!api || typeof api !== "object" || !("draftJournal" in api)) return;
  return isDraftJournal(api.draftJournal) ? api.draftJournal : undefined;
}
