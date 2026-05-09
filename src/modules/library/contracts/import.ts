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

export type Model3DCandidateAssociation =
  | "valid"
  | "missing_target"
  | "orphan_asset"
  | "shared_body"
  | "unsupported_format"
  | "footprint-model-ref"
  | "symbol-name"
  | "archive-name"
  | "single-model";

export interface Model3DCandidate {
  fileName: string;
  extension: string;
  association: Model3DCandidateAssociation;
}

export interface ModelConversionMetadata {
  footprintId: string;
  sourceStepSha256: string;
  sourceStepUrl: string;
  sourceFilename: string;
  selectedModel: Model3DCandidate;
  modelRef: unknown | null;
  status: "pending_client_conversion";
}

export interface InspectPayload {
  symbols: InspectSymbolItem[];
  footprints: InspectFootprintItem[];
  model3dCandidates: Model3DCandidate[];
  warnings: ImportWarning[];
}

export interface InspectKicadRequest {
  /** Optional — when omitted, only footprint files are parsed (draw-symbol flow). */
  symbolLibrary?: ImportFileInput | null;
  footprints: ImportFileInput[];
  /** Optional archive model filenames only; raw model bytes are never sent in JSON. */
  model3dFiles?: Array<{ fileName: string }>;
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

export interface ArchiveImportWarning {
  code: string;
  message: string;
}

export interface CommitKicadZipResponse extends CommitKicadResponse {
  warnings: ArchiveImportWarning[];
  model3dCandidates: Model3DCandidate[];
  modelConversion: ModelConversionMetadata | null;
  selected: {
    symbolName: string;
    footprintName: string;
    modelFileName: string | null;
    confidence: "high" | "medium" | "low";
  };
}
