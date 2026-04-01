import React, { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "../../lib/utils";
import { useUnifiedImportStore } from "../../stores/useUnifiedImportStore";

interface UploadStepProps {
  workspaceId: string;
}

export function UploadStep({ workspaceId }: UploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const uploadZip = useUnifiedImportStore((s: { uploadZip: (file: File, workspaceId: string) => Promise<void> }) => s.uploadZip);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith(".zip")) {
        uploadZip(file, workspaceId);
      }
    },
    [uploadZip, workspaceId],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        uploadZip(file, workspaceId);
      }
    },
    [uploadZip, workspaceId],
  );

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        className={cn(
          "w-full max-w-md border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer",
          isDragging
            ? "border-brand bg-brand/5"
            : "border-border-default bg-bg-secondary hover:bg-bg-hover",
        )}
        onClick={() => document.getElementById("zip-upload")?.click()}
      >
        <Upload className="h-12 w-12 text-text-muted mx-auto mb-4" />
        <p className="text-sm text-text-secondary mb-2">
          Drop a ZIP file here, or click to browse
        </p>
        <p className="text-xs text-text-tertiary">
          ZIP should contain .kicad_sym, .kicad_mod, and optionally .step/.stp/.wrl
        </p>
        <input
          id="zip-upload"
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
}
