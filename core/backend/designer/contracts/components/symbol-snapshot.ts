import type { PointNm } from "../geometry";

export interface SymbolSnapshotPin {
  originPinKey: string;
  number?: string;
  name: string;
  localPosition: PointNm;
}

export interface SymbolSnapshotComponent {
  symbolKind: string;
  referencePrefix: string;
  bodyBounds?: {
    minXNm: number;
    minYNm: number;
    maxXNm: number;
    maxYNm: number;
  };
  graphics?: unknown[];
  pins: SymbolSnapshotPin[];
  sourceHash?: string;
}
