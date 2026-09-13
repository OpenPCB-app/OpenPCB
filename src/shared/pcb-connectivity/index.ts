// The shared copper-connectivity kernel: one definition of "electrically
// connected" for the ratsnest, DRC dangling/unconnected checks, pour
// anchoring and routed length. See docs/pcb-hardening/01-connectivity-contract.md.
export * from "./copper-records";
export * from "./copper-items";
export * from "./touch";
export * from "./connectivity-graph";
export * from "./net-path-types";
export * from "./net-path";
