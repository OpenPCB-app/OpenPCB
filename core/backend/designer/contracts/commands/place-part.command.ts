import type { RotationDeg } from "../geometry";
import type { EntityId, SheetId } from "../ids";
import type { FootprintSnapshotComponent } from "../components/footprint-snapshot";
import type { PartOriginRefComponent } from "../components/part-origin-ref";
import type { SymbolSnapshotComponent } from "../components/symbol-snapshot";

export interface PlacePartCommand {
  type: "place_part";
  partInstanceId: EntityId;
  sheetId: SheetId;
  xNm: number;
  yNm: number;
  rotationDeg: RotationDeg;
  mirrored: boolean;
  originRef: PartOriginRefComponent;
  symbolSnapshot: SymbolSnapshotComponent;
  footprintSnapshot?: FootprintSnapshotComponent;
  reference?: string;
  value?: string;
  properties?: Record<string, string>;
}
