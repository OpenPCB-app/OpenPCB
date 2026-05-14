import type { ReactElement } from "react";
import type { LibraryTagStat } from "../../../../sdks/library";
import type { GroupedTagEntry } from "../tag-grouping";
import { TagChip } from "./TagChip";

interface TagFilterChipsProps {
  groups: GroupedTagEntry[];
  active: ReadonlySet<string>;
  onToggle: (tag: string) => void;
  onClear?: () => void;
  /** When > 0, hide groups whose tags all have count below the threshold. */
  minCount?: number;
}

export function TagFilterChips({
  groups,
  active,
  onToggle,
  onClear,
  minCount = 0,
}: TagFilterChipsProps): ReactElement {
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      tags: group.tags.filter((stat) => stat.count >= minCount),
    }))
    .filter((group) => group.tags.length > 0);

  if (visibleGroups.length === 0) {
    return (
      <div className="px-1 py-1.5 text-xs text-slate-400 dark:text-slate-500">
        No tags yet — import or edit components to add tags.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visibleGroups.map((group) => (
        <div key={group.group.id} className="flex items-start gap-2">
          <span className="mt-1 w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {group.group.label}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {group.tags.map((stat: LibraryTagStat) => (
              <TagChip
                key={stat.tag}
                label={stat.tag}
                count={stat.count}
                active={active.has(stat.tag)}
                onClick={() => onToggle(stat.tag)}
              />
            ))}
          </div>
        </div>
      ))}
      {onClear && active.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="self-start text-[11px] font-medium text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Clear {active.size} filter{active.size === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
