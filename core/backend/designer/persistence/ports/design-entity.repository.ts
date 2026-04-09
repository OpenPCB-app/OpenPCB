import type { DesignEntityRecord } from "../records/design-entity.record";

export interface DesignEntityRepository {
  listByDesign(designId: string): Promise<DesignEntityRecord[]>;
  replaceForDesign(designId: string, entities: DesignEntityRecord[]): Promise<void>;
}
