/**
 * Re-export shim. The reference-designator semantics moved to
 * `src/shared/rendering/pcb/footprint-labels.ts` in S12 (DFM contract 11 §1.2)
 * so the silkscreen artwork model applies the SAME rebinding and keep-upright
 * rules the canvas does. Edit the shared file, not this one.
 */
export * from "../../../../shared/rendering/pcb/footprint-labels";
