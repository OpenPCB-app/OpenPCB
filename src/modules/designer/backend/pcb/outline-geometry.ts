// Re-export shim — pure board-outline geometry relocated to the geometry kernel
// at src/shared/pcb-geometry/ (consumed by the exporters, the 2D/3D renderers,
// DRC, and resize/bbox). `pointInOutline` moved on to board-region.ts with the
// rest of the containment predicates; it is re-exported here so the DRC board
// check keeps one import path.
export * from "../../../../shared/pcb-geometry/outline-geometry";
export * from "../../../../shared/pcb-geometry/board-region";
