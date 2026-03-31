import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useNavigationStore } from "@/stores/navigation-store";
import { Plus, Search, Settings } from "lucide-react";
import { SearchCommand } from "./SearchCommand";

interface HomeHeaderProps {
  onOpenSettings?: () => void;
}

export function HomeHeader({ onOpenSettings }: HomeHeaderProps) {
  const { navigateToNewChat } = useNavigationStore();
  const [searchOpen, setSearchOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setSearchOpen(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <div className="flex items-center justify-between px-8 py-6 pb-2">
        <div className="flex flex-1 items-center gap-4 max-w-xl">
          <button
            onClick={() => setSearchOpen(true)}
            className="relative flex-1 flex items-center h-10 px-3 bg-surface rounded-md shadow-sm cursor-pointer hover:bg-surface/80 transition-colors text-left"
          >
            <Search className="h-4 w-4 text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">
              Search chats, projects, or files...
            </span>
            <div className="ml-auto">
              <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open settings"
            onClick={onOpenSettings}
          >
            <Settings className="h-5 w-5" />
          </Button>
          <Button
            onClick={() => navigateToNewChat()}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
      </div>

      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
