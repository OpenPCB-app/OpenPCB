# Unified Component Import - Implementation Plan

## Overview
Create a new "Import" button on the Components screen that accepts ZIP files containing KiCAD format symbol (.kicad_sym), footprint (.kicad_mod), and STEP 3D model files. Process asynchronously with a preview screen showing visualized schematic symbol, footprint, and interactive 3D model before direct save to library.

## Architecture Decision

**NEW SEPARATE FLOW** (not modifying existing ImportWizard)
- Keep existing ImportWizard.tsx for individual file imports
- Create new `UnifiedImportModal` component triggered by new "Import" button
- Cleaner separation of concerns, allows different UX patterns

---

## Phase 1: Database Schema & Data Models

### New Table: `component_import_job`

```typescript
// src-ts/src/db/schema/component-import-job.ts
export const componentImportJob = sqliteTable(
  "component_import_job",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id").notNull(),
    
    // Job status lifecycle
    status: text("status", { 
      enum: ["pending", "uploading", "extracting", "parsing", "preview_ready", "conflict_check", "awaiting_approval", "saving", "completed", "failed", "cancelled"] 
    }).notNull().default("pending"),
    
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
    extractedMetadata: text("extracted_metadata", { mode: "json" }).$type<{
      componentName?: string;
      mpn?: string;
      manufacturer?: string;
      description?: string;
      referencePrefix?: string;
      keywords?: string[];
    }>(),
    
    // Conflict detection
    conflictStatus: text("conflict_status", { 
      enum: ["none", "name_exists", "mpn_exists", "both_exist"] 
    }),
    conflictingFamilyId: text("conflicting_family_id").references(() => componentFamily.id),
    
    // User resolution
    userResolution: text("user_resolution", { 
      enum: ["pending", "create_new", "update_existing", "skip"] 
    }),
    
    // Processing progress (0-100)
    progress: integer("progress").notNull().default(0),
    progressStage: text("progress_stage"), // e.g., "extracting", "parsing_symbol", "checking_conflicts"
    
    // Error information
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    
    // Final result
    createdFamilyId: text("created_family_id").references(() => componentFamily.id),
    
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
  })
);
```

### Types

```typescript
interface ExtractedFileInfo {
  fileName: string;
  fileType: "symbol" | "footprint" | "model3d" | "unknown";
  size: number;
  extractedPath: string; // temp path
}

interface ParsedSymbolData {
  name: string;
  referencePrefix: string;
  pins: Array<{
    number: string;
    name: string;
    electricalType: string;
    unit: number;
    position: { x: number; y: number };
  }>;
  bodyGraphics: unknown[];
  properties: Record<string, string>;
  rawSource: string;
}

interface ParsedFootprintData {
  name: string;
  description?: string;
  tags: string[];
  pads: Array<{
    number: string;
    name?: string;
    shape: string;
    type: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>;
  graphics: unknown[];
  model3dRefs: Array<{
    resolvedFileName: string;
    offset?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    rotate?: { x: number; y: number; z: number };
  }>;
  attributes: {
    smd?: boolean;
    throughHole?: boolean;
  };
  rawSource: string;
}
```

### Migration

```sql
-- drizzle/migrations/00XX_add_component_import_job.sql
CREATE TABLE component_import_job (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  file_id TEXT REFERENCES file(id) ON DELETE SET NULL,
  original_file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  extracted_files TEXT, -- JSON
  parsed_symbol TEXT, -- JSON
  parsed_footprint TEXT, -- JSON
  model_3d_file_id TEXT REFERENCES file(id) ON DELETE SET NULL,
  extracted_metadata TEXT, -- JSON
  conflict_status TEXT,
  conflicting_family_id TEXT REFERENCES component_family(id),
  user_resolution TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  progress_stage TEXT,
  error_code TEXT,
  error_message TEXT,
  created_family_id TEXT REFERENCES component_family(id),
  uploaded_at INTEGER,
  processing_started_at INTEGER,
  preview_ready_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_import_job_workspace ON component_import_job(workspace_id);
CREATE INDEX idx_import_job_status ON component_import_job(status);
CREATE INDEX idx_import_job_workspace_status ON component_import_job(workspace_id, status);
```

