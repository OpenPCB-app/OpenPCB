/**
 * Component ZIP Import Service
 *
 * Handles unified ZIP-based component import flow:
 * - Upload and queue processing
 * - Extract ZIP contents
 * - Parse KiCAD files
 * - Detect conflicts
 * - Save to library after user approval
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ComponentImportJobRepository } from "../../db/repositories/component-import-job-repository";
import { ComponentFamilyRepository } from "../../db/repositories/component-family-repository";
import { FileRepository } from "../../db/repositories/file";
import { FileBlobRepository } from "../../db/repositories/file-blob";
import { fileBlob } from "../../db/schema/file-blob";
import {
  type ComponentImportJobRow,
  type ImportJobStatus,
  type ExtractedFileInfo,
  type ExtractedMetadata,
  type ConflictStatus,
  type UserResolution,
  type ImportWarning,
} from "../../db/schema/component-import-job";
import type { ParsedKicadSymbol } from "../../infrastructure/parsers/kicad/kicad-symbol-parser";
import type { ParsedKicadFootprint } from "../../infrastructure/parsers/kicad/kicad-footprint-parser";
import { parseKicadSymbolLib } from "../../infrastructure/parsers/kicad/kicad-symbol-parser";
import { parseKicadFootprint } from "../../infrastructure/parsers/kicad/kicad-footprint-parser";
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../../db/schema";

// User-friendly error messages
const ERROR_MESSAGES: Record<string, string> = {
  MISSING_SYMBOL: "ZIP file must contain a .kicad_sym file",
  MISSING_FOOTPRINT: "ZIP file must contain a .kicad_mod file",
  INVALID_ZIP: "The uploaded file is not a valid ZIP archive",
  SYMBOL_PARSE_ERROR: "Could not parse the schematic symbol file. Check KiCAD format.",
  FOOTPRINT_PARSE_ERROR: "Could not parse the footprint file. Check KiCAD format.",
  TOO_MANY_FILES: "ZIP contains too many files. Expected 2-3 files.",
  FILE_TOO_LARGE: "ZIP file exceeds 50MB limit",
  INVALID_MODEL_FORMAT: "3D model file format not supported (use .step, .stp, or .wrl)",
  PROCESSING_TIMEOUT: "Import processing timed out. Please try again.",
  SAVE_ERROR: "Failed to save component to library. Please try again.",
  EXTRACTION_ERROR: "Failed to extract ZIP file contents",
};

export interface ImportJobSummary {
  jobId: string;
  status: ImportJobStatus;
  progress: number;
  errorMessage?: string;
}

export interface ImportPreviewData {
  jobId: string;
  status: ImportJobStatus;
  extractedMetadata: {
    componentName: string;
    mpn?: string;
    manufacturer?: string;
    description?: string;
    referencePrefix: string;
  };
  symbol: {
    name: string;
    referencePrefix: string;
    pinCount: number;
  };
  footprint: {
    name: string;
    padCount: number;
    mountType: "smd" | "through_hole" | "unknown";
    description?: string;
  };
  model3d?: {
    fileName: string;
    fileId: string;
    size: number;
  };
  conflicts?: {
    type: ConflictStatus;
    existingComponent: {
      id: string;
      displayLabel: string;
      mpn?: string;
    };
  };
  warnings: ImportWarning[];
}

export interface ImportResult {
  success: boolean;
  familyId?: string;
  componentName?: string;
  error?: string;
}

export interface MetadataOverrides {
  componentName?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  referencePrefix?: string;
}

export class ImportValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export interface IComponentZipImportService {
  uploadZip(file: File, workspaceId: string): Promise<ImportJobSummary>;
  getJobStatus(jobId: string): Promise<ImportJobSummary>;
  getJobPreview(jobId: string): Promise<ImportPreviewData>;
  resolveConflict(jobId: string, resolution: UserResolution): Promise<void>;
  approveAndSave(jobId: string, metadata?: MetadataOverrides): Promise<ImportResult>;
  cancelJob(jobId: string): Promise<void>;
  cleanupOldJobs(olderThanDays: number): Promise<number>;
}

export class ComponentZipImportService implements IComponentZipImportService {
  private tempDir: string;

  constructor(
    private jobRepo: ComponentImportJobRepository,
    private familyRepo: ComponentFamilyRepository,
    private fileRepo: FileRepository,
    private fileBlobRepo: FileBlobRepository,
    private db: BunSQLiteDatabase<typeof schema>,
    private storageBasePath: string,
  ) {
    this.tempDir = path.join(storageBasePath, "temp", "import-jobs");
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch {
      // Directory already exists or creation failed
    }
  }

  async uploadZip(file: File, workspaceId: string): Promise<ImportJobSummary> {
    // Validate file
    if (!file.name.endsWith(".zip")) {
      throw new ImportValidationError("INVALID_ZIP", ERROR_MESSAGES.INVALID_ZIP!);
    }

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      throw new ImportValidationError("FILE_TOO_LARGE", ERROR_MESSAGES.FILE_TOO_LARGE!);
    }

    // Create job record
    const job = await this.jobRepo.create({
      workspaceId,
      status: "uploading",
      originalFileName: file.name,
      fileSize: file.size,
      progress: 0,
    });

    try {
      // Store file
      const fileId = await this.storeUploadedFile(file, workspaceId);

      // Update job with file reference
      await this.jobRepo.update(job.id, {
        fileId,
        status: "extracting",
        progress: 5,
        progressStage: "extracting",
      });

      // Start async processing
      this.processJob(job.id).catch((error) => {
        console.error(`Import job ${job.id} failed:`, error);
        this.handleProcessingError(job.id, error);
      });

      return {
        jobId: job.id,
        status: "extracting",
        progress: 5,
      };
    } catch (error) {
      // Mark job as failed if upload fails
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      await this.jobRepo.markFailed(job.id, "UPLOAD_ERROR", errorMessage);
      throw error;
    }
  }

  private async storeUploadedFile(file: File, workspaceId: string): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Calculate checksum
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    // Check if blob already exists
    const existingBlob = await this.fileBlobRepo.findByChecksum(checksum);
    let blobId: string;

    if (existingBlob) {
      blobId = existingBlob.id;
      // Increment ref count
      await this.fileBlobRepo.incrementRefCount(blobId);
    } else {
      // Create new blob
      const now = new Date();
      blobId = crypto.randomUUID();
      const storagePath = path.join("blobs", blobId);
      const fullPath = path.join(this.storageBasePath, storagePath);

      // Write blob to storage first
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);

      // Create blob record
      const blobResult = await this.db
        .insert(fileBlob)
        .values({
          checksum,
          sizeBytes: buffer.length,
          mimeType: "application/zip",
          storagePath,
          refCount: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      blobId = blobResult[0]!.id;
    }

    // Create file record
    const fileRecord = await this.fileRepo.create({
      workspaceId,
      blobId,
      originalName: file.name,
      mimeType: "application/zip",
      sizeBytes: file.size,
    });

    return fileRecord.id;
  }

  private async processJob(jobId: string): Promise<void> {
    const job = await this.jobRepo.findByIdOrThrow(jobId);

    // Check fileId exists
    if (!job.fileId) {
      throw new ImportValidationError("MISSING_FILE", "Job missing file reference");
    }

    try {
      // Stage 1: Extract ZIP (progress 5-20)
      await this.updateProgress(jobId, 10, "extracting");
      const extractedFiles = await this.extractZip(job.fileId);

      // Validate: must have at least symbol + footprint
      const symbolFile = extractedFiles.find((f) => f.fileType === "symbol");
      const footprintFile = extractedFiles.find((f) => f.fileType === "footprint");

      if (!symbolFile) {
        throw new ImportValidationError("MISSING_SYMBOL", ERROR_MESSAGES.MISSING_SYMBOL!);
      }
      if (!footprintFile) {
        throw new ImportValidationError("MISSING_FOOTPRINT", ERROR_MESSAGES.MISSING_FOOTPRINT!);
      }

      // Check file count
      if (extractedFiles.length > 10) {
        throw new ImportValidationError("TOO_MANY_FILES", ERROR_MESSAGES.TOO_MANY_FILES!);
      }

      // Stage 2: Parse files (progress 20-50)
      await this.updateProgress(jobId, 25, "parsing_symbol");
      const symbolContent = await fs.readFile(symbolFile.extractedPath, "utf-8");
      const parsedSymbolLib = parseKicadSymbolLib(symbolContent);
      const parsedSymbol = parsedSymbolLib.symbols[0] ?? null;

      if (!parsedSymbol) {
        throw new ImportValidationError("SYMBOL_PARSE_ERROR", ERROR_MESSAGES.SYMBOL_PARSE_ERROR!);
      }

      await this.updateProgress(jobId, 40, "parsing_footprint");
      const footprintContent = await fs.readFile(footprintFile.extractedPath, "utf-8");
      const parsedFootprint = parseKicadFootprint(footprintContent);

      // Stage 3: Process 3D model if present (progress 50-60)
      await this.updateProgress(jobId, 55, "processing_3d_model");
      let model3dFileId: string | undefined;
      const model3dFile = extractedFiles.find((f) => f.fileType === "model3d");

      if (model3dFile) {
        const modelBuffer = await fs.readFile(model3dFile.extractedPath);
        model3dFileId = await this.storeModel3dFile(
          modelBuffer,
          model3dFile.fileName,
          job.workspaceId,
        );
      }

      // Stage 4: Extract metadata (progress 60-70)
      await this.updateProgress(jobId, 65, "extracting_metadata");
      const metadata = this.extractMetadata(parsedSymbol, parsedFootprint);

      // Stage 5: Check conflicts (progress 70-80)
      await this.updateProgress(jobId, 75, "checking_conflicts");
      const conflicts = await this.checkConflicts(metadata, job.workspaceId);

      // Collect warnings
      const warnings: ImportWarning[] = [];

      // Stage 6: Ready for preview (progress 95-100)
      const conflictStatus: ConflictStatus = conflicts?.type || "none";
      await this.updateProgress(jobId, 100, conflicts ? "awaiting_resolution" : "preview_ready");

      // Save all parsed data to job record
      await this.jobRepo.saveParsedData(jobId, {
        extractedFiles,
        parsedSymbol: parsedSymbol as any,
        parsedFootprint: parsedFootprint as any,
        model3dFileId,
        extractedMetadata: metadata,
        conflictStatus,
        conflictingFamilyId: conflicts?.existingComponentId ?? null,
        warnings,
      });

      // Update final status
      await this.jobRepo.updateStatus(
        jobId,
        conflicts ? "conflict_check" : "preview_ready",
        100,
        conflicts ? "awaiting_resolution" : "preview_ready",
      );
    } catch (error) {
      await this.handleProcessingError(jobId, error);
    }
  }

  private async extractZip(fileId: string): Promise<ExtractedFileInfo[]> {
    const fileRecord = await this.fileRepo.findByIdOrThrow(fileId);
    const zipPath = path.join(this.storageBasePath, "blobs", fileRecord.blobId);

    const extractDir = path.join(this.tempDir, fileId);
    await fs.mkdir(extractDir, { recursive: true });

    // Use adm-zip for Bun
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // Scan extracted files
    const files: ExtractedFileInfo[] = [];
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const fileName = entry.entryName;
      const fileType = this.classifyFile(fileName);
      const extractedPath = path.join(extractDir, fileName);

      try {
        const stats = await fs.stat(extractedPath);
        files.push({
          fileName,
          fileType,
          size: stats.size,
          extractedPath,
        });
      } catch {
        // File might not exist if it was in a subdirectory - skip
      }
    }

    return files;
  }

  private classifyFile(fileName: string): ExtractedFileInfo["fileType"] {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".kicad_sym")) return "symbol";
    if (lowerName.endsWith(".kicad_mod")) return "footprint";
    if (lowerName.match(/\.(step|stp|wrl)$/i)) return "model3d";
    return "unknown";
  }

  private async storeModel3dFile(
    buffer: Buffer,
    originalName: string,
    workspaceId: string,
  ): Promise<string> {
    const mimeType = originalName.toLowerCase().endsWith(".wrl") ? "model/vrml" : "model/step";

    // Calculate checksum
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    // Check if blob already exists
    const existingBlob = await this.fileBlobRepo.findByChecksum(checksum);
    let blobId: string;

    if (existingBlob) {
      blobId = existingBlob.id;
      await this.fileBlobRepo.incrementRefCount(blobId);
    } else {
      // Create new blob
      const now = new Date();
      blobId = crypto.randomUUID();
      const storagePath = path.join("blobs", blobId);
      const fullPath = path.join(this.storageBasePath, storagePath);

      // Write blob to storage first
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);

      // Create blob record
      const blobResult = await this.db
        .insert(fileBlob)
        .values({
          checksum,
          sizeBytes: buffer.length,
          mimeType,
          storagePath,
          refCount: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      blobId = blobResult[0]!.id;
    }

    // Create file record
    const fileRecord = await this.fileRepo.create({
      workspaceId,
      blobId,
      originalName,
      mimeType,
      sizeBytes: buffer.length,
    });

    return fileRecord.id;
  }

  private extractMetadata(
    symbol: ParsedKicadSymbol,
    footprint: ParsedKicadFootprint,
  ): ExtractedMetadata {
    const metadata: ExtractedMetadata = {
      componentName: symbol?.name || footprint?.name || undefined,
      mpn: symbol?.properties?.["MPN"] || symbol?.properties?.["mpn"] || undefined,
      manufacturer:
        symbol?.properties?.["Manufacturer"] || symbol?.properties?.["manufacturer"] || undefined,
      description:
        symbol?.properties?.["Description"] ||
        symbol?.properties?.["description"] ||
        footprint?.description ||
        undefined,
      referencePrefix: symbol?.properties?.["Reference"] || "U",
      keywords: footprint?.tags || [],
    };

    return metadata;
  }

  private async checkConflicts(
    metadata: ExtractedMetadata,
    workspaceId: string,
  ): Promise<{ type: ConflictStatus; existingComponentId: string } | null> {
    if (!metadata.componentName) return null;

    // Check by name
    const existingByName = await this.jobRepo.findExistingByLabel(
      metadata.componentName,
      workspaceId,
    );

    if (existingByName) {
      return {
        type: "name_exists",
        existingComponentId: existingByName.id,
      };
    }

    return null;
  }

  private async updateProgress(
    jobId: string,
    progress: number,
    stage: string,
  ): Promise<void> {
    await this.jobRepo.update(jobId, {
      progress,
      progressStage: stage,
    });
  }

  private async handleProcessingError(jobId: string, error: unknown): Promise<void> {
    const errorCode = error instanceof ImportValidationError ? error.code : "UNKNOWN_ERROR";
    const errorMessage =
      error instanceof Error ? error.message : ERROR_MESSAGES.SAVE_ERROR || "Unknown error";

    await this.jobRepo.markFailed(jobId, errorCode, errorMessage);
  }

  async getJobStatus(jobId: string): Promise<ImportJobSummary> {
    const job = await this.jobRepo.findByIdOrThrow(jobId);

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage ?? undefined,
    };
  }

  async getJobPreview(jobId: string): Promise<ImportPreviewData> {
    const job = await this.jobRepo.findByIdOrThrow(jobId);

    if (!job.parsedSymbol || !job.parsedFootprint) {
      throw new Error("Job not ready for preview");
    }

    const symbol = job.parsedSymbol as unknown as ParsedKicadSymbol;
    const footprint = job.parsedFootprint as unknown as ParsedKicadFootprint;
    const metadata = job.extractedMetadata || {};

    // Determine mount type
    let mountType: "smd" | "through_hole" | "unknown" = "unknown";
    if (footprint.pads.some((p) => p.type === "smd")) {
      mountType = "smd";
    } else if (footprint.pads.some((p) => p.type === "thru_hole" || p.type === "np_thru_hole")) {
      mountType = "through_hole";
    }

    return {
      jobId: job.id,
      status: job.status,
      extractedMetadata: {
        componentName: metadata.componentName || symbol.name || "Unnamed Component",
        mpn: metadata.mpn,
        manufacturer: metadata.manufacturer,
        description: metadata.description || footprint.description,
        referencePrefix: metadata.referencePrefix || "U",
      },
      symbol: {
        name: symbol.name,
        referencePrefix: metadata.referencePrefix || symbol.properties?.["Reference"] || "U",
        pinCount: symbol.pins?.length || 0,
      },
      footprint: {
        name: footprint.name,
        padCount: footprint.pads?.length || 0,
        mountType,
        description: footprint.description,
      },
      model3d: job.model3dFileId
        ? {
            fileName: metadata.componentName || "model.step",
            fileId: job.model3dFileId,
            size: 0, // We don't track size separately for now
          }
        : undefined,
      conflicts: job.conflictStatus && job.conflictStatus !== "none"
        ? {
            type: job.conflictStatus,
            existingComponent: {
              id: job.conflictingFamilyId || "",
              displayLabel: "", // Would need to fetch from family repo
            },
          }
        : undefined,
      warnings: job.warnings || [],
    };
  }

  async resolveConflict(jobId: string, resolution: UserResolution): Promise<void> {
    const job = await this.jobRepo.findByIdOrThrow(jobId);

    if (job.status !== "conflict_check") {
      throw new Error("Job not in conflict state");
    }

    await this.jobRepo.setUserResolution(jobId, resolution);

    if (resolution === "skip") {
      await this.jobRepo.updateStatus(jobId, "cancelled", 100, "cancelled");
    } else {
      await this.jobRepo.updateStatus(jobId, "preview_ready", 100, "preview_ready");
    }
  }

  async approveAndSave(jobId: string, metadata?: MetadataOverrides): Promise<ImportResult> {
    const job = await this.jobRepo.findByIdOrThrow(jobId);

    if (!["preview_ready", "conflict_check"].includes(job.status)) {
      return { success: false, error: "Job not in valid state for save" };
    }

    await this.jobRepo.updateStatus(jobId, "saving", 95, "saving");

    try {
      // Determine component name
      const componentName =
        metadata?.componentName ||
        job.extractedMetadata?.componentName ||
        (job.parsedSymbol as unknown as ParsedKicadSymbol)?.name ||
        "unnamed";

      // Generate canonical key
      const canonicalKey = this.generateCanonicalKey(componentName);

      // Handle resolution
      let familyId: string;

      if (job.conflictStatus !== "none" && job.userResolution === "update_existing") {
        // Update existing family - not implemented in v1
        throw new Error("Update existing not implemented in v1");
      } else {
        // Create new family
        familyId = await this.createNewFamily(job, canonicalKey, metadata);
      }

      // Mark job completed
      await this.jobRepo.markCompleted(jobId, familyId);

      // Cleanup temp files
      await this.cleanupJobFiles(jobId);

      return {
        success: true,
        familyId,
        componentName,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Save failed";
      await this.jobRepo.markFailed(jobId, "SAVE_ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private generateCanonicalKey(componentName: string): string {
    // Convert to lowercase, replace spaces/special chars with underscores
    return componentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private async createNewFamily(
    job: ComponentImportJobRow,
    canonicalKey: string,
    metadata?: MetadataOverrides,
  ): Promise<string> {
    if (!job.parsedSymbol || !job.parsedFootprint) {
      throw new Error("Missing parsed data");
    }

    const symbol = job.parsedSymbol as unknown as ParsedKicadSymbol;
    const footprint = job.parsedFootprint as unknown as ParsedKicadFootprint;

    const componentName =
      metadata?.componentName || job.extractedMetadata?.componentName || symbol.name;

    // Determine mount type
    let mountType: "smd" | "through_hole" | "virtual" = "virtual";
    if (footprint.pads.some((p) => p.type === "smd")) {
      mountType = "smd";
    } else if (footprint.pads.some((p) => p.type === "thru_hole" || p.type === "np_thru_hole")) {
      mountType = "through_hole";
    }

    // Create family with hierarchy
    const result = await this.familyRepo.createFamilyWithHierarchy({
      family: {
        canonicalKey,
        displayLabel: componentName,
        description: metadata?.description || job.extractedMetadata?.description || "",
        scope: "workspace",
        symbolData: {
          ...symbol,
          rawSource: undefined, // Don't store raw source in symbolData
        },
      },
      variants: [
        {
          variant: {
            canonicalCode: "default",
            humanLabel: "Default Variant",
            isDefault: true,
            mountType,
          },
          footprints: [
            {
              footprint: {
                label: footprint.name,
                kicadPayload: {
                  source: footprint.rawSource,
                  name: footprint.name,
                },
                isDefault: true,
              },
              models: job.model3dFileId
                ? [
                    {
                      fileName: job.extractedMetadata?.componentName || "model.step",
                      linkStatus: "valid" as const,
                    },
                  ]
                : [],
            },
          ],
        },
      ],
    });

    return result.family.id;
  }

  private async cleanupJobFiles(jobId: string): Promise<void> {
    const job = await this.jobRepo.findById(jobId);
    if (!job || !job.fileId) return;

    const extractDir = path.join(this.tempDir, job.fileId);
    try {
      await fs.rm(extractDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.jobRepo.updateStatus(jobId, "cancelled", 100, "cancelled");
    await this.cleanupJobFiles(jobId);
  }

  async cleanupOldJobs(olderThanDays: number): Promise<number> {
    const oldJobs = await this.jobRepo.findOldJobs(olderThanDays);
    let cleaned = 0;

    for (const job of oldJobs) {
      await this.cleanupJobFiles(job.id);
      cleaned++;
    }

    return cleaned;
  }
}
