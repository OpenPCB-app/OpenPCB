import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface CategoryNode {
  name: string;
  path: string;
  children: CategoryNode[];
  count: number;
}

interface CategoryTreeProps {
  categories: CategoryNode[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}

export function CategoryTree({
  categories,
  selectedPath,
  onSelect,
}: CategoryTreeProps) {
  return (
    <div className="space-y-0.5">
      {categories.map((category) => (
        <CategoryNode
          key={category.path}
          category={category}
          level={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface CategoryNodeProps {
  category: CategoryNode;
  level: number;
  selectedPath?: string;
  onSelect: (path: string) => void;
}

function CategoryNode({
  category,
  level,
  selectedPath,
  onSelect,
}: CategoryNodeProps) {
  const [isExpanded, setIsExpanded] = useState(
    selectedPath?.startsWith(category.path) ?? false,
  );
  const isSelected = selectedPath === category.path;
  const hasChildren = category.children.length > 0;

  return (
    <div>
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-md transition-colors text-left",
          isSelected
            ? "bg-brand-bg text-brand font-medium"
            : "text-text-secondary hover:bg-bg-elevated",
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (hasChildren) {
            setIsExpanded(!isExpanded);
          }
          onSelect(category.path);
        }}
      >
        {hasChildren ? (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform flex-shrink-0",
              isExpanded && "rotate-90",
            )}
          />
        ) : (
          <div className="w-3.5" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
        ) : (
          <Folder className="h-4 w-4 flex-shrink-0" />
        )}
        <span className="flex-1 truncate">{category.name}</span>
        <span className="text-xs text-text-muted tabular-nums">
          {category.count}
        </span>
      </button>

      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {category.children.map((child) => (
            <CategoryNode
              key={child.path}
              category={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
