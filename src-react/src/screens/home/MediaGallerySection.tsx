import { Card } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Image, FileText, Loader2 } from "lucide-react";
import { useFiles } from "@/hooks/useFiles";

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function isImageMime(mimeType: string | null | undefined): boolean {
  return mimeType?.startsWith("image/") ?? false;
}

function getFileTypeLabel(mimeType: string | null | undefined): string {
  if (!mimeType) return "file";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return mimeType.split("/")[0] ?? "file";
}

export function MediaGallerySection() {
  const { files, loading, error } = useFiles({ limit: 20 });

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Media Gallery</h2>
        <div className="flex items-center justify-center h-[160px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Media Gallery</h2>
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Media Gallery</h2>
        <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No media files yet. Upload images or PDFs in your chats.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-8 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Media Gallery</h2>
        <span className="text-sm text-muted-foreground">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      <ScrollArea className="w-full whitespace-nowrap pb-2">
        <div className="flex w-max space-x-4 pb-2">
          {files.map((file) => (
            <Card
              key={file.id}
              className="group flex flex-col justify-between w-[160px] h-[160px] p-2 cursor-pointer hover:bg-surface-muted transition-colors border-none bg-surface shadow-sm overflow-hidden"
              onClick={() => console.log(`Open file ${file.id}`)}
            >
              <div className="flex-1 flex items-center justify-center bg-secondary/30 rounded-md mb-2">
                {isImageMime(file.mimeType) ? (
                  <Image className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <FileText className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="px-1 pb-1">
                <div
                  className="font-medium text-xs truncate"
                  title={file.filename}
                >
                  {file.filename}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  {getFileTypeLabel(file.mimeType)} •{" "}
                  {formatFileSize(file.sizeBytes)}
                </div>
              </div>
            </Card>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