---

## Phase 2: Backend Services

### 2.1 ZIP Processing Service

**File:** `src-ts/src/domain/services/component-zip-import-service.ts`

**Dependencies to add:**
```bash
# For Bun - use adm-zip or unzipit (streaming)
bun add adm-zip  # or unzipit for streaming
```

**Service Interface:**

```typescript
export interface IComponentZipImportService {
  // Upload and queue processing
  uploadZip(file: File, workspaceId: string): Promise<ImportJobSummary>;
  
  // Get job status and data
  getJobStatus(jobId: string): Promise<ImportJobStatus>;
  getJobPreview(jobId: string): Promise<ImportPreviewData>;
  
  // User actions
  resolveConflict(jobId: string, resolution: ConflictResolution): Promise<void>;
  approveAndSave(jobId: string, metadata?: MetadataOverrides): Promise<ImportResult>;
  cancelJob(jobId: string): Promise<void>;
  
  // Cleanup
  cleanupOldJobs(olderThanDays: number): Promise<number>;
}

interface ImportJobSummary {
  jobId: string;
  status: ImportJobStatus;
  progress: number;
}

interface ImportPreviewData {
  jobId: string;
  status: "preview_ready" | "awaiting_approval";
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
    previewSvg?: string; // Server-side rendered preview
  };
  footprint: {
    name: string;
    padCount: number;
    mountType: "smd" | "through_hole";
    previewSvg?: string;
  };
  model3d?: {
    fileName: string;
    fileId: string;
    size: number;
    // 3D model will be streamed to viewer directly
  };
  conflicts?: {
    type: "name_exists" | "mpn_exists" | "both_exist";
    existingComponent: {
      id: string;
      displayLabel: string;
      mpn?: string;
    };
  };
  warnings: ImportWarning[];
}
```

**Processing Pipeline (Async):**

```typescript
// Internal method: processJob(jobId: string)
private async processJob(jobId: string): Promise<void> {
  const job = await this.db.importJobs.findById(jobId);
  
  try {
    // Stage 1: Extract ZIP (progress 0-20)
    await this.updateProgress(jobId, 10, "extracting");
    const extractedFiles = await this.extractZip(job.fileId);
    
    // Validate: must have at least symbol + footprint
    if (!extractedFiles.some(f => f.fileType === "symbol")) {
      throw new ImportValidationError("MISSING_SYMBOL", "ZIP must contain a .kicad_sym file");
    }
    if (!extractedFiles.some(f => f.fileType === "footprint")) {
      throw new ImportValidationError("MISSING_FOOTPRINT", "ZIP must contain a .kicad_mod file");
    }
    
    // Stage 2: Parse files (progress 20-50)
    await this.updateProgress(jobId, 30, "parsing_symbol");
    const symbolFile = extractedFiles.find(f => f.fileType === "symbol")!;
    const symbolContent = await fs.readFile(symbolFile.extractedPath, 'utf-8');
    const parsedSymbol = parseKicadSymbolLib(symbolContent);
    
    await this.updateProgress(jobId, 40, "parsing_footprint");
    const footprintFile = extractedFiles.find(f => f.fileType === "footprint")!;
    const footprintContent = await fs.readFile(footprintFile.extractedPath, 'utf-8');
    const parsedFootprint = parseKicadFootprint(footprintContent);
    
    // Stage 3: Process 3D model if present (progress 50-60)
    await this.updateProgress(jobId, 55, "processing_3d_model");
    let model3dFileId: string | undefined;
    const model3dFile = extractedFiles.find(f => f.fileType === "model3d");
    if (model3dFile) {
      model3dFileId = await this.store3dModel(model3dFile);
    }
    
    // Stage 4: Extract metadata (progress 60-70)
    await this.updateProgress(jobId, 65, "extracting_metadata");
    const metadata = this.extractMetadata(parsedSymbol, parsedFootprint);
    
    // Stage 5: Check conflicts (progress 70-80)
    await this.updateProgress(jobId, 75, "checking_conflicts");
    const conflicts = await this.checkConflicts(metadata, workspaceId);
    
    // Stage 6: Generate previews (progress 80-95)
    await this.updateProgress(jobId, 85, "generating_previews");
    // Previews generated on-demand or cached
    
    // Save all parsed data to job record
    await this.db.importJobs.saveParsedData(jobId, {
      extractedFiles,
      parsedSymbol: parsedSymbol.symbols[0],
      parsedFootprint,
      model3dFileId,
      extractedMetadata: metadata,
      conflictStatus: conflicts?.type || "none",
      conflictingFamilyId: conflicts?.existingComponentId,
    });
    
    // Stage 7: Ready for preview (progress 95-100)
    await this.updateProgress(jobId, 100, conflicts ? "awaiting_resolution" : "preview_ready");
    await this.db.importJobs.updateStatus(jobId, conflicts ? "conflict_check" : "preview_ready");
    
  } catch (error) {
    await this.handleProcessingError(jobId, error);
  }
}
```

