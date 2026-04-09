import type { SchematicProjection } from "../../../backend/designer/contracts/projection";

export interface QueryTransport {
  getSchematicProjection(designId: string): Promise<SchematicProjection | null>;
}
