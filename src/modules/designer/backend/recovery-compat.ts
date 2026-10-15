// Server half of the designer recovery record's compatibility stamp (OPENPCB-103).
//
// A journaled edit is retried only by the build that wrote it: a record stamped with
// another schema head or command epoch is shown for export/discard, never resent.

import type { DesignerRecoveryCompat } from "../../../sdks/designer";

/**
 * Basename of the lexicographically last `backend/migrations/*.sql`. A Bun test
 * compares it with the directory, so every new migration must bump it.
 */
export const DESIGNER_SCHEMA_HEAD = "0020_operation_receipts";

/**
 * Bump by hand when a command's meaning changes without a migration (e.g. a
 * net-identity or coordinate-frame change), so older journaled edits stop
 * being retryable.
 */
export const DESIGNER_COMMAND_EPOCH = 1;

export function designerRecoveryCompat(): DesignerRecoveryCompat {
  return {
    schemaHead: DESIGNER_SCHEMA_HEAD,
    commandEpoch: DESIGNER_COMMAND_EPOCH,
  };
}