**ZIP Extraction:**

```typescript
private async extractZip(fileId: string): Promise<ExtractedFileInfo[]> {
  const fileRecord = await this.db.files.findById(fileId);
  const zipPath = await this.storage.getLocalPath(fileRecord.storagePath);
  
  const extractDir = path.join(this.tempDir, fileId);
  await fs.mkdir(extractDir, { recursive: true });
  
  // Use adm-zip for Bun
  const AdmZip = require('adm-zip');
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
    const stats = await fs.stat(extractedPath);
    
    files.push({
      fileName,
      fileType,
      size: stats.size,
      extractedPath,
    });
  }
  
  return files;
}

private classifyFile(fileName: string): ExtractedFileInfo["fileType"] {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.kicad_sym')) return "symbol";
  if (lowerName.endsWith('.kicad_mod')) return "footprint";
  if (lowerName.match(/\.(step|stp|wrl)$/i)) return "model3d";
  return "unknown";
}
```

### 2.2 Conflict Detection Service

```typescript
private async checkConflicts(
  metadata: ExtractedMetadata,
  workspaceId: string
): Promise<ConflictInfo | null> {
  // Check by name
  const existingByName = await this.db.componentFamilies.findByLabel(
    metadata.componentName,
    workspaceId
  );
  
  // Check by MPN if available
  let existingByMpn = null;
  if (metadata.mpn) {
    existingByMpn = await this.db.componentFamilies.findByMpn(
      metadata.mpn,
      workspaceId
    );
  }
  
  if (existingByName && existingByMpn) {
    return {
      type: "both_exist",
      existingComponentId: existingByName.id,
    };
  } else if (existingByName) {
    return {
      type: "name_exists",
      existingComponentId: existingByName.id,
    };
  } else if (existingByMpn) {
    return {
      type: "mpn_exists",
      existingComponentId: existingByMpn.id,
    };
  }
  
  return null;
}
```

### 2.3 Save Service

```typescript
async approveAndSave(
  jobId: string,
  metadataOverrides?: MetadataOverrides
): Promise<ImportResult> {
  const job = await this.db.importJobs.findById(jobId);
  
  if (!job || job.status !== "preview_ready" && job.status !== "conflict_check") {
    throw new ValidationError("Job not in valid state for save");
  }
  
  await this.db.importJobs.updateStatus(jobId, "saving");
  
  try {
    // Determine canonical key
    const componentName = metadataOverrides?.componentName || 
                          job.extractedMetadata?.componentName || 
                          job.parsedSymbol?.name || 
                          "unnamed";
    
    const canonicalKey = this.generateCanonicalKey(componentName);
    
    // Handle different resolution types
    let familyId: string;
    
    if (job.conflictStatus !== "none" && job.userResolution === "update_existing") {
      // Update existing family
      familyId = await this.updateExistingFamily(job, job.conflictingFamilyId!);
    } else {
      // Create new family
      familyId = await this.createNewFamily(job, canonicalKey, metadataOverrides);
    }
    
    // Mark job completed
    await this.db.importJobs.markCompleted(jobId, familyId);
    
    // Cleanup temp files
    await this.cleanupJobFiles(jobId);
    
    return {
      success: true,
      familyId,
      componentName,
    };
    
  } catch (error) {
    await this.db.importJobs.markFailed(jobId, error);
    throw error;
  }
}
```

