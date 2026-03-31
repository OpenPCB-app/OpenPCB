import { useState, useMemo } from "react";
import { Check, Plus, Search, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { TagBadge } from "./TagBadge";
import { useTags } from "@/hooks/useTags";
import { cn } from "@/lib/utils";

interface TagSelectorProps {
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  onCreateTag?: (name: string, color?: string) => void;
  className?: string;
  projectId?: string;
}

export function TagSelector({
  selectedTagIds,
  onToggleTag,
  onCreateTag,
  className,
  projectId,
}: TagSelectorProps) {
  const { tags, loading, createTag } = useTags(projectId);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredTags = useMemo(() => {
    return tags.filter((tag) =>
      tag.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [tags, search]);

  const exactMatch = filteredTags.find(
    (t) => t.name.toLowerCase() === search.toLowerCase(),
  );

  const handleCreate = async () => {
    if (!search.trim()) return;

    try {
      let newTag;
      if (onCreateTag) {
        onCreateTag(search);
      } else {
        const colors = [
          "#ef4444",
          "#f97316",
          "#f59e0b",
          "#84cc16",
          "#10b981",
          "#06b6d4",
          "#3b82f6",
          "#8b5cf6",
          "#d946ef",
          "#f43f5e",
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        newTag = await createTag({
          name: search,
          color: randomColor,
        });

        if (newTag) {
          onToggleTag(newTag.id);
        }
      }
      setSearch("");
    } catch (error) {
      console.error("Failed to create tag:", error);
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 border-dashed gap-1", className)}
        >
          <TagIcon className="h-3.5 w-3.5" />
          <span className="text-xs">Tags</span>
          {selectedTagIds.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {selectedTagIds.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px] p-0">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            className="flex h-4 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Search tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1">
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : filteredTags.length === 0 && !search ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No tags found
            </div>
          ) : (
            <>
              {filteredTags.map((tag) => (
                <DropdownMenuItem
                  key={tag.id}
                  onSelect={() => onToggleTag(tag.id)}
                  className="gap-2"
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                      selectedTagIds.includes(tag.id)
                        ? "bg-primary text-primary-foreground"
                        : "opacity-50 [&_svg]:invisible",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </div>
                  <TagBadge tag={tag} size="sm" />
                </DropdownMenuItem>
              ))}

              {search && !exactMatch && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={handleCreate}
                    className="gap-2 text-muted-foreground"
                  >
                    <Plus className="h-4 w-4" />
                    Create "{search}"
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
