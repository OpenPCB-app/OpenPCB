// Re-export shim. The pure copper-fill kernel now lives in shared/ so the
// backend Gerber exporter and the canvas share one source of truth.
// See src/shared/rendering/copper-fill/copper-fill-geometry.ts.
export * from "../../../../../shared/rendering/copper-fill/copper-fill-geometry";
