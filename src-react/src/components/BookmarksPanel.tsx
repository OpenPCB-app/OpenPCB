import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBookmarks } from "@/hooks/useBookmarks";
import { BookmarkIcon, Loader2Icon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

interface BookmarksPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getMessagePreview(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 150);
  if (Array.isArray(content)) {
    const textPart = content.find((p) => p.type === "text");
    if (textPart && typeof textPart.text === "string") {
      return textPart.text.slice(0, 150);
    }
    return JSON.stringify(content).slice(0, 150);
  }
  if (typeof content === "object" && content !== null) {
    return JSON.stringify(content).slice(0, 150);
  }
  return String(content).slice(0, 150);
}

export function BookmarksPanel({ open, onOpenChange }: BookmarksPanelProps) {
  const { bookmarks, loading, error, remove, updateNote } = useBookmarks();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col p-0 gap-0">
        <SheetHeader className="p-6 border-b">
          <SheetTitle className="flex items-center gap-2">
            <BookmarkIcon className="size-5" />
            Bookmarks
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center text-red-500 px-6 text-center">
              {error}
            </div>
          ) : bookmarks.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <BookmarkIcon className="size-12 opacity-20" />
              <p>No bookmarks yet</p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-4 p-6">
                {bookmarks.map((bookmark) => (
                  <div
                    key={bookmark.id}
                    className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(bookmark.createdAt))}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-6 w-6 -mr-2 -mt-2 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(bookmark.id)}
                      >
                        <TrashIcon className="size-3.5" />
                        <span className="sr-only">Remove bookmark</span>
                      </Button>
                    </div>

                    <div className="text-sm line-clamp-3 text-muted-foreground">
                      {bookmark.message
                        ? getMessagePreview(bookmark.message.content)
                        : "(Message deleted)"}
                    </div>

                    <div className="mt-2">
                      <Textarea
                        placeholder="Add a note..."
                        className="min-h-[60px] text-xs resize-none bg-muted/50 focus:bg-background transition-colors"
                        defaultValue={bookmark.note || ""}
                        onBlur={(e) => {
                          const newNote = e.target.value.trim() || null;
                          if (newNote !== bookmark.note) {
                            updateNote(bookmark.id, newNote);
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
