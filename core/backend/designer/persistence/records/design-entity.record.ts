import type { EntityKind } from "../../contracts/entity-kind";

export interface DesignEntityRecord {
  id: string;
  designId: string;
  kind: EntityKind;
  sheetId?: string;
  reference?: string;
  originComponentId?: string;
  originVariantId?: string;
  createdRevision: number;
  updatedRevision: number;
  componentsJson: unknown;
  createdAt: string;
  updatedAt: string;
}
