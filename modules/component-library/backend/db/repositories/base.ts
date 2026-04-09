/**
 * Base Repository
 *
 * Shared CRUD helpers used by module repositories. Uses withQueryLogging
 * to centralize error handling and latency tracking.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { eq, isNull } from "drizzle-orm";
import { generateUUIDv7 } from "../schema/base";
import { DbNotFoundError } from "../errors";
import { withQueryLogging } from "../decorators";

export abstract class BaseRepository<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TTable extends SQLiteTableWithColumns<any>,
  TSelect = TTable["$inferSelect"],
  TInsert = TTable["$inferInsert"],
> {
  constructor(
    protected db: BunSQLiteDatabase<typeof schema>,
    protected table: TTable,
    protected logger: QueryLogger,
    protected entityName: string,
  ) {}

  async findById(id: string): Promise<TSelect | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findById",
      async () => {
        const result = await this.db
          .select()
          .from(this.table)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(eq((this.table as any).id, id))
          .limit(1);
        return (result[0] as TSelect) ?? null;
      },
    );
  }

  async findByIdOrThrow(id: string): Promise<TSelect> {
    const entity = await this.findById(id);
    if (!entity) {
      throw new DbNotFoundError(
        `${this.entityName} not found`,
        this.entityName,
        id,
      );
    }
    return entity;
  }

  async findMany(limit?: number): Promise<TSelect[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findMany",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = this.db.select().from(this.table);
        if (limit) {
          query = query.limit(limit);
        }
        const result = await query;
        return result as TSelect[];
      },
    );
  }

  async findActive(limit?: number): Promise<TSelect[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findActive",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = this.db
          .select()
          .from(this.table)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(isNull((this.table as any).deletedAt));
        if (limit) {
          query = query.limit(limit);
        }
        const result = await query;
        return result as TSelect[];
      },
    );
  }

  async create(
    data: Omit<TInsert, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<TSelect> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "create",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id = (data as any).id || generateUUIDv7();
        const now = new Date();

        const insertData = {
          ...data,
          id,
          createdAt: now,
          updatedAt: now,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.db.insert(this.table).values(insertData as any);
        return await this.findByIdOrThrow(id);
      },
    );
  }

  async update(
    id: string,
    data: Partial<Omit<TInsert, "id" | "createdAt" | "updatedAt">>,
  ): Promise<TSelect> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "update",
      async () => {
        const updateData = {
          ...data,
          updatedAt: new Date(),
        };

        await this.db
          .update(this.table)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .set(updateData as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(eq((this.table as any).id, id));

        return await this.findByIdOrThrow(id);
      },
    );
  }

  async delete(id: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "delete",
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.db.delete(this.table).where(eq((this.table as any).id, id));
      },
    );
  }

  async softDelete(id: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "softDelete",
      async () => {
        const now = new Date();
        await this.db
          .update(this.table)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .set({ deletedAt: now, updatedAt: now } as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(eq((this.table as any).id, id));
      },
    );
  }

  async exists(id: string): Promise<boolean> {
    const entity = await this.findById(id);
    return entity !== null;
  }
}
