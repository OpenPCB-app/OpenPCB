import type { LibraryComponent } from "../../../core/contracts/modules/sdk";
import type {
  FootprintPreviewModel,
  SymbolPreviewModel,
} from "../../../shared/rendering";

export interface ImportWarning {
  scope: "symbol" | "footprint";
  itemId: string;
  itemName: string;
  code: string;
  message: string;
}

export interface InspectSymbolItem {
  id: string;
  name: string;
  referencePrefix: string;
  pinCount: number;
  description: string | null;
  warningCount: number;
  preview: SymbolPreviewModel;
}

export interface InspectFootprintItem {
  id: string;
  fileName: string;
  name: string;
  mountType: string;
  padCount: number;
  packageCode: {
    imperial: string | null;
    metric: string | null;
  };
  warningCount: number;
  preview: FootprintPreviewModel;
}

export interface InspectPayload {
  symbols: InspectSymbolItem[];
  footprints: InspectFootprintItem[];
  warnings: ImportWarning[];
}

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
  preview: SymbolPreviewModel | null;
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
  preview: FootprintPreviewModel | null;
  provenance: ComponentSourceProvenance | null;
}

export interface ComponentDetailPayload {
  component: LibraryComponent;
  symbol: ComponentSymbolDetail;
  footprint: ComponentFootprintDetail;
}