---

## Phase 3: API Layer

### Controller: `component-zip-import-controller.ts`

```typescript
export class ComponentZipImportController {
  constructor(
    private importService: IComponentZipImportService,
    private db: DatabaseAccess,
  ) {}

  // POST /api/components/import-zip
  async uploadZip(ctx: RouteContext): Promise<Response> {
    const formData = await ctx.req.formData();
    const file = formData.get("file") as File;
    const workspaceId = formData.get("workspaceId") as string;
    
    if (!file || !workspaceId) {
      return ResponseBuilder.badRequest("Missing file or workspaceId");
    }
    
    if (!file.name.endsWith('.zip')) {
      return ResponseBuilder.badRequest("File must be a ZIP archive");
    }
    
    try {
      const job = await this.importService.uploadZip(file, workspaceId);
      return ResponseBuilder.success({ job });
    } catch (error) {
      return ResponseBuilder.error("UPLOAD_FAILED", error.message, 400);
    }
  }

  // GET /api/components/import-zip/:jobId/status
  async getStatus(ctx: RouteContext): Promise<Response> {
    const jobId = ctx.req.param("jobId");
    const status = await this.importService.getJobStatus(jobId);
    return ResponseBuilder.success({ status });
  }

  // GET /api/components/import-zip/:jobId/preview
  async getPreview(ctx: RouteContext): Promise<Response> {
    const jobId = ctx.req.param("jobId");
    const preview = await this.importService.getJobPreview(jobId);
    return ResponseBuilder.success({ preview });
  }

  // POST /api/components/import-zip/:jobId/resolve
  async resolveConflict(ctx: RouteContext): Promise<Response> {
    const jobId = ctx.req.param("jobId");
    const body = await ctx.req.json();
    
    await this.importService.resolveConflict(jobId, body.resolution);
    return ResponseBuilder.success({ message: "Conflict resolved" });
  }

  // POST /api/components/import-zip/:jobId/approve
  async approve(ctx: RouteContext): Promise<Response> {
    const jobId = ctx.req.param("jobId");
    const body = await ctx.req.json();
    
    const result = await this.importService.approveAndSave(jobId, body.metadata);
    return ResponseBuilder.success(result);
  }

  // POST /api/components/import-zip/:jobId/cancel
  async cancel(ctx: RouteContext): Promise<Response> {
    const jobId = ctx.req.param("jobId");
    await this.importService.cancelJob(jobId);
    return ResponseBuilder.success({ message: "Import cancelled" });
  }
}
```

### Route Registration

```typescript
// In router setup
app.post("/api/components/import-zip", controller.uploadZip.bind(controller));
app.get("/api/components/import-zip/:jobId/status", controller.getStatus.bind(controller));
app.get("/api/components/import-zip/:jobId/preview", controller.getPreview.bind(controller));
app.post("/api/components/import-zip/:jobId/resolve", controller.resolveConflict.bind(controller));
app.post("/api/components/import-zip/:jobId/approve", controller.approve.bind(controller));
app.post("/api/components/import-zip/:jobId/cancel", controller.cancel.bind(controller));
```

---

## Phase 4: Frontend Implementation

### 4.1 New Components Structure

```
src-react/src/components/unified-import/
├── UnifiedImportModal.tsx        # Main modal container
├── UploadStep.tsx                # ZIP upload with drag-drop
├── ProcessingIndicator.tsx       # Progress spinner + stage text
├── PreviewScreen.tsx             # Main preview layout (vertical stack)
├── SymbolPreview.tsx             # Canvas-based symbol renderer
├── FootprintPreview.tsx          # Canvas-based footprint renderer
├── Model3DPreview.tsx            # Three.js-based 3D viewer
├── ConflictResolutionDialog.tsx  # Conflict choice modal
├── MetadataEditor.tsx            # Optional metadata editing
└── SuccessScreen.tsx             # Completion confirmation
```

### 4.2 New Store: `useUnifiedImportStore.ts`

