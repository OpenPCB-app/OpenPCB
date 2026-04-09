import type { PointNm } from "./geometry";
import type { DesignId, EntityId, SheetId } from "./ids";
import type { Revision } from "./revision";

export interface SchematicProjectionSheet {
  id: SheetId;
  title: string;
  index: number;
}

export interface SchematicProjectionPart {
  id: EntityId;
  sheetId: SheetId;
  componentId: string;
  variantId: string;
  reference: string;
  value: string;
  position: PointNm;
  rotationDeg: 0 | 90 | 180 | 270;
  mirrored: boolean;
  symbolKind: string;
}

export interface SchematicProjectionWire {
  id: EntityId;
  sheetId: SheetId;
  pointsNm: PointNm[];
  netId?: EntityId;
}

export interface SchematicProjectionNet {
  id: EntityId;
  sheetId: SheetId;
  name: string;
}

export interface SchematicProjection {
  designId: DesignId;
  revision: Revision;
  sheets: SchematicProjectionSheet[];
  parts: SchematicProjectionPart[];
  wires: SchematicProjectionWire[];
  nets: SchematicProjectionNet[];
}
