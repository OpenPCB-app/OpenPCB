import type { Editor } from "@tiptap/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Quote,
  Minus,
  AlertCircle,
  ChevronDown,
  Copy,
  Trash2,
  ArrowRight,
  Palette,
} from "lucide-react";
import { TEXT_COLORS, type ColorOption } from "./ColorPicker";

interface BlockMenuProps {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveToClick?: () => void;
  children: React.ReactNode;
}

const blockTypes = [
  { type: "paragraph", label: "Paragraph", icon: FileText },
  { type: "heading1", label: "Heading 1", icon: Heading1 },
  { type: "heading2", label: "Heading 2", icon: Heading2 },
  { type: "heading3", label: "Heading 3", icon: Heading3 },
  { type: "bulletList", label: "Bullet List", icon: List },
  { type: "orderedList", label: "Numbered List", icon: ListOrdered },
  { type: "taskList", label: "Todo List", icon: CheckSquare },
  { type: "codeBlock", label: "Code Block", icon: Code },
  { type: "blockquote", label: "Quote", icon: Quote },
  { type: "horizontalRule", label: "Divider", icon: Minus },
  { type: "callout", label: "Callout", icon: AlertCircle },
  { type: "toggle", label: "Toggle", icon: ChevronDown },
];

export function BlockMenu({
  editor,
  open,
  onOpenChange,
  onMoveToClick,
  children,
}: BlockMenuProps) {
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
      case "codeBlock":
        chain.setCodeBlock().run();
        break;
      case "blockquote":
        chain.setBlockquote().run();
        break;
      case "horizontalRule":
        chain.setHorizontalRule().run();
        break;
      case "callout":
        chain.setCallout("info").run();
        break;
      case "toggle":
        chain.setToggle().run();
        break;
    }

    onOpenChange(false);
  };

  const duplicateBlock = () => {
    const { from, to } = editor.state.selection;
    const content = editor.state.doc.slice(from, to);
    editor
      .chain()
      .focus()
      .insertContentAt(to, content.content.toJSON())
      .run();
    onOpenChange(false);
  };

  const deleteBlock = () => {
    editor.chain().focus().deleteSelection().run();
    onOpenChange(false);
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
    onOpenChange(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {children}
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowRight className="mr-2 h-4 w-4" />
            Turn into
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="mr-2 h-4 w-4" />
            Color
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="p-2 w-48">
            <div className="mb-2 text-xs font-medium text-muted-foreground px-1">
              Text color
            </div>
            <div className="grid grid-cols-4 gap-1 mb-3">
              {TEXT_COLORS.map((color) => (
                <button
                  key={`text-${color.name}`}
                  className="w-8 h-8 rounded border border-border hover:border-primary transition-colors flex items-center justify-center"
                  style={{ color: color.textColor }}
                  onClick={() => handleColorChange(color, "text")}
                  title={color.name}
                >
                  A
                </button>
              ))}
            </div>
            <div className="mb-2 text-xs font-medium text-muted-foreground px-1">
              Background color
            </div>
            <div className="grid grid-cols-4 gap-1">
              {TEXT_COLORS.map((color) => (
                <button
                  key={`bg-${color.name}`}
                  className="w-8 h-8 rounded border border-border hover:border-primary transition-colors"
                  style={{ backgroundColor: color.bgColor }}
                  onClick={() => handleColorChange(color, "background")}
                  title={color.name}
                />
              ))}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={duplicateBlock}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </DropdownMenuItem>

        {onMoveToClick && (
          <DropdownMenuItem onClick={onMoveToClick}>
            <ArrowRight className="mr-2 h-4 w-4" />
            Move to...
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={deleteBlock}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
