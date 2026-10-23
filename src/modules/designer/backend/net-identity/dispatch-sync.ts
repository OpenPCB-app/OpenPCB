import type { DesignerCommand, DesignerDispatchResult } from "../../../../sdks/designer";
import { loadSchematicSource } from "../projection-read";
import { deriveNetComponents } from "../projection-world";
import { lazyCensus } from "./census";
import { loadNetReferenceSource } from "./census-source";
import type { IdentityMode } from "./mode";
import { bindSchematicIdentity } from "./projection";
import { readNetIdentitySeqWatermark, type NetIdentityDb } from "./state-store";
import { isSchematicNeutralCommand, syncNetIdentity } from "./sync";
import { designNetSalt } from "./types";
import { requireValid } from "./validation";

function assertNeutral(tx: NetIdentityDb, designId: string, command: DesignerCommand, identity: IdentityMode): void {
  const source = loadSchematicSource(tx, designId);
  requireValid(source && identity.state, "identity.dispatch", "missing source or active state");
  const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
  const census = lazyCensus(() => loadNetReferenceSource(tx, designId));
  const { bind } = bindSchematicIdentity(source, derived, {
    previousActive: identity.state.active, salt: designNetSalt(designId), mode: "commit",
    seqWatermark: readNetIdentitySeqWatermark(tx, designId), dependentCount: (id) => census.count(id),
  });
  if (!bind.inSync) throw new Error(`schematic-neutral command changed membership: ${command.type}`);
}

/** Identity writes share the command transaction; a failed command may not change identity. */
export function syncDispatchedIdentity(
  tx: NetIdentityDb, designId: string, command: DesignerCommand, result: DesignerDispatchResult,
  identity: IdentityMode, previousRevision: number, timestamp: string,
): DesignerDispatchResult {
  if (identity.mode !== "durable") return result;
  if (isSchematicNeutralCommand(command)) {
    if (process.env.NODE_ENV !== "production") assertNeutral(tx, designId, command, identity);
    return result;
  }
  const synced = syncNetIdentity(tx, designId, result.ok ? result.revision : previousRevision, timestamp);
  if (!result.ok && synced.changed) throw new Error(`failed command changed net identity: ${command.type}`);
  return result.ok && synced.events.length > 0 ? { ...result, netIdentity: { events: synced.events } } : result;
}
