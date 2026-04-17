import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const designHeads = sqliteTable(
  "designer_design_heads",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
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
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    designIdIdx: index("designer_schematic_parts_design_id_idx").on(table.designId),
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
    designIdIdx: index("designer_schematic_pins_design_id_idx").on(table.designId),
    partIdIdx: index("designer_schematic_pins_part_id_idx").on(table.partId),
    partOriginKeyUq: uniqueIndex("designer_schematic_pins_part_origin_key_uq").on(
      table.partId,
      table.originPinKey,
    ),
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
    designIdIdx: index("designer_schematic_wires_design_id_idx").on(table.designId),
    sourcePinIdx: index("designer_schematic_wires_source_pin_idx").on(table.sourcePinId),
    targetPinIdx: index("designer_schematic_wires_target_pin_idx").on(table.targetPinId),
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
    designIdIdx: index("designer_schematic_labels_design_id_idx").on(table.designId),
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
