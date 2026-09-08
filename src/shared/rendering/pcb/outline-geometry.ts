// Re-export shim — the board-outline flattener moved to the geometry kernel at
// src/shared/pcb-geometry/outline-geometry.ts (S2 geometry contract §3/§4), so
// it can be imported without pulling a rendering path into DRC. Every existing
// consumer (Gerber, the 2D/3D renderers, contour validation) keeps this path.
export * from "../../pcb-geometry/outline-geometry";
