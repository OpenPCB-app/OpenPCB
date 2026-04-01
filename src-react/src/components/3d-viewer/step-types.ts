/**
 * STEP Viewer Type Definitions
 * 
 * Contracts for Web Worker communication and mesh data normalization.
 */

// ---------------------------------------------------------------------------
// Worker Message Types
// ---------------------------------------------------------------------------

export type StepWorkerRequest =
  | { type: "init" }
  | { type: "parse"; buffer: ArrayBuffer; fileName: string }
  | { type: "cancel" };

export type StepWorkerResponse =
  | { type: "ready" }
  | { type: "progress"; phase: ParsePhase }
  | { type: "success"; meshes: NormalizedMesh[] }
  | { type: "error"; error: StepParseError };

// ---------------------------------------------------------------------------
// Progress Phases
// ---------------------------------------------------------------------------

export type ParsePhase = "fetching" | "parsing" | "meshing";

export const PHASE_LABELS: Record<ParsePhase, string> = {
  fetching: "Fetching model...",
  parsing: "Parsing STEP file...",
  meshing: "Generating mesh...",
};

// ---------------------------------------------------------------------------
// Normalized Mesh Data (from OCCT output)
// ---------------------------------------------------------------------------

export interface NormalizedMesh {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array | null;
  color: [number, number, number] | null; // RGB 0-1
}

// ---------------------------------------------------------------------------
// Loader State
// ---------------------------------------------------------------------------

export type LoaderStatus = "idle" | "loading" | "success" | "error";

export interface LoaderState {
  status: LoaderStatus;
  phase: ParsePhase | null;
  meshes: NormalizedMesh[];
  error: StepParseError | null;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export type StepParseErrorKind =
  | "unsupported_format"  // WRL or other non-STEP
  | "fetch_failed"        // Network/404 error
  | "parse_failed"        // OCCT parse error
  | "webgl_unsupported";  // Browser doesn't support WebGL

export interface StepParseError {
  kind: StepParseErrorKind;
  message: string;
}

export const ERROR_MESSAGES: Record<StepParseErrorKind, string> = {
  unsupported_format: "Preview unavailable for this file format",
  fetch_failed: "3D model file not found",
  parse_failed: "Failed to parse 3D model. The file may be corrupted.",
  webgl_unsupported: "3D preview requires WebGL. Your browser may not support it.",
};

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

export function isStepFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "step" || ext === "stp";
}

export function isWrlFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".wrl");
}
