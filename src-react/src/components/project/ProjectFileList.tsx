import { Loader2Icon, FileIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileRecord } from "@shared/types/file.types";

interface ProjectFileListProps {
  files: FileRecord[];
  isLoading: boolean;
  onDelete?: (id: string) => void;
  onFileClick?: (file: FileRecord) => void;
  emptyAction?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function ProjectFileList({
  files,
  isLoading,
  onDelete,
  onFileClick,
  emptyAction,
}: ProjectFileListProps) {
  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FileIcon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">No files yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload or attach files to this project to see them here.
        </p>
        {emptyAction && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={emptyAction}
          >
            Add your first file
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => onFileClick?.(file)}
          className="group relative flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-hover cursor-pointer"
        >
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <FileIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {file.originalName}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatFileSize(file.sizeBytes)}</span>
              <span>•</span>
              <span>
                {file.updatedAt
                  ? new Date(file.updatedAt).toLocaleDateString()
                  : "Unknown date"}
              </span>
            </div>
          </div>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(file.id);
              }}
            >
              <TrashIcon className="size-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
