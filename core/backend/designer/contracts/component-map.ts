import type { FootprintSnapshotComponent } from "./components/footprint-snapshot";
import type { InstanceFieldsComponent } from "./components/instance-fields";
import type { NetMetaComponent } from "./components/net-meta";
import type { PartOriginRefComponent } from "./components/part-origin-ref";
import type { SheetMetaComponent } from "./components/sheet-meta";
import type { SheetRefComponent } from "./components/sheet-ref";
import type { SymbolSnapshotComponent } from "./components/symbol-snapshot";
import type { Transform2DComponent } from "./components/transform-2d";
import type { WireEndHintsComponent } from "./components/wire-end-hints";
import type { WireGeometryComponent } from "./components/wire-geometry";
import type { WireNetRefComponent } from "./components/wire-net-ref";

export interface ComponentTypeMap {
  sheet_meta: SheetMetaComponent;
  sheet_ref: SheetRefComponent;
  transform_2d: Transform2DComponent;
  part_origin_ref: PartOriginRefComponent;
  symbol_snapshot: SymbolSnapshotComponent;
  footprint_snapshot: FootprintSnapshotComponent;
  instance_fields: InstanceFieldsComponent;
  wire_geometry: WireGeometryComponent;
  wire_end_hints: WireEndHintsComponent;
  wire_net_ref: WireNetRefComponent;
  net_meta: NetMetaComponent;
}
