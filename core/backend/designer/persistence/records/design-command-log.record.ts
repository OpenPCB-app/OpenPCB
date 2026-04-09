import type { DesignPatch } from "../../contracts/patch";

export interface DesignCommandLogRecord {
  commandId: string;
  designId: string;
  sessionId: string;
  baseRevision: number | null;
  nextRevision: number;
  commandType: string;
  commandPayload: unknown;
  forwardPatches: DesignPatch[];
  inversePatches: DesignPatch[];
  affectedEntityIds: string[];
  createdAt: string;
}
