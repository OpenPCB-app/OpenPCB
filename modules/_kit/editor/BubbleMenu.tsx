import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link as LinkIcon,
  ChevronDown,
  Palette,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TEXT_COLORS, type ColorOption } from "./ColorPicker";
import { useState } from "react";
import type { ContentSelection } from "@/hooks/useContentEditor";

interface BubbleMenuProps {
  editor: Editor;
  onLinkClick: () => void;
  onAiEdit?: (selection: ContentSelection) => void;
}

const blockTypes = [
  { type: "paragraph", label: "Paragraph", icon: FileText },
  { type: "heading1", label: "Heading 1", icon: Heading1 },
  { type: "heading2", label: "Heading 2", icon: Heading2 },
  { type: "heading3", label: "Heading 3", icon: Heading3 },
  { type: "bulletList", label: "Bullet List", icon: List },
  { type: "orderedList", label: "Numbered List", icon: ListOrdered },
  { type: "taskList", label: "Todo List", icon: CheckSquare },
  { type: "blockquote", label: "Quote", icon: Quote },
];

export function BubbleMenu({ editor, onLinkClick, onAiEdit }: BubbleMenuProps) {
  const [colorMode, setColorMode] = useState<"text" | "background">("text");

  const turnInto = (type: string) => {
    const chain = editor.chain().focus();

    switch (type) {
      case "paragraph":
        chain.setNode("paragraph").run();
        break;
      case "heading1":
        chain.setNode("heading", { level: 1 }).run();
        break;
      case "heading2":
        chain.setNode("heading", { level: 2 }).run();
        break;
      case "heading3":
        chain.setNode("heading", { level: 3 }).run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "taskList":
        chain.toggleTaskList().run();
        break;
      case "blockquote":
        chain.setBlockquote().run();
        break;
    }
  };

  const handleColorChange = (color: ColorOption, mode: "text" | "background") => {
    if (mode === "text") {
      if (color.name === "Default") {
        editor.chain().focus().unsetColor().run();
      } else {
        editor.chain().focus().setColor(color.textColor).run();
      }
    } else {
      if (color.name === "Default") {
        editor.chain().focus().unsetHighlight().run();
      } else {
        editor.chain().focus().setHighlight({ color: color.bgColor }).run();
      }
    }
  };

  const getCurrentBlockType = () => {
    if (editor.isActive("heading", { level: 1 })) return "Heading 1";
    if (editor.isActive("heading", { level: 2 })) return "Heading 2";
    if (editor.isActive("heading", { level: 3 })) return "Heading 3";
    if (editor.isActive("bulletList")) return "Bullet List";
    if (editor.isActive("orderedList")) return "Numbered List";
    if (editor.isActive("taskList")) return "Todo List";
    if (editor.isActive("blockquote")) return "Quote";
    return "Paragraph";
  };

  const handleAiEdit = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;

    onAiEdit?.({ type: "tiptap", from, to, selectedText });
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      options={{
        placement: "top",
        offset: 8,
      }}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-lg"
    >
      {/* Turn Into Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 gap-1 text-xs"
          >
            {getCurrentBlockType()}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {blockTypes.map((block) => {
            const Icon = block.icon;
            return (
              <DropdownMenuItem
                key={block.type}
                onClick={() => turnInto(block.type)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {block.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="mx-1 h-6 w-px bg-border" />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        data-active={editor.isActive("bold")}
        className="h-8 w-8 p-0 data-[active=true]:bg-accent"
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        data-active={editor.isActive("italic")}
        className="h-8 w-8 p-0 data-[active=true]:bg-accent"
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        data-active={editor.isActive("strike")}
        className="h-8 w-8 p-0 data-[active=true]:bg-accent"
        title="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleCode().run()}
        data-active={editor.isActive("code")}
        className="h-8 w-8 p-0 data-[active=true]:bg-accent"
        title="Inline Code"
      >
        <Code className="h-4 w-4" />
      </Button>

      <div className="mx-1 h-6 w-px bg-border" />

      {/* Color Picker */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Text Color"
          >
            <Palette className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="flex gap-1 mb-2">
            <Button
              variant={colorMode === "text" ? "secondary" : "ghost"}
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => setColorMode("text")}
            >
              Text
            </Button>
            <Button
              variant={colorMode === "background" ? "secondary" : "ghost"}
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => setColorMode("background")}
            >
              Background
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.name}
                className="w-8 h-8 rounded border border-border hover:border-primary transition-colors flex items-center justify-center"
                style={
                  colorMode === "text"
                    ? { color: color.textColor }
                    : { backgroundColor: color.bgColor }
                }
                onClick={() => handleColorChange(color, colorMode)}
                title={color.name}
              >
                {colorMode === "text" && "A"}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        onClick={onLinkClick}
        data-active={editor.isActive("link")}
        className="h-8 w-8 p-0 data-[active=true]:bg-accent"
        title="Insert Link"
      >
        <LinkIcon className="h-4 w-4" />
      </Button>

      {onAiEdit && (
        <>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAiEdit}
            className="h-8 w-8 p-0"
            title="Edit with AI"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </>
      )}
    </TiptapBubbleMenu>
  );
}
