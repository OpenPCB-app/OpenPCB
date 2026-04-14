import type {
  FootprintPreviewModel,
  SymbolPreviewModel,
} from "../../../../shared/rendering";

export interface ImportFileInput {
  fileName: string;
  content: string;
}

export interface InspectKicadRequest {
  symbolLibrary: ImportFileInput;
  footprints: ImportFileInput[];
}

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

export interface InspectKicadResponse {
  symbols: InspectSymbolItem[];
  footprints: InspectFootprintItem[];
  warnings: ImportWarning[];
}

export interface CommitKicadRequest extends InspectKicadRequest {
  selection: {
    symbolId: string;
    footprintId: string;
  };
  component: {
    name: string;
    description: string;
  };
}

export interface CommitKicadResponse {
  componentId: string;
  componentName: string;
  reused: boolean;
}
