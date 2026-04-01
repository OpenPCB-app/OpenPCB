import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import {
  presetCatalog,
  type PresetCatalogRow,
  type NewPresetCatalogRow,
} from "../schema/preset-catalog";
import {
  presetVariant,
  type PresetVariantRow,
  type NewPresetVariantRow,
} from "../schema/preset-variant";
import { eq } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import { generateUUIDv7 } from "../schema/base";

export class PresetCatalogRepository extends BaseRepository<
  typeof presetCatalog,
  PresetCatalogRow,
  NewPresetCatalogRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, presetCatalog, logger, "PresetCatalog");
  }

  async findByScope(scope: string): Promise<PresetCatalogRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByScope",
      async () => {
        return this.db
          .select()
          .from(presetCatalog)
          .where(eq(presetCatalog.scope, scope as any));
      },
    );
  }

  async findVariantsByCatalog(catalogId: string): Promise<PresetVariantRow[]> {
    return withQueryLogging(
      this.logger,
      "PresetVariant",
      "findByCatalog",
      async () => {
        return this.db
          .select()
          .from(presetVariant)
          .where(eq(presetVariant.catalogId, catalogId));
      },
    );
  }

  async createVariant(
    data: Omit<NewPresetVariantRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<PresetVariantRow> {
    return withQueryLogging(
      this.logger,
      "PresetVariant",
      "create",
      async () => {
        const id = generateUUIDv7();
        const now = new Date();
        await this.db
          .insert(presetVariant)
          .values({ ...data, id, createdAt: now, updatedAt: now } as never);
        const result = await this.db
          .select()
          .from(presetVariant)
          .where(eq(presetVariant.id, id))
          .limit(1);
        return result[0]!;
      },
    );
  }

  async duplicateToWorkspace(
    sourceId: string,
    newName: string,
  ): Promise<PresetCatalogRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "duplicateToWorkspace",
      async () => {
        const source = await this.findByIdOrThrow(sourceId);
        const sourceVariants = await this.findVariantsByCatalog(sourceId);

        const newCatalog = await this.create({
          name: newName,
          scope: "workspace",
          isImmutable: false,
        });

        for (const sv of sourceVariants) {
          await this.createVariant({
            catalogId: newCatalog.id,
            canonicalCode: sv.canonicalCode,
            humanLabel: sv.humanLabel,
            imperialAlias: sv.imperialAlias,
            metricAlias: sv.metricAlias,
            mountType: sv.mountType,
            typicalDimensions: sv.typicalDimensions,
            pinCount: sv.pinCount,
          });
        }

        return newCatalog;
      },
    );
  }
}