```typescript
interface UnifiedImportState {
  // Current job
  jobId: string | null;
  jobStatus: ImportJobStatus | null;
  progress: number;
  progressStage: string | null;
  
  // Preview data
  previewData: ImportPreviewData | null;
  
  // UI state
  isModalOpen: boolean;
  currentStep: "upload" | "processing" | "preview" | "conflict" | "success" | "error";
  error: string | null;
  
  // User inputs
  selectedResolution: ConflictResolution | null;
  metadataOverrides: MetadataOverrides;
  
  // Actions
  openModal: () => void;
  closeModal: () => void;
  uploadZip: (file: File) => Promise<void>;
  pollJobStatus: () => Promise<void>;
  resolveConflict: (resolution: ConflictResolution) => Promise<void>;
  approveImport: () => Promise<void>;
  cancelImport: () => Promise<void>;
}
```

### 4.3 LibraryScreen Modification

Add "Import" button next to "New":

```typescript
// In LibraryScreen.tsx header
<div className="flex items-center gap-2">
  <div className="relative">...search...</div>
  <button
    className="flex items-center gap-1.5 h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
    onClick={() => setWizardOpen(true)}
  >
    <Plus className="h-4 w-4" />
    New
  </button>
  <button
    className="flex items-center gap-1.5 h-9 rounded-md bg-bg-elevated border border-border-default px-4 text-sm font-medium text-text-primary hover:bg-bg-secondary transition-colors"
    onClick={() => setImportModalOpen(true)}
  >
    <Upload className="h-4 w-4" />
    Import
  </button>
</div>

// Add modal
{importModalOpen && (
  <UnifiedImportModal
    onClose={() => setImportModalOpen(false)}
    onSuccess={(familyId) => {
      refetch();
      setSelectedComponent(...);
    }}
  />
)}
```

### 4.4 UploadStep Component

```typescript
export function UploadStep() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const uploadZip = useUnifiedImportStore(s => s.uploadZip);
  
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.zip')) {
      setSelectedFile(file);
      uploadZip(file);
    }
  }, [uploadZip]);
  
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={cn(
          "w-full max-w-md border-2 border-dashed rounded-lg p-12 text-center transition-colors",
          isDragging ? "border-brand bg-brand-bg" : "border-border-default bg-bg-secondary"
        )}
      >
        <Upload className="h-12 w-12 text-text-muted mx-auto mb-4" />
        <p className="text-sm text-text-secondary mb-2">
          Drop a ZIP file here, or click to browse
        </p>
        <p className="text-xs text-text-tertiary">
          ZIP should contain .kicad_sym, .kicad_mod, and optionally .step/.stp/.wrl
        </p>
        <input
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setSelectedFile(file);
              uploadZip(file);
            }
          }}
        />
      </div>
    </div>
  );
}
```

### 4.5 PreviewScreen (Vertical Stack Layout)

```typescript
export function PreviewScreen() {
  const previewData = useUnifiedImportStore(s => s.previewData);
  
  return (
    <div className="flex flex-col h-full">
      {/* Header with metadata */}
      <div className="border-b border-border-default p-4 bg-bg-secondary">
        <h2 className="text-lg font-medium text-text-primary">
          {previewData?.extractedMetadata.componentName}
        </h2>
        <div className="flex gap-4 text-sm text-text-secondary mt-1">
          {previewData?.extractedMetadata.mpn && (
            <span>MPN: {previewData.extractedMetadata.mpn}</span>
          )}
          {previewData?.extractedMetadata.manufacturer && (
            <span>Manufacturer: {previewData.extractedMetadata.manufacturer}</span>
          )}
          <span>Reference: {previewData?.extractedMetadata.referencePrefix}</span>
        </div>
      </div>
      
      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Symbol Preview */}
        <section className="border border-border-default rounded-lg overflow-hidden">
          <div className="bg-bg-secondary px-4 py-2 border-b border-border-default">
            <h3 className="text-sm font-medium text-text-primary">
              Schematic Symbol
            </h3>
          </div>
          <div className="p-4 bg-bg-input min-h-[200px]">
            <SymbolPreview symbolData={previewData?.symbol} />
          </div>
        </section>
        
        {/* Footprint Preview */}
        <section className="border border-border-default rounded-lg overflow-hidden">
          <div className="bg-bg-secondary px-4 py-2 border-b border-border-default">
            <h3 className="text-sm font-medium text-text-primary">
              PCB Footprint
            </h3>
          </div>
          <div className="p-4 bg-bg-input min-h-[200px]">
            <FootprintPreview footprintData={previewData?.footprint} />
          </div>
        </section>
        
        {/* 3D Model Preview */}
        {previewData?.model3d && (
          <section className="border border-border-default rounded-lg overflow-hidden">
            <div className="bg-bg-secondary px-4 py-2 border-b border-border-default">
              <h3 className="text-sm font-medium text-text-primary">
                3D Model
              </h3>
            </div>
            <div className="bg-bg-input min-h-[300px]">
              <Model3DPreview fileId={previewData.model3d.fileId} />
            </div>
          </section>
        )}
      </div>
      
      {/* Action buttons */}
      <div className="border-t border-border-default p-4 flex justify-end gap-3">
        <button
          onClick={() => useUnifiedImportStore.getState().cancelImport()}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          onClick={() => useUnifiedImportStore.getState().approveImport()}
          className="px-4 py-2 bg-brand text-white rounded-md text-sm font-medium hover:opacity-90"
        >
          Import Component
        </button>
      </div>
    </div>
  );
}
```

