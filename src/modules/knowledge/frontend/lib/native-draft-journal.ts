import type { DraftJournal } from "../../../../core/contracts/app/draft-journal";
import { nativeRecordJournal } from "@shared/frontend/storage/native-record-journal";

/** Docs behaviour is unchanged: a missing bridge is treated like a browser session. */
export function nativeDraftJournal(): DraftJournal | undefined {
  const availability = nativeRecordJournal("draftJournal");
  return availability.kind === "native" ? availability.journal : undefined;
}
