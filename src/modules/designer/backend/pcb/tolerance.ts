// Re-export shim. The tolerance policy moved to a shared, framework-agnostic
// module so the connectivity kernel and the DRC backend consume one copy
// without a shared→module import. Existing relative imports keep working.
export * from "../../../../shared/pcb-geometry/tolerance";
