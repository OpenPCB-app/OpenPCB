import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import {
  componentProvenance,
  type ComponentProvenanceRow,
  type NewComponentProvenanceRow,
} from "../schema/component-provenance";
import { eq } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class ComponentProvenanceRepository extends BaseRepository<
  typeof componentProvenance,
  ComponentProvenanceRow,
  NewComponentProvenanceRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, componentProvenance, logger, "ComponentProvenance");
  }

  async findByFamily(familyId: string): Promise<ComponentProvenanceRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByFamily",
      async () => {
        return this.db
          .select()
          .from(componentProvenance)
          .where(eq(componentProvenance.familyId, familyId));
      },
    );
  }
}
