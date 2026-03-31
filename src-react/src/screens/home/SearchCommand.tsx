import { useEffect } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useSearch } from "@/hooks/useSearch";
import { useNavigationStore } from "@/stores/navigation-store";
import type { SearchResult } from "@/lib/api/search-api";
import { extractTextContent } from "@shared/types/message.types";

interface SearchCommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function SearchResultItem({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: () => void;
}) {
  const textContent = extractTextContent(result.parts);
  const preview = truncateText(textContent, 100);

  return (
    <CommandItem
      value={result.id}
      onSelect={onSelect}
      className="flex flex-col items-start gap-1 py-3"
    >
      <div className="flex items-center gap-2 w-full">
        <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate flex-1">
          {result.chatTitle || "Untitled Chat"}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDate(result.createdAt)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground pl-6 line-clamp-2">
        {preview}
      </p>
    </CommandItem>
  );
}

export function SearchCommand({ open, onOpenChange }: SearchCommandProps) {
  const { query, setQuery, results, isLoading, clear } = useSearch({
    limit: 20,
  });
  const { navigateToChat } = useNavigationStore();

  useEffect(() => {
    if (!open) {
      clear();
    }
  }, [open, clear]);

  const handleSelect = (result: SearchResult) => {
    navigateToChat(result.chatId);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search messages across all chats"
      showCloseButton={false}
    >
      <CommandInput
        placeholder="Search messages..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[400px]">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && query.trim() && results.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}

        {!isLoading && !query.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Type to search messages...
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <CommandGroup heading="Messages">
            {results.map((result) => (
              <SearchResultItem
                key={result.id}
                result={result}
                onSelect={() => handleSelect(result)}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
