import type { NetReferenceSource } from "../../../../shared/electrical-identity/references";
import {
  loadPcbFreePads, loadPcbTraces, loadPcbVias, loadPcbZones, readPcbBoardSettingsForMigration,
} from "../pcb/pcb-store";
import type { NetIdentityDb } from "./state-store";

/** Timestamp is irrelevant to references; this canonical reader never writes. */
export function loadNetReferenceSource(db: NetIdentityDb, designId: string): NetReferenceSource {
  return {
    board: readPcbBoardSettingsForMigration(db, designId, "1970-01-01T00:00:00.000Z").settings,
    traces: loadPcbTraces(db, designId), vias: loadPcbVias(db, designId),
    freePads: loadPcbFreePads(db, designId), zones: loadPcbZones(db, designId).zones,
  };
}
