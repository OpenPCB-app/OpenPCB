import { Node, mergeAttributes } from "@tiptap/core";

export interface ToggleOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
      toggleToggle: () => ReturnType;
    };
  }
}

export const Toggle = Node.create<ToggleOptions>({
  name: "toggle",

  group: "block",

  content: "block+",

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: (attributes) => {
          if (attributes.open) {
            return {
              open: "",
            };
          }
          return {};
        },
      },
      summary: {
        default: "Toggle",
        parseHTML: (element) => {
          const summary = element.querySelector("summary");
          return summary?.textContent || "Toggle";
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "details[data-toggle]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { summary, ...restAttributes } = HTMLAttributes;
    return [
      "details",
      mergeAttributes(this.options.HTMLAttributes, restAttributes, {
        "data-toggle": "",
        class: "tiptap-toggle",
      }),
      ["summary", { class: "tiptap-toggle-summary" }, summary || "Toggle"],
      ["div", { class: "tiptap-toggle-content" }, 0],
    ];
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) => {
          return commands.wrapIn(this.name);
        },
      toggleToggle:
        () =>
        ({ commands }) => {
          return commands.toggleWrap(this.name);
        },
    };
  },
});
