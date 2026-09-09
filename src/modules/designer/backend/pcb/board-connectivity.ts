// Re-export shim — the copper-connectivity module adapter moved to
// src/shared/pcb-connectivity/ (mechanical relocation; see
// docs/pcb-hardening). Existing relative imports keep working.
export * from "../../../../shared/pcb-connectivity/board-connectivity";
