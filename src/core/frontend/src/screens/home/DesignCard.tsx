import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  CircleDashed,
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@shared/frontend/ui/card";
import { Pill } from "@shared/frontend/ui/pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";
import type {
  DesignerDrcStatus,
  DesignerSchematicPreview,
} from "@sdks/designer";
import { SchematicThumbnail } from "./SchematicThumbnail";
import { formatRelativeTime } from "./format";

export interface DesignSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  schematicPreview?: DesignerSchematicPreview | null;
  drcStatus?: DesignerDrcStatus | null;
}

interface DesignCardProps {
  design: DesignSummary;
  view: "grid" | "list";
  starred: boolean;
  archived: boolean;
  onOpen: () => void;
  onToggleStar: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/** DRC status badge sourced from the latest persisted run on the summary. */
function DrcPill({ status }: { status?: DesignerDrcStatus | null }) {
  if (!status) {
    return (
      <Pill tone="neutral" icon={<CircleDashed className="h-3 w-3" />}>
        DRC not run
      </Pill>
    );
  }
  if (status.stale) {
    return (
      <Pill
        tone="neutral"
        icon={<CircleDashed className="h-3 w-3" />}
        title={`DRC last ran at r${status.ranAtRevision}; board has changed`}
      >
        DRC stale
      </Pill>
    );
  }
  if (status.errors > 0) {
    return (
      <Pill tone="danger" icon={<AlertOctagon className="h-3 w-3" />}>
        {status.errors} {status.errors === 1 ? "error" : "errors"}
      </Pill>
    );
  }
  if (status.warnings > 0) {
    return (
      <Pill tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>
        {status.warnings} {status.warnings === 1 ? "warning" : "warnings"}
      </Pill>
    );
  }
  return (
    <Pill tone="success" icon={<Check className="h-3 w-3" />}>
      DRC clean
    </Pill>
  );
}

function ActionsMenu({
  archived,
  onToggleArchive,
  onDelete,
}: Pick<DesignCardProps, "archived" | "onToggleArchive" | "onDelete">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More actions"
          onClick={(e) => e.stopPropagation()}
          className="flex rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        {/* No backend endpoint yet — disabled with tooltip (Coming soon). */}
        <DropdownMenuItem disabled title="Coming soon">
          <Pencil className="h-3.5 w-3.5" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled title="Coming soon">
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem disabled title="Coming soon">
          <Download className="h-3.5 w-3.5" /> Export…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onToggleArchive();
          }}
        >
          {archived ? (
            <>
              <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5" /> Archive
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={(e) => {
            e.preventDefault();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StarButton({
  starred,
  onToggle,
}: {
  starred: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={starred ? "Unstar" : "Star"}
      aria-pressed={starred}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex p-0.5",
        starred
          ? "text-amber-500 dark:text-amber-400"
          : "text-slate-300 hover:text-slate-400 dark:text-slate-600 dark:hover:text-slate-500",
      )}
    >
      <Star className="h-3.5 w-3.5" fill={starred ? "currentColor" : "none"} />
    </button>
  );
}

export function DesignCard(props: DesignCardProps) {
  const { design, view, starred, onOpen, onToggleStar } = props;

  if (view === "list") {
    return (
      <Card
        interactive
        onClick={onOpen}
        className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5"
      >
        <div className="h-9 w-16 shrink-0 overflow-hidden rounded">
          <SchematicThumbnail preview={design.schematicPreview} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {design.name}
          </h3>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="rounded bg-slate-100 px-1.5 font-mono text-[10px] text-violet-600 dark:bg-slate-800 dark:text-violet-300">
              r{design.revision}
            </span>
            <span>{formatRelativeTime(design.updatedAt)}</span>
          </div>
        </div>
        <DrcPill status={design.drcStatus} />
        <StarButton starred={starred} onToggle={onToggleStar} />
        <ActionsMenu {...props} />
      </Card>
    );
  }

  return (
    <Card
      interactive
      onClick={onOpen}
      className="cursor-pointer overflow-hidden"
    >
      <div className="aspect-[2/1] overflow-hidden rounded-t-card bg-[#131313]">
        <SchematicThumbnail preview={design.schematicPreview} />
      </div>
      <div className="p-3">
        <div className="mb-1.5 flex items-center justify-between gap-1.5">
          <h3 className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {design.name}
          </h3>
          <StarButton starred={starred} onToggle={onToggleStar} />
        </div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 font-mono text-[10px] text-violet-600 dark:bg-slate-800 dark:text-violet-300">
            r{design.revision}
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span>{formatRelativeTime(design.updatedAt)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
          <DrcPill status={design.drcStatus} />
          <ActionsMenu {...props} />
        </div>
      </div>
    </Card>
  );
}
