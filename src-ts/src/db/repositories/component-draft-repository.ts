import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import {
  componentDraft,
  type ComponentDraftRow,
  type NewComponentDraftRow,
} from "../schema/component-draft";
import { and, eq, isNull } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class ComponentDraftRepository extends BaseRepository<
  typeof componentDraft,
  ComponentDraftRow,
  NewComponentDraftRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, componentDraft, logger, "ComponentDraft");
  }

  async findActiveByFamily(familyId: string): Promise<ComponentDraftRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findActiveByFamily",
      async () => {
        return this.db
          .select()
          .from(componentDraft)
          .where(
            and(
              eq(componentDraft.familyId, familyId),
              isNull(componentDraft.deletedAt),
            ),
          );
      },
    );
  }

  async upsert(
    id: string,
    data: Partial<Omit<NewComponentDraftRow, "id" | "createdAt" | "updatedAt">>,
  ): Promise<ComponentDraftRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "upsert",
      async () => {
        const existing = await this.findById(id);
        if (existing) {
          return this.update(id, data);
        }
        return this.create({ ...data, id } as never);
      },
    );
  }
}
