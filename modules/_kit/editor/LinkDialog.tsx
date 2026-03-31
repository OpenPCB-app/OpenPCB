import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LinkDialogProps {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LinkDialog({ editor, open, onOpenChange }: LinkDialogProps) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to);

      const existingLink = editor.getAttributes("link").href;

      setUrl(existingLink || "");
      setText(selectedText || "");
    }
  }, [open, editor]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!url) {
      editor.chain().focus().unsetLink().run();
      onOpenChange(false);
      return;
    }

    const finalUrl =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `https://${url}`;

    if (text && !editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: finalUrl })
        .run();
    } else if (text) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text,
          marks: [{ type: "link", attrs: { href: finalUrl } }],
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: finalUrl })
        .run();
    }

    onOpenChange(false);
    setUrl("");
    setText("");
  };

  const handleRemoveLink = () => {
    editor.chain().focus().unsetLink().run();
    onOpenChange(false);
    setUrl("");
    setText("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Insert Link</DialogTitle>
          <DialogDescription>
            Add a hyperlink to your text. Leave URL empty to remove link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="text">Link Text (optional)</Label>
              <Input
                id="text"
                placeholder="Click here"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editor.isActive("link") && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleRemoveLink}
              >
                Remove Link
              </Button>
            )}
            <Button type="submit">
              {editor.isActive("link") ? "Update" : "Insert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
