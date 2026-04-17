import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../shared/rendering";

export interface ImportFileInput {
  fileName: string;
  content: string;
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
  preview: SymbolRenderModel;
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
  preview: FootprintRenderModel;
}

export interface InspectPayload {
  symbols: InspectSymbolItem[];
  footprints: InspectFootprintItem[];
  warnings: ImportWarning[];
}

export interface InspectKicadRequest {
  /** Optional — when omitted, only footprint files are parsed (draw-symbol flow). */
  symbolLibrary?: ImportFileInput | null;
  footprints: ImportFileInput[];
}

export interface InspectKicadResponse extends InspectPayload {}

export interface CommitKicadRequest {
  symbolLibrary: ImportFileInput;
  footprints: ImportFileInput[];
  selection: {
    symbolId: string;
    footprintId?: string | null;
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
