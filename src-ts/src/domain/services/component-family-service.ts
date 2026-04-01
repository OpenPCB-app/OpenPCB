/**
 * Component Family Service
 *
 * Manages built-in component families with symbol templates.
 * Seeds 12 core component types (resistor, capacitor, etc.) on startup.
 * GND/VCC remain hardcoded in frontend as net-defining symbols.
 */

import type { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";
import type { ComponentFamilyRow } from "../../db/schema/component-family";
import {
  generateBuiltinComponentFamilySeed,
  type ComponentFamilySeedRow,
} from "../../db/seed/builtin-component-families";

export interface IComponentFamilyService {
  seedBuiltIns(): Promise<void>;
  findByScope(scope: string): Promise<ComponentFamilyRow[]>;
  findByScopeAndKey(
    scope: string,
    key: string,
  ): Promise<ComponentFamilyRow | null>;
}

export class ComponentFamilyService implements IComponentFamilyService {
  constructor(private repo: ComponentFamilyRepository) {}

  async findByScope(scope: string): Promise<ComponentFamilyRow[]> {
    return this.repo.findByScope(scope);
  }

  async findByScopeAndKey(
    scope: string,
    key: string,
  ): Promise<ComponentFamilyRow | null> {
    return this.repo.findByScopeAndKey(scope, key);
  }

  async seedBuiltIns(): Promise<void> {
    // Check if already seeded
    const existing = await this.repo.findByScope("built_in");
    if (existing.length > 0) {
      console.log(
        `[ComponentFamily] Already seeded (${existing.length} built-in families)`,
      );
      return;
    }

    console.log("[ComponentFamily] Seeding built-in component families...");

    const seedData = generateBuiltinComponentFamilySeed();
    let seeded = 0;

    for (const row of seedData) {
      try {
        await this.repo.create({
          id: row.id,
          canonicalKey: row.canonicalKey,
          displayLabel: row.displayLabel,
          description: row.description,
          scope: row.scope,
          symbolData: row.symbolData,
          defaultPackageVariantId: row.defaultPackageVariantId,
          categoryPath: row.categoryPath,
          tags: row.tags,
        });
        seeded++;
      } catch (err) {
        console.error(
          `[ComponentFamily] Failed to seed ${row.canonicalKey}:`,
          err,
        );
      }
    }

    console.log(
      `[ComponentFamily] Seeded ${seeded}/${seedData.length} built-in component families`,
    );
  }
}
