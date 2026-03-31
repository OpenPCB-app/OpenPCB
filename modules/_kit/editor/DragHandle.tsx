import { useRef, useState, useCallback, useEffect } from "react";
import { DragHandle as TiptapDragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BlockMenu } from "./BlockMenu";
import { cn } from "@/lib/utils";

interface DragHandleProps {
  editor: Editor;
}

export function DragHandle({ editor }: DragHandleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);

  const handleAddBlock = useCallback(() => {
    const { state } = editor;
    const { selection } = state;
    const { $from } = selection;
    const endOfBlock = $from.end();

    editor
      .chain()
      .focus()
      .insertContentAt(endOfBlock + 1, { type: "paragraph" })
      .focus(endOfBlock + 2)
      .run();
  }, [editor]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <TiptapDragHandle editor={editor} className="drag-handle-wrapper">
      <div
        ref={handleRef}
        className={cn(
          "flex items-center gap-0.5 opacity-0 transition-opacity duration-150",
          "group-hover:opacity-100 hover:opacity-100",
          "[.ProseMirror_&]:opacity-100",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent/50"
          onClick={handleAddBlock}
          title="Add block below"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        <BlockMenu editor={editor} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 cursor-grab text-muted-foreground hover:text-foreground hover:bg-accent/50",
                "active:cursor-grabbing",
                menuOpen && "bg-accent text-foreground",
              )}
              title="Drag to move / Click for options"
              draggable
            >
              <GripVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </BlockMenu>
      </div>
    </TiptapDragHandle>
  );
}
