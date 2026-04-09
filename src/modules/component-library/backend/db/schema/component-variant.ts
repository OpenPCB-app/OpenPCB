import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { component } from "./component";

const MOUNT_TYPES = ["smd", "through_hole", "virtual"] as const;

export interface FootprintOption {
  id: string;
  variantId?: string; // Optional in input; populated by repository on insert
  label: string;
  isDefault: boolean;
  kicadPayload: Record<string, unknown> | null;
  model3dOptions?: unknown[];
  densityLevel?: "most" | "nominal" | "least" | null;
  ipcName?: string | null;
}

export const componentVariant = sqliteTable(
  "component_variants",
  {
    ...uuidPrimaryKey,
    componentId: text("component_id")
      .notNull()
      .references(() => component.id, { onDelete: "cascade" }),
    canonicalCode: text("canonical_code").notNull(),
    humanLabel: text("human_label").notNull(),
    imperialAlias: text("imperial_alias"),
    metricAlias: text("metric_alias"),
    mountType: text("mount_type", { enum: MOUNT_TYPES }).notNull(),
    dimensions: text("dimensions", { mode: "json" }).$type<{
      lengthMm: number;
      widthMm: number;
      heightMm: number | null;
    } | null>(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    pinRemapTable: text("pin_remap_table", { mode: "json" }).$type<Record<
      string,
      string
    > | null>(),
    footprintOptions: text("footprint_options", { mode: "json" })
      .$type<FootprintOption[]>()
      .notNull()
      .default([]),
    defaultFootprintOptionId: text("default_footprint_option_id"),
    ...timestamps,
  },
  (table) => ({
    componentIdx: index("idx_component_variants_component").on(
      table.componentId,
    ),
    defaultIdx: index("idx_component_variants_default").on(
      table.componentId,
      table.isDefault,
    ),
    canonicalCodeUniqueIdx: uniqueIndex(
      "ux_component_variants_component_code",
    ).on(table.componentId, table.canonicalCode),
  }),
);

export type ComponentVariantRow = typeof componentVariant.$inferSelect;
export type NewComponentVariantRow = typeof componentVariant.$inferInsert;
