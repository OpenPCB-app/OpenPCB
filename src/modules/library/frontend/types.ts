import type { LibraryComponent } from "../../../core/contracts/modules/sdk";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../shared/rendering";
export type {
  ImportWarning,
  InspectSymbolItem,
  InspectFootprintItem,
  InspectPayload,
} from "../contracts/import";

export interface ComponentSourceProvenance {
  sourceKind: string | null;
  sourceFormat: string | null;
  fileName: string | null;
  importedAt: string | null;
  sourceHash: string | null;
}

export interface DetailWarning {
  code: string;
  message: string;
}

export interface ComponentSymbolDetail {
  id: string;
  name: string;
  referencePrefix: string | null;
  pinCount: number;
  warnings: DetailWarning[];
  preview: SymbolRenderModel | null;
  provenance: ComponentSourceProvenance | null;
}

export interface ComponentFootprintDetail {
  id: string;
  name: string;
  mountType: string | null;
  padCount: number;
  packageCode: {
    imperial: string | null;
    metric: string | null;
  };
  warnings: DetailWarning[];
  preview: FootprintRenderModel | null;
  provenance: ComponentSourceProvenance | null;
}

export interface ComponentDetailPayload {
  component: LibraryComponent;
  symbol: ComponentSymbolDetail;
  footprint: ComponentFootprintDetail;
}
