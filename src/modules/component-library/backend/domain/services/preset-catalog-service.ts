/**
 * Preset Catalog Service
 *
 * Manages built-in and workspace-extensible package preset catalogs.
 * Built-in presets are immutable; workspace presets are duplicated copies.
 */

import type { PresetCatalogRepository } from "../../db/repositories/preset-catalog-repository";
import type { PresetCatalogRow } from "../../db/schema/preset-catalog";
import type { PresetVariantRow } from "../../db/schema/preset-variant";

export interface PresetCatalogWithVariants {
  catalog: PresetCatalogRow;
  variants: PresetVariantRow[];
}

export interface IPresetCatalogService {
  listAll(): Promise<PresetCatalogWithVariants[]>;
  listByScope(scope: string): Promise<PresetCatalogWithVariants[]>;
  duplicateToWorkspace(
    catalogId: string,
    newName: string,
  ): Promise<PresetCatalogWithVariants>;
  seedBuiltIns(): Promise<void>;
}

/** Built-in chip sizes for Resistor and Capacitor families */
const CHIP_SIZES = [
  { code: "0201", imperial: "0201", metric: "0603", length: 0.6, width: 0.3 },
  { code: "0402", imperial: "0402", metric: "1005", length: 1.0, width: 0.5 },
  { code: "0603", imperial: "0603", metric: "1608", length: 1.6, width: 0.8 },
  { code: "0805", imperial: "0805", metric: "2012", length: 2.0, width: 1.25 },
  { code: "1206", imperial: "1206", metric: "3216", length: 3.2, width: 1.6 },
  { code: "1210", imperial: "1210", metric: "3225", length: 3.2, width: 2.5 },
  { code: "2010", imperial: "2010", metric: "5025", length: 5.0, width: 2.5 },
  { code: "2512", imperial: "2512", metric: "6332", length: 6.3, width: 3.2 },
] as const;

/** Built-in electrolytic sizes for Capacitor family */
const ELECTROLYTIC_SIZES = [
  { code: "4x5.4", length: 4.0, width: 4.0, height: 5.4 },
  { code: "5x5.4", length: 5.0, width: 5.0, height: 5.4 },
  { code: "6.3x5.4", length: 6.3, width: 6.3, height: 5.4 },
  { code: "6.3x7.7", length: 6.3, width: 6.3, height: 7.7 },
  { code: "8x10", length: 8.0, width: 8.0, height: 10.0 },
] as const;

export class PresetCatalogService implements IPresetCatalogService {
  constructor(private repo: PresetCatalogRepository) {}

  async listAll(): Promise<PresetCatalogWithVariants[]> {
    const catalogs = await this.repo.findMany();
    return Promise.all(
      catalogs.map(async (catalog) => ({
        catalog,
        variants: await this.repo.findVariantsByCatalog(catalog.id),
      })),
    );
  }

  async listByScope(scope: string): Promise<PresetCatalogWithVariants[]> {
    const catalogs = await this.repo.findByScope(scope);
    return Promise.all(
      catalogs.map(async (catalog) => ({
        catalog,
        variants: await this.repo.findVariantsByCatalog(catalog.id),
      })),
    );
  }

  async duplicateToWorkspace(
    catalogId: string,
    newName: string,
  ): Promise<PresetCatalogWithVariants> {
    const newCatalog = await this.repo.duplicateToWorkspace(catalogId, newName);
    const variants = await this.repo.findVariantsByCatalog(newCatalog.id);
    return { catalog: newCatalog, variants };
  }

  async seedBuiltIns(): Promise<void> {
    // Check if already seeded
    const existing = await this.repo.findByScope("built_in");
    if (existing.length > 0) return;

    // Seed Resistor chip sizes
    const resistorCatalog = await this.repo.create({
      name: "SMD Chip Resistor",
      scope: "built_in",
      isImmutable: true,
    });
    for (const size of CHIP_SIZES) {
      await this.repo.createVariant({
        catalogId: resistorCatalog.id,
        canonicalCode: size.code,
        humanLabel: `${size.imperial} / ${size.metric} Metric`,
        imperialAlias: size.imperial,
        metricAlias: size.metric,
        mountType: "smd",
        typicalDimensions: {
          lengthMm: size.length,
          widthMm: size.width,
          heightMm: null,
        },
        pinCount: 2,
      });
    }

    // Seed Capacitor chip sizes
    const capChipCatalog = await this.repo.create({
      name: "SMD Chip Capacitor",
      scope: "built_in",
      isImmutable: true,
    });
    for (const size of CHIP_SIZES) {
      await this.repo.createVariant({
        catalogId: capChipCatalog.id,
        canonicalCode: size.code,
        humanLabel: `${size.imperial} / ${size.metric} Metric`,
        imperialAlias: size.imperial,
        metricAlias: size.metric,
        mountType: "smd",
        typicalDimensions: {
          lengthMm: size.length,
          widthMm: size.width,
          heightMm: null,
        },
        pinCount: 2,
      });
    }

    // Seed Capacitor electrolytic sizes
    const capElecCatalog = await this.repo.create({
      name: "Electrolytic Capacitor",
      scope: "built_in",
      isImmutable: true,
    });
    for (const size of ELECTROLYTIC_SIZES) {
      await this.repo.createVariant({
        catalogId: capElecCatalog.id,
        canonicalCode: size.code,
        humanLabel: `${size.code} mm`,
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        typicalDimensions: {
          lengthMm: size.length,
          widthMm: size.width,
          heightMm: size.height,
        },
        pinCount: 2,
      });
    }
  }
}
