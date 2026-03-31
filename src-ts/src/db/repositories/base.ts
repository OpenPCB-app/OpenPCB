/**
 * Base Repository - REFACTORED
 * Uses withQueryLogging to eliminate duplication
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { eq, isNull } from "drizzle-orm";
import { generateUUIDv7 } from "../schema/base";
import { DbNotFoundError } from "../errors";
import { withQueryLogging } from "../decorators";

/**
 * Base repository interface for all entity repositories
 */
export abstract class BaseRepository<
  TTable extends SQLiteTableWithColumns<any>,
  TSelect = TTable["$inferSelect"],
  TInsert = TTable["$inferInsert"]
> {
  constructor(
    protected db: BunSQLiteDatabase<typeof schema>,
    protected table: TTable,
    protected logger: QueryLogger,
    protected entityName: string
  ) { }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<TSelect | null> {
    return withQueryLogging(this.logger, this.entityName, 'findById', async () => {
      const result = await this.db
        .select()
        .from(this.table)
        .where(eq(this.table.id, id))
        .limit(1);
      return (result[0] as TSelect) ?? null;
    });
  }

  /**
   * Find entity by ID or throw DbNotFoundError
   */
  async findByIdOrThrow(id: string): Promise<TSelect> {
    const entity = await this.findById(id);
    if (!entity) {
      throw new DbNotFoundError(
        `${this.entityName} not found`,
        this.entityName,
        id
      );
    }
    return entity;
  }

  /**
   * Find many entities with optional filters
   */
  async findMany(limit?: number): Promise<TSelect[]> {
    return withQueryLogging(this.logger, this.entityName, 'findMany', async () => {
      let query = this.db.select().from(this.table);
      if (limit) {
        query = query.limit(limit) as any;
      }
      const result = await query;
      return result as TSelect[];
    });
  }

  /**
   * Find all non-deleted entities (respects soft delete if present)
   */
  async findActive(limit?: number): Promise<TSelect[]> {
    return withQueryLogging(this.logger, this.entityName, 'findActive', async () => {
      let query = this.db
        .select()
        .from(this.table)
        .where(isNull((this.table as any).deletedAt));
      if (limit) {
        query = query.limit(limit) as any;
      }
      const result = await query;
      return result as TSelect[];
    });
  }

  /**
   * Create new entity
   */
  async create(data: Omit<TInsert, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<TSelect> {
    return withQueryLogging(this.logger, this.entityName, 'create', async () => {
      const id = (data as any).id || generateUUIDv7();
      const now = new Date(); // Use Date object for Drizzle

      const insertData = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.insert(this.table).values(insertData as any);
      return await this.findByIdOrThrow(id);
    });
  }

  /**
   * Update existing entity
   */
  async update(
    id: string,
    data: Partial<Omit<TInsert, "id" | "createdAt" | "updatedAt">>
  ): Promise<TSelect> {
    return withQueryLogging(this.logger, this.entityName, 'update', async () => {
      const updateData = {
        ...data,
        updatedAt: new Date(),
      };

      await this.db
        .update(this.table)
        .set(updateData as any)
        .where(eq(this.table.id, id));

      return await this.findByIdOrThrow(id);
    });
  }

  /**
   * Hard delete entity (permanent removal)
   */
  async delete(id: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, 'delete', async () => {
      await this.db.delete(this.table).where(eq(this.table.id, id));
    });
  }

  /**
   * Soft delete entity (sets deletedAt timestamp)
   */
  async softDelete(id: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, 'softDelete', async () => {
      const now = new Date();
      await this.db
        .update(this.table)
        .set({ deletedAt: now, updatedAt: now } as any)
        .where(eq(this.table.id, id));
    });
  }

  /**
   * Restore soft-deleted entity
   */
  async restore(id: string): Promise<TSelect> {
    return withQueryLogging(this.logger, this.entityName, 'restore', async () => {
      await this.db
        .update(this.table)
        .set({ deletedAt: null, updatedAt: new Date() } as any)
        .where(eq(this.table.id, id));
      return await this.findByIdOrThrow(id);
    });
  }

  /**
   * Count total entities
   */
  async count(): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, 'count', async () => {
      const result = await this.db.select().from(this.table);
      return result.length;
    });
  }

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    const entity = await this.findById(id);
    return entity !== null;
  }
}
