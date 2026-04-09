import type { DesignPatch } from "../patch";
import type { CommandId, DesignId, EntityId } from "../ids";
import type { Revision } from "../revision";

export interface CommandSuccessResult {
  ok: true;
  commandId: CommandId;
  designId: DesignId;
  acceptedRevision: Revision | null;
  nextRevision: Revision;
  forwardPatches: DesignPatch[];
  affectedEntityIds: EntityId[];
  invalidated: Array<"schematic" | "nets">;
}

export interface CommandConflictResult {
  ok: false;
  code: "REVISION_CONFLICT";
  designId: DesignId;
  serverRevision: Revision;
}

export type CommandResult = CommandSuccessResult | CommandConflictResult;
