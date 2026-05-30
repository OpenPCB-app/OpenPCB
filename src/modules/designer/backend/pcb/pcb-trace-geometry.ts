// Re-export shim. The implementation moved to a shared, framework-agnostic
// module so both the DRC backend engine and the frontend live-DRC can consume
// one copy without a frontend→backend import. Existing relative imports here
// keep working unchanged.
export * from "../../../../shared/pcb-geometry/pcb-trace-geometry";
