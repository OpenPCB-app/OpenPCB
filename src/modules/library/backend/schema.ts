import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/**
 * Library schema — three flat tables backing the component library.
 * Tables are prefixed `library_` to share the openpcb.sqlite DB
 * with other modules without collisions.
 */

export const sources = sqliteTable("library_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  license: text("license"),
  homepage: text("homepage"),
  isReadOnly: integer("is_read_only").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const releases = sqliteTable(
  "library_releases",
  {
    sourceId: text("source_id").notNull(),
    version: text("version").notNull(),
    channel: text("channel").notNull(),
    installOrigin: text("install_origin").notNull(),
    packageSha256: text("package_sha256").notNull(),
    signatureValid: integer("signature_valid").notNull().default(0),
    installedAt: text("installed_at").notNull(),
    manifestJson: text("manifest_json").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sourceId, table.version] }),
    sourceIdx: index("library_releases_source_idx").on(table.sourceId),
  }),
);

export const symbols = sqliteTable(
  "library_symbols",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    dataJson: text("data_json").notNull(),
    createdAt: text("created_at").notNull(),
    sourceId: text("source_id"),
    version: text("version"),
    uuid: text("uuid"),
    contentSha256: text("content_sha256"),
  },
  (table) => ({
    sourceIdx: index("library_symbols_source_idx").on(table.sourceId),
  }),
);

export const footprints = sqliteTable(
  "library_footprints",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    dataJson: text("data_json").notNull(),
    createdAt: text("created_at").notNull(),
    sourceId: text("source_id"),
    version: text("version"),
    uuid: text("uuid"),
    contentSha256: text("content_sha256"),
  },
  (table) => ({
    sourceIdx: index("library_footprints_source_idx").on(table.sourceId),
  }),
);

export const footprintModels = sqliteTable("library_footprint_models", {
  footprintId: text("footprint_id")
    .primaryKey()
    .references(() => footprints.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  glbPath: text("glb_path"),
  glbSha256: text("glb_sha256"),
  sourceStepPath: text("source_step_path"),
  sourceStepSha256: text("source_step_sha256"),
  sourceFilename: text("source_filename"),
  sourceByteSize: integer("source_byte_size"),
  modelRefJson: text("model_ref_json"),
  tessellationParamsJson: text("tessellation_params_json"),
  converterVersion: text("converter_version"),
  byteSize: integer("byte_size"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const components = sqliteTable(
  "library_components",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    symbolId: text("symbol_id").notNull(),
    /**
     * Cached default footprint id. The full set of footprints a component can
     * accept lives in `library_component_footprints`; this column stores the
     * one with `is_default = 1` for fast lookup on the read path.
     */
    footprintId: text("footprint_id").notNull(),
    tagsJson: text("tags_json").notNull(),
    createdAt: text("created_at").notNull(),
    isBuiltin: integer("is_builtin").notNull().default(0),
    sourceId: text("source_id"),
    version: text("version"),
    uuid: text("uuid"),
    contentSha256: text("content_sha256"),
    originJson: text("origin_json"),
    // Assembly sourcing. Populated by import paths (KiCad symbol fields,
    // future .opclib sourcing) or the component editor; inherited onto a
    // placement's propertiesJson at place time so the BOM is sourced without
    // a manual override. Null when unknown.
    manufacturer: text("manufacturer"),
    manufacturerPartNumber: text("manufacturer_part_number"),
    lcscPartNumber: text("lcsc_part_number"),
    supplier: text("supplier"),
  },
  (table) => ({
    nameIdx: index("library_components_name_idx").on(table.name),
    isBuiltinIdx: index("library_components_is_builtin_idx").on(
      table.isBuiltin,
    ),
    sourceIdx: index("library_components_source_idx").on(table.sourceId),
  }),
);

/**
 * Content-addressed cache of rendered preview SVGs. Populated lazily by the
 * `/preview.svg` endpoints; identical symbol/footprint payloads share a row.
 */
export const previewSvgs = sqliteTable("library_preview_svgs", {
  contentSha256: text("content_sha256").primaryKey(),
  kind: text("kind").notNull(),
  svg: text("svg").notNull(),
  generatedAt: text("generated_at").notNull(),
});

/**
 * 1:N component → footprint variants.  * lists every footprint it can accept (e.g. R_0402, R_0603, R_THT_axial,...).
 * Exactly one row per component has `isDefault = 1` and matches the cached
 * `library_components.footprintId` for that component.
 */
export const componentFootprints = sqliteTable(
  "library_component_footprints",
  {
    componentId: text("component_id").notNull(),
    footprintId: text("footprint_id").notNull(),
    isDefault: integer("is_default").notNull().default(0),
    variantLabel: text("variant_label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    pinMapJson: text("pinmap_json"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.componentId, table.footprintId] }),
    componentIdx: index("library_component_footprints_component_idx").on(
      table.componentId,
    ),
    defaultIdx: index("library_component_footprints_default_idx").on(
      table.componentId,
      table.isDefault,
    ),
  }),
);
