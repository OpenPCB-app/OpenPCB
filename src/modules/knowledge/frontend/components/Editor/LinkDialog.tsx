import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@shared/frontend/ui/button";

interface LinkDialogProps {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LinkDialog({ editor, open, onOpenChange }: LinkDialogProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (open && !editor.isDestroyed) {
      const attrs = editor.getAttributes("link");
      setUrl(attrs.href ?? "");
    }
  }, [open, editor]);

  const handleSave = () => {
    if (editor.isDestroyed) return;
    if (url.trim()) {
      editor.chain().focus().setLink({ href: url.trim() }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    onOpenChange(false);
  };

  const handleRemove = () => {
    if (editor.isDestroyed) return;
    editor.chain().focus().unsetLink().run();
    onOpenChange(false);
  };

  if (editor.isDestroyed) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,24rem)] p-4">
        <DialogTitle className="text-sm font-semibold">Link</DialogTitle>
        <div className="mt-3 flex flex-col gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemove}>
              Remove
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
