import type { ProjectRecord } from "@shared/types";
import {
  FolderIcon,
  BoxIcon,
  BriefcaseIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FileIcon,
  GlobeIcon,
  LayersIcon,
  LayoutIcon,
  PackageIcon,
  TerminalIcon,
  AlertCircleIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PROJECT_ICON_MAP: Record<string, LucideIcon> = {
  Box: BoxIcon,
  Briefcase: BriefcaseIcon,
  Code: CodeIcon,
  Cpu: CpuIcon,
  Database: DatabaseIcon,
  File: FileIcon,
  Folder: FolderIcon,
  Globe: GlobeIcon,
  Layers: LayersIcon,
  Layout: LayoutIcon,
  Package: PackageIcon,
  Terminal: TerminalIcon,
};

export interface ProjectBadgeProps {
  project: ProjectRecord | null;
  error?: boolean;
}

export function ProjectBadge({ project, error }: ProjectBadgeProps) {
  if (!project && !error) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-muted/50 backdrop-blur-sm border shadow-sm"
        style={{
          borderColor: project?.color
            ? `${project.color}40`
            : undefined,
        }}
      >
        {(() => {
          if (error) {
            return <AlertCircleIcon className="h-4 w-4 text-destructive" />;
          }
          if (project?.icon) {
            const IconComponent = PROJECT_ICON_MAP[project.icon];
            if (IconComponent) {
              return (
                <IconComponent
                  className="h-4 w-4"
                  style={{
                    color: project.color || "var(--color-primary)",
                  }}
                />
              );
            }
          }
          return <FolderIcon className="h-4 w-4 text-primary" />;
        })()}
        <span className="text-sm font-medium text-foreground">
          {project?.name || "Unknown Project"}
        </span>
      </div>
    </div>
  );
}
