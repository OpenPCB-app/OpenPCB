import type { PointNm } from "../geometry";
import type { EntityId, SheetId } from "../ids";
import type { PinRef } from "../components/wire-end-hints";

export interface CreateWireCommand {
  type: "create_wire";
  wireId: EntityId;
  sheetId: SheetId;
  pointsNm: PointNm[];
  startPinRef?: PinRef;
  endPinRef?: PinRef;
}
