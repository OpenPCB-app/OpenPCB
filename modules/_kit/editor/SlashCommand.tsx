import { ReactRenderer } from "@tiptap/react";
import { SuggestionOptions } from "@tiptap/suggestion";
import tippy, { Instance as TippyInstance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useState, useRef } from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Quote,
  Minus,
  FileText,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

interface CommandItemType {
  title: string;
  description: string;
  icon: React.ReactNode;
  command: (props: { editor: any; range: any }) => void;
}

export const suggestionItems: CommandItemType[] = [
  {
    title: "Paragraph",
    description: "Start writing with plain text",
    icon: <FileText className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("paragraph").run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 1 })
        .run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: <Heading3 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 3 })
        .run();
    },
  },
  {
    title: "Bulleted List",
    description: "Create a simple bulleted list",
    icon: <List className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a list with numbering",
    icon: <ListOrdered className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Todo List",
    description: "Track tasks with a todo list",
    icon: <CheckSquare className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Code Block",
    description: "Syntax highlighted code",
    icon: <Code className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run();
    },
  },
  {
    title: "Blockquote",
    description: "Capture a quote",
    icon: <Quote className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setBlockquote().run();
    },
  },
  {
    title: "Divider",
    description: "Visually divide blocks",
    icon: <Minus className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: "Callout",
    description: "Highlight important information",
    icon: <AlertCircle className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout("info").run();
    },
  },
  {
    title: "Toggle",
    description: "Collapsible content section",
    icon: <ChevronDown className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setToggle().run();
    },
  },
];

interface CommandListProps {
  items: CommandItemType[];
  command: (item: CommandItemType) => void;
}

export const CommandListComponent = forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  CommandListProps
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync ref with state to avoid stale closure in useImperativeHandle
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          (prev + props.items.length - 1) % props.items.length
        );
        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % props.items.length);
        return true;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = props.items[selectedIndexRef.current];
        if (item) {
          props.command(item);
        }
        return true;
      }

      return false;
    },
  }));

  return (
    <div
      className="w-64 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg overflow-hidden"
      role="listbox"
      aria-label="Slash commands"
    >
      <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1">
        {props.items.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No results
          </p>
        ) : (
          props.items.map((item, index) => (
            <button
              key={item.title}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => props.command(item)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors text-left ${index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
                }`}
            >
              <span className="shrink-0 text-muted-foreground/70">{item.icon}</span>
              <div className="flex flex-col">
                <span className="text-sm font-medium leading-none">{item.title}</span>
                <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {item.description}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
});

CommandListComponent.displayName = "CommandListComponent";

export const slashCommandSuggestion: Omit<SuggestionOptions, "editor"> = {
  items: ({ query }: { query: string }) => {
    return suggestionItems.filter((item) =>
      item.title.toLowerCase().startsWith(query.toLowerCase()),
    );
  },

  command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
    props.command({ editor, range });
  },

  render: () => {
    let component: ReactRenderer<any>;
    let popup: TippyInstance[];

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(CommandListComponent, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) {
          return;
        }

        popup = tippy("body", {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        });
      },

      onUpdate(props: any) {
        component.updateProps(props);

        if (!props.clientRect) {
          return;
        }

        popup[0]?.setProps({
          getReferenceClientRect: props.clientRect,
        });
      },

      onKeyDown(props: any) {
        if (props.event.key === "Escape") {
          popup[0]?.hide();
          return true;
        }

        return component.ref?.onKeyDown(props);
      },

      onExit() {
        popup[0]?.destroy();
        component.destroy();
      },
    };
  },
};
