import type {
  DesignerPin,
  LibraryComponentPlacementDetail,
} from "../../../sdks";

export interface PersistedPartPayload {
  id: string;
  componentId: string;
  reference: string;
  value: string;
  rotationDeg: number;
  mirrored: boolean;
  positionNm: { x: number; y: number };
  symbol: LibraryComponentPlacementDetail["symbol"];
  footprint: LibraryComponentPlacementDetail["footprint"];
  pins: DesignerPin[];
  propertiesJson?: string;
}

export interface PersistedWirePayload {
  id: string;
  sourcePinId: string;
  targetPinId: string;
  pointsNm: Array<{ x: number; y: number }>;
}

export interface PersistedLabelPayload {
  id: string;
  text: string;
  positionNm: { x: number; y: number };
}
