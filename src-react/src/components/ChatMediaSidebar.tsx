import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useMediaFiles } from "@/hooks/useMediaFiles";
import type { FileRecord } from "@shared/types/file.types";
import {
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  XIcon,
} from "lucide-react";

interface ChatMediaSidebarProps {
  chatId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function ChatMediaSidebar({
  chatId,
  open,
  onOpenChange,
}: ChatMediaSidebarProps) {
  const { backendURL } = useBackendURL();
  const { files, imageFiles, documentFiles, loading, error } = useMediaFiles(chatId);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [brokenThumbnailIds, setBrokenThumbnailIds] = useState<Set<string>>(new Set());

  const previewFile = useMemo(
    () => files.find((file) => file.id === previewFileId) ?? null,
    [files, previewFileId],
  );

  const markThumbnailBroken = (fileId: string) => {
    setBrokenThumbnailIds((prev) => {
      const next = new Set(prev);
      next.add(fileId);
      return next;
    });
  };

  const openDocument = (fileId: string) => {
    if (!backendURL) return;
    window.open(`${backendURL}/api/files/${fileId}/content`, "_blank", "noopener,noreferrer");
  };

  const renderLoading = () => (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, index) => (
          <Skeleton key={`thumb-${index}`} className="h-24 w-full rounded-md" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`doc-${index}`} className="h-14 w-full rounded-md" />
        ))}
      </div>
    </div>
  );

  const renderEmpty = () => (
    <div className="flex h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <ImageIcon className="size-12 opacity-30" />
      <p>No media shared in this chat yet</p>
    </div>
  );

  const renderImageGrid = (items: FileRecord[]) => {
    if (items.length === 0) {
      return null;
    }

    return (
      <div className="grid grid-cols-3 gap-2">
        {items.map((file) => {
          const thumbnailUrl = backendURL
            ? `${backendURL}/api/files/${file.id}/thumbnail`
            : null;
          const hasBrokenThumbnail = brokenThumbnailIds.has(file.id);

          return (
            <button
              key={file.id}
              type="button"
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
              onClick={() => setPreviewFileId(file.id)}
              title={file.originalName}
            >
              {!thumbnailUrl || hasBrokenThumbnail ? (
                <div className="flex h-full items-center justify-center">
                  <FileIcon className="size-6 text-muted-foreground" />
                </div>
              ) : (
                <img
                  src={thumbnailUrl}
                  alt={file.originalName}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  onError={() => markThumbnailBroken(file.id)}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderDocumentList = (items: FileRecord[]) => {
    if (items.length === 0) {
      return null;
    }

    return (
      <div className="space-y-2">
        {items.map((file) => (
          <button
            key={file.id}
            type="button"
            onClick={() => openDocument(file.id)}
            className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted"
          >
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <FileTextIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.originalName}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.sizeBytes)} • {formatDate(file.createdAt)}
              </p>
            </div>
          </button>
        ))}
      </div>
    );
  };

  const renderAllTab = () => {
    if (files.length === 0) {
      return renderEmpty();
    }

    return (
      <div className="space-y-5">
        {renderImageGrid(imageFiles)}
        {renderDocumentList(documentFiles)}
      </div>
    );
  };

  const renderImagesTab = () => {
    if (imageFiles.length === 0) {
      return renderEmpty();
    }
    return renderImageGrid(imageFiles);
  };

  const renderDocumentsTab = () => {
    if (documentFiles.length === 0) {
      return renderEmpty();
    }
    return renderDocumentList(documentFiles);
  };

  return (
    <>
      {open && (
        <aside
          id="chat-media-sidebar"
          data-testid="chat-media-sidebar"
          className="flex h-full w-[400px] max-w-[400px] shrink-0 flex-col border-l border-border bg-background"
          aria-label="Media and files sidebar"
        >
          <div className="flex items-center justify-between border-b p-6">
            <h2 className="text-base font-semibold">Media & Files</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onOpenChange(false)}
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close media sidebar</span>
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              renderLoading()
            ) : error ? (
              <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-destructive">
                {error}
              </div>
            ) : (
              <Tabs defaultValue="all" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="images">Images</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="mt-4">
                  {renderAllTab()}
                </TabsContent>
                <TabsContent value="images" className="mt-4">
                  {renderImagesTab()}
                </TabsContent>
                <TabsContent value="documents" className="mt-4">
                  {renderDocumentsTab()}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </aside>
      )}

      {previewFile && backendURL && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreviewFileId(null)}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={`${backendURL}/api/files/${previewFile.id}/content`}
              alt={previewFile.originalName}
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
            />

            <div className="absolute right-3 top-3 flex items-center gap-2">
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="bg-background/90 text-foreground hover:bg-background"
              >
                <a
                  href={`${backendURL}/api/files/${previewFile.id}/content`}
                  download={previewFile.originalName}
                >
                  <DownloadIcon className="mr-2 size-4" />
                  Download
                </a>
              </Button>

              <Button
                variant="secondary"
                size="icon"
                className="bg-background/90 text-foreground hover:bg-background"
                onClick={() => setPreviewFileId(null)}
              >
                <XIcon className="size-4" />
                <span className="sr-only">Close preview</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
