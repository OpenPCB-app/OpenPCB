import type { DesignId } from "../../contracts/ids";
import type { Revision } from "../../contracts/revision";

export interface DesignHeadRecord {
  designId: DesignId;
  revision: Revision;
  nextAutoNetOrdinals: Record<string, number>;
  referenceCounters: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}
