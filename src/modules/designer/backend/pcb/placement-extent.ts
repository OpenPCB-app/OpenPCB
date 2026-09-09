// Re-export shim — the keepout placement-extent resolver moved to
// src/shared/pcb-geometry/ (mechanical relocation; see docs/pcb-hardening).
// Existing relative imports keep working.
export * from "../../../../shared/pcb-geometry/placement-extent";
