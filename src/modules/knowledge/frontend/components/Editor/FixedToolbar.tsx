import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  CodeSquare,
  Link as LinkIcon,
  Undo,
  Redo,
} from "lucide-react";
import { Button } from "@shared/frontend/ui/button";

interface FixedToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={active ? "bg-accent-soft text-accent-text" : undefined}
    >
      {children}
    </Button>
  );
}

export function FixedToolbar({ editor, onLinkClick }: FixedToolbarProps) {
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });
  if (editor.isDestroyed) return null;
  const run = (operation: () => void) => {
    if (!editor.isDestroyed) operation();
  };
  return (
    <div className="flex items-center gap-0.5 border-b border-slate-200 bg-surface-card px-2 py-1.5 overflow-x-auto dark:border-slate-800">
      <ToolbarButton
        onClick={() =>
          run(() => {
            editor.chain().focus().undo().run();
          })
        }
        disabled={!editor.can().undo()}
        title="Undo"
      >
        <Undo className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() =>
          run(() => {
            editor.chain().focus().redo().run();
          })
        }
        disabled={!editor.can().redo()}
        title="Redo"
      >
        <Redo className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleBold().run();
          })
        }
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleItalic().run();
          })
        }
        title="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleStrike().run();
          })
        }
        title="Strikethrough"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("code")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleCode().run();
          })
        }
        title="Inline code"
      >
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <ToolbarButton
        active={editor.isActive("heading", { level: 1 })}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          })
        }
        title="Heading 1"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          })
        }
        title="Heading 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleHeading({ level: 3 }).run();
          })
        }
        title="Heading 3"
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleBulletList().run();
          })
        }
        title="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleOrderedList().run();
          })
        }
        title="Numbered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("taskList")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleTaskList().run();
          })
        }
        title="Task list"
      >
        <ListTodo className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <ToolbarButton
        active={editor.isActive("blockquote")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleBlockquote().run();
          })
        }
        title="Quote"
      >
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("codeBlock")}
        onClick={() =>
          run(() => {
            editor.chain().focus().toggleCodeBlock().run();
          })
        }
        title="Code block"
      >
        <CodeSquare className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("link")}
        onClick={() => run(onLinkClick)}
        title="Link"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}
