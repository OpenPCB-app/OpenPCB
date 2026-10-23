import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { CreateDesignerDesignInput, DesignerDesignSummary } from "../../../sdks/designer";
import { ensurePcbBoardSettings } from "./pcb/pcb-store";
import { designHeads } from "./schema";
import { initializeNetIdentity } from "./net-identity/sync";

export function insertDesign(
  tx: BetterSQLite3Database<Record<string, unknown>>,
  input: CreateDesignerDesignInput,
  id: string,
  timestamp: string,
): DesignerDesignSummary {
  const design = {
    id, name: input.name?.trim() || "Untitled Design", revision: 0,
    createdAt: timestamp, updatedAt: timestamp,
  };
  tx.insert(designHeads).values(design).run();
  ensurePcbBoardSettings(tx, id, timestamp);
  initializeNetIdentity(tx, id, "native", timestamp);
  return design;
}
