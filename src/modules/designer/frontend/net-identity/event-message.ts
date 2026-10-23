import type { NetIdentityActivityEntry } from "./net-identity-activity-store";

const names = (nets: readonly { readonly netName: string }[]) =>
  nets.map((net) => `'${net.netName}'`).join(", ");

export function netIdentityEventMessage(event: NetIdentityActivityEntry["event"]): string {
  switch (event.kind) {
    case "split": return `Net '${event.netName}' split; new nets: ${names(event.newNets)}.`;
    case "merge": return `Nets ${names(event.retired)} merged into '${event.survivorName}'.`;
    case "reconfigure": return `Nets ${names(event.predecessors)} reconfigured as ${names(event.successors)}.`;
    case "removed": return `Net '${event.netName}' removed.`;
  }
}
