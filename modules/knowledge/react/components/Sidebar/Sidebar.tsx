import { useCallback, useState, useEffect } from "react";
import { Search, Plus, Loader2, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SortablePageTree } from "./SortablePageTree";
import { useKnowledgeApi } from "../../hooks/useKnowledgeApi";
import { usePageTree } from "../../hooks/usePageTree";
import { useTreeStore } from "../../stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import { useDebouncedCallback } from "use-debounce";
import type { PageSearchResult } from "../../../shared/types";

interface SidebarProps {
  onSelectPage: (id: string) => void;
  selectedPageId: string | null;
  onPageDeleted?: (id: string) => void;
  lockedPageIds?: ReadonlySet<string>;
}

export function Sidebar({
  onSelectPage,
  selectedPageId,
  onPageDeleted,
  lockedPageIds,
}: SidebarProps) {
  const api = useKnowledgeApi();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const { refresh } = usePageTree(activeWorkspaceId);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const refreshToken = useTreeStore((state) => state.refreshToken);

  // Debounced search
  const performSearch = useDebouncedCallback(async (query: string) => {
    if (!activeWorkspaceId || query.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const results = await api.searchPages(activeWorkspaceId, query, "all");
      setSearchResults(results);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  // Trigger search on query change
  useEffect(() => {
    if (searchQuery.length >= 2) {
      setIsSearching(true);
      performSearch(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, performSearch]);

  useEffect(() => {
    if (refreshToken > 0 && searchQuery.length >= 2) {
      void performSearch(searchQuery);
    }
  }, [refreshToken, searchQuery, performSearch]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const handleSelectSearchResult = useCallback(
    (id: string) => {
      onSelectPage(id);
      handleClearSearch();
    },
    [onSelectPage, handleClearSearch],
  );

  const handleCreatePage = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setIsCreating(true);
    try {
      const page = await api.createPage({
        workspace_id: activeWorkspaceId,
        title: "Untitled",
      });
      if (page) {
        await refresh();
        onSelectPage(page.id);
      }
    } catch (err) {
      console.error("Failed to create page:", err);
    } finally {
      setIsCreating(false);
    }
  }, [activeWorkspaceId, api, refresh, onSelectPage]);

  const isInSearchMode = searchQuery.length >= 2;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-muted/5 pr-1">
      {/* Header Actions */}
      <div className="flex flex-col gap-1 p-3 pb-0">
        <div className="flex items-center gap-1 mb-2">
          <div className="relative flex-1 group mr-2">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full bg-transparent border-none shadow-none focus-visible:ring-0 pl-8 pr-8 text-sm placeholder:text-muted-foreground/50 hover:bg-accent/50 transition-colors rounded-md"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground/70 hover:text-foreground"
            onClick={handleCreatePage}
            disabled={isCreating || !activeWorkspaceId}
            aria-label="New page"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Search Results or Page Tree */}
      {isInSearchMode ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : searchResults.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No pages found for "{searchQuery}"
              </p>
            ) : (
              <div className="space-y-1">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-2">
                  {searchResults.length} result
                  {searchResults.length === 1 ? "" : "s"}
                </p>
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => handleSelectSearchResult(result.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50 transition-colors"
                  >
                    <span className="shrink-0 text-base leading-none">
                      {result.icon || (
                        <FileText className="h-4 w-4 text-muted-foreground/70" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {result.title}
                      </p>
                      {result.breadcrumb && result.breadcrumb.length > 0 && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {result.breadcrumb.join(" / ")}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        <div className="min-h-0 flex-1">
          <SortablePageTree
            workspaceId={activeWorkspaceId}
            onSelectPage={onSelectPage}
            selectedPageId={selectedPageId}
            onPageDeleted={onPageDeleted}
            lockedPageIds={lockedPageIds}
          />
        </div>
      )}
    </div>
  );
}
