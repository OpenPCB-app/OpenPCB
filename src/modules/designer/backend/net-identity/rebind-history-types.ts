export type RawNetRebindSlot = { exists: false } | { exists: true; value: unknown };

export interface RawNetRebindFieldDelta {
  key: string;
  before: RawNetRebindSlot;
  after: RawNetRebindSlot;
}

export interface RawNetRebindRowDelta {
  rowId: string;
  kind: "trace" | "via" | "free_pad" | "zone" | "board_settings";
  payloadId: string | null;
  fields: RawNetRebindFieldDelta[];
}

export interface RawNetRebindDelta {
  version: 1;
  designId: string;
  rows: RawNetRebindRowDelta[];
}
