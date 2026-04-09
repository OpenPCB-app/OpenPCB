import type { DesignHeadRecord } from "../records/design-head.record";

export interface DesignHeadRepository {
  get(designId: string): Promise<DesignHeadRecord | null>;
  upsert(head: DesignHeadRecord): Promise<void>;
}
