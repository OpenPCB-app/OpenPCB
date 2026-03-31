import { useState } from "react";
import { AlertCircle, FolderGit2, HardDrive } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePageTree } from "../../hooks/usePageTree";
import { TreeItem } from "./TreeItem";

interface PageTreeProps {
  workspaceId?: string | null;
  onSelectPage: (id: string) => void;
  selectedPageId: string | null;
}

export function PageTree({
  workspaceId,
  onSelectPage,
  selectedPageId,
}: PageTreeProps) {
  const { tree, isLoading, error, refresh } = usePageTree(workspaceId);

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <div className="pl-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-2">
        <Alert variant="destructive" className="text-xs">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error loading pages</AlertTitle>
          <AlertDescription className="mt-1">
            {error}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full h-7 text-xs"
              onClick={() => refresh()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Separate workspace root pages and project roots
  const workspacePages = tree.filter(
    (node) => !node.project_id && !node.is_project_root,
  );
  const projects = tree.filter((node) => node.is_project_root);

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-2">
        {/* Workspace Section */}
        <div>
          <h3 className="mb-1 flex items-center px-2 text-xs font-semibold text-muted-foreground/70 tracking-wider uppercase">
            <HardDrive className="mr-1.5 h-3 w-3" />
            Workspace
          </h3>
          <div className="space-y-[1px]">
            {workspacePages.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground italic">
                No pages yet
              </p>
            ) : (
              workspacePages.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedId={selectedPageId}
                  onSelect={onSelectPage}
                  workspaceId={workspaceId}
                  onRefresh={refresh}
                />
              ))
            )}
          </div>
        </div>

        {/* Projects Section */}
        {projects.length > 0 && (
          <div>
            <h3 className="mb-1 flex items-center px-2 text-xs font-semibold text-muted-foreground/70 tracking-wider uppercase">
              <FolderGit2 className="mr-1.5 h-3 w-3" />
              Projects
            </h3>
            <div className="space-y-[1px]">
              {projects.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedId={selectedPageId}
                  onSelect={onSelectPage}
                  workspaceId={workspaceId}
                  onRefresh={refresh}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
