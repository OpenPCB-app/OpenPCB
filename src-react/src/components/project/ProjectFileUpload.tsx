import React, { useRef, useState } from "react";
import { useFileUpload } from "@/hooks/useFileUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { FileRecord } from "@shared/types/file.types";
import { Upload, X, AlertCircle } from "lucide-react";

interface ProjectFileUploadProps {
  workspaceId: string;
  projectId: string;
  onUploadComplete?: (file: FileRecord) => void;
  disabled?: boolean;
}

export function ProjectFileUpload({
  workspaceId,
  projectId,
  onUploadComplete,
  disabled,
}: ProjectFileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload, isUploading, progress, error, reset } = useFileUpload({
    workspaceId,
    projectId,
    onSuccess: (file) => {
      onUploadComplete?.(file);
      setTimeout(reset, 2000);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      upload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled || isUploading) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      upload(file);
    }
  };

  const handleClick = () => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={cn(
          "relative group cursor-pointer rounded-lg border-2 border-dashed transition-all duration-200 p-8 flex flex-col items-center justify-center text-center space-y-2",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
          (disabled || isUploading) && "opacity-50 cursor-not-allowed pointer-events-none"
        )}
      >
        <Input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled || isUploading}
        />

        <div className="p-3 rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
          <Upload className="h-6 w-6" />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">
            {isUploading ? "Uploading..." : "Click to upload or drag and drop"}
          </p>
          <p className="text-xs text-muted-foreground">Drop files here</p>
        </div>
      </div>

      {isUploading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Uploading...</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="flex-1 truncate">{error.message}</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-destructive/20 text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
