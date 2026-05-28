import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const designHeads = sqliteTable(
  "designer_design_heads",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    // Cached compact schematic preview (DesignerSchematicPreview JSON) for
    // Home-screen thumbnails. Recomputed lazily when its embedded revision
    // falls behind `revision`.
    schematicPreviewJson: text("schematic_preview_json"),
  },
  (table) => ({
    nameIdx: index("designer_design_heads_name_idx").on(table.name),
  }),
);

export const schematicParts = sqliteTable(
  "designer_schematic_parts",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    componentId: text("component_id").notNull(),
    reference: text("reference").notNull(),
    value: text("value").notNull(),
    positionXNm: integer("position_x_nm").notNull(),
    positionYNm: integer("position_y_nm").notNull(),
    rotationDeg: integer("rotation_deg").notNull().default(0),
    mirrored: integer("mirrored").notNull().default(0),
    symbolSnapshotJson: text("symbol_snapshot_json").notNull(),
    footprintSnapshotJson: text("footprint_snapshot_json").notNull(),
    propertiesJson: text("properties_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_schematic_parts_design_id_idx").on(
      table.designId,
    ),
    designReferenceUq: uniqueIndex("designer_schematic_parts_design_ref_uq").on(
      table.designId,
      table.reference,
    ),
  }),
);

export const schematicPins = sqliteTable(
  "designer_schematic_pins",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    partId: text("part_id").notNull(),
    originPinKey: text("origin_pin_key").notNull(),
    number: text("number"),
    name: text("name").notNull(),
    electricalType: text("electrical_type").notNull(),
    unit: integer("unit").notNull(),
    localXNm: integer("local_x_nm").notNull(),
    localYNm: integer("local_y_nm").notNull(),
    worldXNm: integer("world_x_nm").notNull(),
    worldYNm: integer("world_y_nm").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_schematic_pins_design_id_idx").on(
      table.designId,
    ),
    partIdIdx: index("designer_schematic_pins_part_id_idx").on(table.partId),
    partOriginKeyUq: uniqueIndex(
      "designer_schematic_pins_part_origin_key_uq",
    ).on(table.partId, table.originPinKey),
  }),
);

export const schematicWires = sqliteTable(
  "designer_schematic_wires",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    sourcePinId: text("source_pin_id").notNull(),
    targetPinId: text("target_pin_id").notNull(),
    pointsJson: text("points_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_schematic_wires_design_id_idx").on(
      table.designId,
    ),
    sourcePinIdx: index("designer_schematic_wires_source_pin_idx").on(
      table.sourcePinId,
    ),
    targetPinIdx: index("designer_schematic_wires_target_pin_idx").on(
      table.targetPinId,
    ),
  }),
);

export const schematicLabels = sqliteTable(
  "designer_schematic_labels",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    text: text("text").notNull(),
    xNm: integer("x_nm").notNull(),
    yNm: integer("y_nm").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_schematic_labels_design_id_idx").on(
      table.designId,
    ),
  }),
);

export const schematicPrimitives = sqliteTable(
  "designer_schematic_primitives",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    kind: text("kind").notNull(),
    positionXNm: integer("position_x_nm").notNull(),
    positionYNm: integer("position_y_nm").notNull(),
    rotationDeg: integer("rotation_deg").notNull().default(0),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_schematic_primitives_design_id_idx").on(
      table.designId,
    ),
    designKindIdx: index("designer_schematic_primitives_design_kind_idx").on(
      table.designId,
      table.kind,
    ),
  }),
);

export const pcbEntities = sqliteTable(
  "designer_pcb_entities",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_pcb_entities_design_id_idx").on(
      table.designId,
    ),
    designKindIdx: index("designer_pcb_entities_design_kind_idx").on(
      table.designId,
      table.kind,
    ),
  }),
);

export const commandLog = sqliteTable(
  "designer_command_log",
  {
    commandId: text("command_id").primaryKey(),
    designId: text("design_id").notNull(),
    sessionId: text("session_id").notNull(),
    commandType: text("command_type").notNull(),
    commandJson: text("command_json").notNull(),
    resultJson: text("result_json").notNull(),
    issuedAt: integer("issued_at").notNull(),
    appliedRevision: integer("applied_revision").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_command_log_design_id_idx").on(table.designId),
  }),
);

export const sessionHistories = sqliteTable(
  "designer_session_histories",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    sessionId: text("session_id").notNull(),
    undoStackJson: text("undo_stack_json").notNull(),
    redoStackJson: text("redo_stack_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designSessionUq: uniqueIndex(
      "designer_session_histories_design_session_uq",
    ).on(table.designId, table.sessionId),
    designIdIdx: index("designer_session_histories_design_id_idx").on(
      table.designId,
    ),
  }),
);

export const cloudLink = sqliteTable("designer_cloud_link", {
  designId: text("design_id").primaryKey(),
  cloudDesignId: text("cloud_design_id").notNull(),
  cloudWorkspaceId: text("cloud_workspace_id").notNull(),
  cloudUserId: text("cloud_user_id").notNull(),
  lastSyncedRevision: integer("last_synced_revision").notNull().default(-1),
  linkedAt: text("linked_at").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const bomOverrides = sqliteTable(
  "designer_bom_overrides",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    refdes: text("refdes").notNull(),
    manufacturer: text("manufacturer"),
    manufacturerPartNumber: text("manufacturer_part_number"),
    lcscPartNumber: text("lcsc_part_number"),
    supplier: text("supplier"),
    unitPriceMicros: integer("unit_price_micros"),
    currency: text("currency"),
    dnp: integer("dnp").notNull().default(0),
    assemblySide: text("assembly_side"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designRefUq: uniqueIndex("designer_bom_overrides_design_ref_uq").on(
      table.designId,
      table.refdes,
    ),
    designIdIdx: index("designer_bom_overrides_design_id_idx").on(
      table.designId,
    ),
  }),
);
