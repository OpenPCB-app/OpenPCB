import type { EntityId } from "../ids";

export interface PinRef {
  partInstanceId: EntityId;
  originPinKey: string;
}

export interface WireEndHintsComponent {
  startPinRef?: PinRef;
  endPinRef?: PinRef;
}
