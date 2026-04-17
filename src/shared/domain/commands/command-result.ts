import type { Revision, RevisionConflict } from "../revision/revision";

export interface CommandOkResult {
  ok: true;
  revision: Revision;
}

export interface CommandConflictResult {
  ok: false;
  code: "REVISION_CONFLICT";
  conflict: RevisionConflict;
}

export type CommandResult = CommandOkResult | CommandConflictResult;
