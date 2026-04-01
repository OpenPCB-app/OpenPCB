/**
 * Component Import Job Schema
 *
 * Tracks unified ZIP-based component import jobs through their lifecycle:
 * - pending → uploading → extracting → parsing → preview_ready → awaiting_approval → saving → completed
 * - Failed/cancelled are terminal states
 *
 * Stores extracted files, parsed KiCAD data, conflict detection, and user resolution.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { componentFamily } from "./component-family";
import { file } from "./file";

/**
 * Import job statuses - represents the full processing pipeline
 */
export const IMPORT_JOB_STATUSES = [
  "pending",          // Job created, waiting for upload
  "uploading",        // File upload in progress
  "extracting",       // ZIP extraction
  "parsing",          // KiCAD file parsing
  "preview_ready",    // Parsed successfully, ready for preview
  "conflict_check",   // Checking for conflicts
  "awaiting_approval", // Waiting for user approval
  "saving",           // Saving to library
  "completed",        // Successfully saved
  "failed",           // Terminal: processing failed
  "cancelled",        // Terminal: user cancelled
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/**
 * Conflict status types
 */
export const CONFLICT_STATUSES = [
  "none",
  "name_exists",
  "mpn_exists",
  "both_exist",
] as const;

export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/**
 * User resolution choices
 */
export const USER_RESOLUTIONS = [
  "pending",
  "create_new",
  "update_existing",
  "skip",
] as const;

export type UserResolution = (typeof USER_RESOLUTIONS)[number];

/**
 * File types that can be extracted from ZIP
 */
export type ExtractedFileType = "symbol" | "footprint" | "model3d" | "unknown";

/**
 * Information about a file extracted from the ZIP
 */
export interface ExtractedFileInfo {
  fileName: string;
  fileType: ExtractedFileType;
  size: number;
  extractedPath: string; // temp path
}

/**
 * Parsed symbol pin data
 */
export interface ParsedSymbolPin {
  number: string;
  name: string;
  electricalType: string;
  unit: number;
  position: { x: number; y: number };
}

/**
 * Parsed symbol data structure
 */
export interface ParsedSymbolData {
  name: string;
  referencePrefix: string;
  pins: ParsedSymbolPin[];
  bodyGraphics: unknown[];
  properties: Record<string, string>;
  rawSource: string;
}

/**
 * Parsed footprint pad data
 */
export interface ParsedFootprintPad {
  number: string;
  name?: string;
  shape: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * Parsed footprint 3D model reference
 */
export interface ParsedModel3dRef {
  resolvedFileName: string;
  offset?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  rotate?: { x: number; y: number; z: number };
}

/**
 * Parsed footprint data structure
 */
export interface ParsedFootprintData {
  name: string;
  description?: string;
  tags: string[];
  pads: ParsedFootprintPad[];
  graphics: unknown[];
  model3dRefs: ParsedModel3dRef[];
  attributes: {
    smd?: boolean;
    throughHole?: boolean;
  };
  rawSource: string;
}

/**
 * Metadata extracted from KiCAD files
 */
export interface ExtractedMetadata {
  componentName?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  referencePrefix?: string;
  keywords?: string[];
}

/**
 * Import warning information
 */
export interface ImportWarning {
  code: string;
  message: string;
  fileName?: string;
}

/**
 * Component import job table
 * Tracks a single ZIP-based component import from upload through completion
 */
export const componentImportJob = sqliteTable(
  "component_import_job",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id").notNull(),

    // Job status lifecycle
    status: text("status", { enum: IMPORT_JOB_STATUSES })
      .notNull()
      .default("pending"),

    // Upload tracking
    fileId: text("file_id").references(() => file.id, { onDelete: "set null" }),
    originalFileName: text("original_file_name").notNull(),
    fileSize: integer("file_size").notNull(),

    // Extracted files (stored as JSON)
    extractedFiles: text("extracted_files", { mode: "json" }).$type<ExtractedFileInfo[]>(),

    // Parsed data (stored as JSON)
    parsedSymbol: text("parsed_symbol", { mode: "json" }).$type<ParsedSymbolData | null>(),
    parsedFootprint: text("parsed_footprint", { mode: "json" }).$type<ParsedFootprintData | null>(),
    model3dFileId: text("model_3d_file_id").references(() => file.id, { onDelete: "set null" }),

    // Metadata extracted from KiCAD
    extractedMetadata: text("extracted_metadata", { mode: "json" }).$type<ExtractedMetadata>(),

    // Conflict detection
    conflictStatus: text("conflict_status", { enum: CONFLICT_STATUSES }),
    conflictingFamilyId: text("conflicting_family_id").references(() => componentFamily.id, { onDelete: "set null" }),

    // User resolution
    userResolution: text("user_resolution", { enum: USER_RESOLUTIONS }),

    // Processing progress (0-100)
    progress: integer("progress").notNull().default(0),
    progressStage: text("progress_stage"), // e.g., "extracting", "parsing_symbol", "checking_conflicts"

    // Error information
    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    // Final result
    createdFamilyId: text("created_family_id").references(() => componentFamily.id, { onDelete: "set null" }),

    // Warnings (non-fatal issues)
    warnings: text("warnings", { mode: "json" }).$type<ImportWarning[]>(),

    // Timestamps
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }),
    processingStartedAt: integer("processing_started_at", { mode: "timestamp_ms" }),
    previewReadyAt: integer("preview_ready_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_import_job_workspace").on(table.workspaceId),
    statusIdx: index("idx_import_job_status").on(table.status),
    workspaceStatusIdx: index("idx_import_job_workspace_status").on(table.workspaceId, table.status),
    conflictingFamilyIdx: index("idx_import_job_conflicting_family").on(table.conflictingFamilyId),
  })
);

export type ComponentImportJobRow = typeof componentImportJob.$inferSelect;
export type NewComponentImportJobRow = typeof componentImportJob.$inferInsert;
