import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TreeItem, type TreeItemProps } from "./TreeItem";
import type { PageTreeNode } from "../../../shared/types";

export interface SortableTreeItemProps extends Omit<TreeItemProps, "dragHandleProps" | "isDragging"> {
  node: PageTreeNode;
  flatIndex: number;
  isFocused?: boolean;
}

export function SortableTreeItem({
  node,
  flatIndex,
  isFocused,
  ...props
}: SortableTreeItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    data: {
      node,
      flatIndex,
      level: props.level ?? 0,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <TreeItem
        {...props}
        node={node}
        isDragging={isDragging}
        dragHandleProps={listeners}
        isFocused={isFocused}
        flatMode={true}
      />
    </div>
  );
}
