// Moved to `src/shared/pcb-areas/net-class-resolver.ts`: the copper-pour
// clearance composition (contract §5) needs the same net → class resolution the
// DRC context uses, and `shared/` may not import a module. Pure, so the move is
// mechanical; this re-export keeps the backend importers unchanged.

export * from "../../../../shared/pcb-areas/net-class-resolver";