### 4.6 3D Model Preview (Three.js)

**Install dependencies:**
```bash
cd src-react
bun add three @types/three @react-three/fiber
```

```typescript
import { Canvas } from '@react-three/fiber';
import { useLoader } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { OrbitControls } from '@react-three/drei';

export function Model3DPreview({ fileId }: { fileId: string }) {
  const modelUrl = `/api/files/${fileId}/content`;
  
  // For STEP files, we need conversion. Options:
  // 1. Server-side conversion to glTF/GLB
  // 2. Use OCCT (Open CASCADE) WASM in browser
  // 3. Show message that STEP needs conversion
  
  return (
    <div className="w-full h-[300px]">
      <Canvas camera={{ position: [0, 0, 100], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <OrbitControls enablePan enableZoom enableRotate />
        {/* Model component would go here */}
      </Canvas>
    </div>
  );
}
```

**Note:** STEP file viewing requires either:
- **Option A (Recommended):** Server-side conversion to glTF using Python + Open CASCADE or FreeCAD headless
- **Option B:** Use Three.js with STEP loader (experimental)
- **Option C:** Show placeholder with file info, offer download for external viewer

### 4.7 ConflictResolutionDialog

```typescript
export function ConflictResolutionDialog({
  conflict,
  onResolve,
}: {
  conflict: ImportPreviewData["conflicts"];
  onResolve: (resolution: ConflictResolution) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-elevated rounded-lg max-w-md w-full p-6">
        <h2 className="text-lg font-medium text-text-primary mb-2">
          Component Already Exists
        </h2>
        
        <p className="text-sm text-text-secondary mb-4">
          A component with this {conflict?.type === "name_exists" ? "name" : "MPN"} already exists:
        </p>
        
        <div className="bg-bg-secondary rounded-lg p-4 mb-6">
          <p className="font-medium text-text-primary">
            {conflict?.existingComponent.displayLabel}
          </p>
          {conflict?.existingComponent.mpn && (
            <p className="text-sm text-text-tertiary">
              MPN: {conflict.existingComponent.mpn}
            </p>
          )}
        </div>
        
        <div className="space-y-2">
          <button
            onClick={() => onResolve("create_new")}
            className="w-full text-left px-4 py-3 rounded-lg border border-border-default hover:bg-bg-secondary"
          >
            <p className="font-medium text-text-primary">Create New Component</p>
            <p className="text-xs text-text-tertiary">
              Import as a separate component
            </p>
          </button>
          
          <button
            onClick={() => onResolve("update_existing")}
            className="w-full text-left px-4 py-3 rounded-lg border border-border-default hover:bg-bg-secondary"
          >
            <p className="font-medium text-text-primary">Update Existing</p>
            <p className="text-xs text-text-tertiary">
              Replace the existing component with this import
            </p>
          </button>
          
          <button
            onClick={() => onResolve("skip")}
            className="w-full text-left px-4 py-3 rounded-lg border border-border-default hover:bg-bg-secondary"
          >
            <p className="font-medium text-text-primary">Skip</p>
            <p className="text-xs text-text-tertiary">
              Cancel this import
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Phase 5: Error Handling & Validation

### Error Types

```typescript
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
};
```

### Validation Rules

1. **ZIP Structure:**
   - Must contain at least .kicad_sym and .kicad_mod
   - Maximum 10 files total
   - Maximum 50MB total size
   - No nested ZIPs

2. **KiCAD Format:**
   - Symbol file must be valid s-expression format
   - Footprint must have at least 1 pad
   - Reference prefix must be valid (1-3 characters)

3. **3D Model (optional):**
   - Must be STEP (.step/.stp) or WRL (.wrl) format
   - Maximum 25MB

---

## Phase 6: Implementation Roadmap

### Sprint 1: Foundation (Week 1)
- [ ] Create database schema migration
- [ ] Add adm-zip dependency
- [ ] Create `ComponentZipImportService` skeleton
- [ ] Create controller and routes
- [ ] Basic ZIP extraction and file classification

### Sprint 2: Processing Pipeline (Week 2)
- [ ] Implement async job processing
- [ ] Integrate existing KiCAD parsers
- [ ] Metadata extraction
- [ ] Conflict detection
- [ ] Job status tracking and progress updates

### Sprint 3: Frontend Upload & Processing (Week 3)
- [ ] Create `useUnifiedImportStore`
- [ ] Build `UploadStep` component
- [ ] Build `ProcessingIndicator` component
- [ ] Add "Import" button to LibraryScreen
- [ ] Integrate with API endpoints

### Sprint 4: Preview & Visualization (Week 4)
- [ ] Create `PreviewScreen` with vertical layout
- [ ] Build `SymbolPreview` component (reuse canvas from editor)
- [ ] Build `FootprintPreview` component (reuse canvas from editor)
- [ ] Implement polling for job status

### Sprint 5: 3D Viewer & Conflict Resolution (Week 5)
- [ ] Research and implement 3D viewer solution
- [ ] Build `Model3DPreview` component
- [ ] Create `ConflictResolutionDialog`
- [ ] Implement save/approval flow

### Sprint 6: Polish & Testing (Week 6)
- [ ] Error handling and user-friendly messages
- [ ] Loading states and transitions
- [ ] Unit tests for service
- [ ] Integration tests
- [ ] UI/UX refinements

---

## Open Questions

1. **3D Model Viewer:** Which approach should we take?
   - A) Server-side STEP to glTF conversion (requires Python service)
   - B) Browser-side WASM conversion (slower, experimental)
   - C) Skip 3D preview for now, show file info only

2. **Component Naming:** Should we auto-generate canonical keys from the component name, or use a different strategy?

3. **Category Assignment:** How should we determine component category? Parse from KiCAD, ask user, or leave uncategorized?

4. **Import History:** Should we keep completed import jobs for audit trail, or delete them after success?

5. **Batch Import:** Do you want to support importing multiple ZIPs in sequence without closing the modal?

6. **Preview Quality:** Should symbol/footprint previews be interactive (zoom/pan) or static?

---

## Dependencies to Add

```json
// src-ts/package.json
{
  "dependencies": {
    "adm-zip": "^0.5.10"
  }
}

// src-react/package.json
{
  "dependencies": {
    "three": "^0.160.0",
    "@react-three/fiber": "^8.15.0",
    "@react-three/drei": "^9.92.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0"
  }
}
```

---

## Success Criteria

- [ ] User can click "Import" button on LibraryScreen
- [ ] User can drag-drop or select a ZIP file
- [ ] ZIP is extracted and files are identified automatically
- [ ] Processing happens asynchronously with progress indication
- [ ] Preview screen shows symbol, footprint, and 3D model (if present)
- [ ] User can approve import and component is saved to library
- [ ] Duplicate detection works and prompts user for resolution
- [ ] Error cases are handled gracefully with clear messages
- [ ] No regression in existing Wizard functionality
