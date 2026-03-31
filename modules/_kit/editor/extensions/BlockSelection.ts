import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface BlockSelectionOptions {
  selectedClass: string;
}

interface BlockSelectionState {
  selectedPositions: Set<number>;
  lastSelectedPos: number | null;
  decorations: DecorationSet;
}

const pluginKey = new PluginKey<BlockSelectionState>("blockSelection");

function getBlockAtPos(
  doc: ProseMirrorNode,
  pos: number,
): { node: ProseMirrorNode; pos: number; end: number } | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (node.isBlock && node.type.name !== "doc") {
      const start = resolved.before(depth);
      return { node, pos: start, end: start + node.nodeSize };
    }
  }
  return null;
}

function createDecorations(
  doc: ProseMirrorNode,
  positions: Set<number>,
  className: string,
): DecorationSet {
  const decorations: Decoration[] = [];

  positions.forEach((pos) => {
    const block = getBlockAtPos(doc, pos);
    if (block) {
      decorations.push(
        Decoration.node(block.pos, block.end, { class: className }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const BlockSelection = Extension.create<BlockSelectionOptions>({
  name: "blockSelection",

  addOptions() {
    return {
      selectedClass: "block-selected",
    };
  },

  addStorage() {
    return {
      selectedPositions: new Set<number>(),
    };
  },

  addCommands() {
    return {
      toggleBlockSelection:
        (pos: number) =>
        ({ editor, tr }) => {
          const state = pluginKey.getState(editor.state);
          if (!state) return false;

          const newSelected = new Set(state.selectedPositions);
          const block = getBlockAtPos(editor.state.doc, pos);
          if (!block) return false;

          const blockPos = block.pos;

          if (newSelected.has(blockPos)) {
            newSelected.delete(blockPos);
          } else {
            newSelected.add(blockPos);
          }

          this.storage.selectedPositions = newSelected;
          editor.view.dispatch(
            tr.setMeta(pluginKey, {
              selectedPositions: newSelected,
              lastSelectedPos: blockPos,
            }),
          );
          return true;
        },

      selectBlockRange:
        (fromPos: number, toPos: number) =>
        ({ editor, tr }) => {
          const { doc } = editor.state;
          const newSelected = new Set<number>();

          const start = Math.min(fromPos, toPos);
          const end = Math.max(fromPos, toPos);

          doc.nodesBetween(start, end, (node, pos) => {
            if (node.isBlock && node.type.name !== "doc" && pos >= start) {
              newSelected.add(pos);
            }
          });

          this.storage.selectedPositions = newSelected;
          editor.view.dispatch(
            tr.setMeta(pluginKey, { selectedPositions: newSelected }),
          );
          return true;
        },

      clearBlockSelection:
        () =>
        ({ editor, tr }) => {
          this.storage.selectedPositions = new Set();
          editor.view.dispatch(
            tr.setMeta(pluginKey, { selectedPositions: new Set() }),
          );
          return true;
        },

      deleteSelectedBlocks:
        () =>
        ({ editor }) => {
          const state = pluginKey.getState(editor.state);
          if (!state || state.selectedPositions.size === 0) return false;

          const positions = Array.from(state.selectedPositions).sort(
            (a, b) => b - a,
          );

          let tr = editor.state.tr;
          for (const pos of positions) {
            const block = getBlockAtPos(tr.doc, pos);
            if (block) {
              tr = tr.delete(block.pos, block.end);
            }
          }

          tr = tr.setMeta(pluginKey, { selectedPositions: new Set() });
          editor.view.dispatch(tr);
          this.storage.selectedPositions = new Set();
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: pluginKey,

        state: {
          init(_config, _state): BlockSelectionState {
            return {
              selectedPositions: new Set(),
              lastSelectedPos: null,
              decorations: DecorationSet.empty,
            };
          },

          apply(tr, value, _oldState, newState): BlockSelectionState {
            const meta = tr.getMeta(pluginKey);

            if (meta) {
              const positions =
                meta.selectedPositions ?? value.selectedPositions;
              return {
                selectedPositions: positions,
                lastSelectedPos: meta.lastSelectedPos ?? value.lastSelectedPos,
                decorations: createDecorations(
                  newState.doc,
                  positions,
                  extension.options.selectedClass,
                ),
              };
            }

            if (tr.docChanged && value.selectedPositions.size > 0) {
              const mappedPositions = new Set<number>();
              value.selectedPositions.forEach((pos) => {
                const mapped = tr.mapping.map(pos);
                if (mapped >= 0 && mapped < newState.doc.content.size) {
                  mappedPositions.add(mapped);
                }
              });

              return {
                ...value,
                selectedPositions: mappedPositions,
                decorations: createDecorations(
                  newState.doc,
                  mappedPositions,
                  extension.options.selectedClass,
                ),
              };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            return (
              pluginKey.getState(state)?.decorations ?? DecorationSet.empty
            );
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        return this.editor.commands.clearBlockSelection();
      },
      Backspace: () => {
        const state = pluginKey.getState(this.editor.state);
        if (state && state.selectedPositions.size > 0) {
          return this.editor.commands.deleteSelectedBlocks();
        }
        return false;
      },
      Delete: () => {
        const state = pluginKey.getState(this.editor.state);
        if (state && state.selectedPositions.size > 0) {
          return this.editor.commands.deleteSelectedBlocks();
        }
        return false;
      },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockSelection: {
      toggleBlockSelection: (pos: number) => ReturnType;
      selectBlockRange: (fromPos: number, toPos: number) => ReturnType;
      clearBlockSelection: () => ReturnType;
      deleteSelectedBlocks: () => ReturnType;
    };
  }
}
