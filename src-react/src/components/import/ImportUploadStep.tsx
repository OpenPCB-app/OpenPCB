import { useCallback, useState } from "react";
import { Upload, FileIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ImportUploadStepProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
}

export function ImportUploadStep({ files, onFilesChange }: ImportUploadStepProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const newFiles = Array.from(e.dataTransfer.files).filter(
          (file) =>
            file.name.endsWith(".kicad_sym") ||
            file.name.endsWith(".kicad_mod") ||
            file.name.match(/\.(step|stp|wrl)$/i),
        );
        onFilesChange([...files, ...newFiles]);
      }
    },
    [files, onFilesChange],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const newFiles = Array.from(e.target.files).filter(
          (file) =>
            file.name.endsWith(".kicad_sym") ||
            file.name.endsWith(".kicad_mod") ||
            file.name.match(/\.(step|stp|wrl)$/i),
        );
        onFilesChange([...files, ...newFiles]);
      }
    },
    [files, onFilesChange],
  );

  const removeFile = useCallback(
    (index: number) => {
      onFilesChange(files.filter((_, i) => i !== index));
    },
    [files, onFilesChange],
  );

  const getFileTypeBadge = (fileName: string) => {
    if (fileName.endsWith(".kicad_sym")) return "Symbol";
    if (fileName.endsWith(".kicad_mod")) return "Footprint";
    if (fileName.match(/\.(step|stp)$/i)) return "3D Model";
    if (fileName.endsWith(".wrl")) return "VRML";
    return "Unknown";
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[800px] space-y-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Upload KiCAD Files</h2>
          <p className="text-sm text-text-muted mt-1">
            Select or drag KiCAD symbol (.kicad_sym), footprint (.kicad_mod), and 3D model files
            (.step, .stp, .wrl)
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            "relative rounded-lg border-2 border-dashed transition-colors p-12",
            dragActive
              ? "border-brand bg-brand-bg"
              : "border-border-default bg-bg-input hover:border-border-strong",
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            multiple
            accept=".kicad_sym,.kicad_mod,.step,.stp,.wrl"
            onChange={handleFileInput}
          />
          <label
            htmlFor="file-upload"
            className="flex flex-col items-center justify-center cursor-pointer"
          >
            <Upload className="h-12 w-12 text-text-tertiary mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">
              Drop files here or click to browse
            </p>
            <p className="text-xs text-text-muted">
              Supports .kicad_sym, .kicad_mod, .step, .stp, .wrl
            </p>
          </label>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-text-secondary">
              Selected Files ({files.length})
            </h3>
            <div className="space-y-1">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-md border border-border-default bg-bg-elevated px-3 py-2 hover:bg-bg-input transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileIcon className="h-4 w-4 text-text-tertiary flex-shrink-0" />
                    <span className="text-sm text-text-primary truncate">{file.name}</span>
                    <Badge variant="secondary" className="text-[10px] ml-auto flex-shrink-0">
                      {getFileTypeBadge(file.name)}
                    </Badge>
                  </div>
                  <button
                    className="ml-2 text-text-tertiary hover:text-text-secondary flex-shrink-0"
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
