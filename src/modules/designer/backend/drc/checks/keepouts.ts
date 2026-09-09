// Re-export shim — the batch DRC engine moved to src/shared/drc/ (mechanical
// relocation; see docs/pcb-hardening). Existing relative imports keep working.
export * from "../../../../../shared/drc/checks/keepouts";
