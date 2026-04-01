import type { ProjectRecord } from "@shared/types";
// Projects feature is temporarily disabled
// import {
//   FolderIcon,
//   AlertCircleIcon,
// } from "lucide-react";
// import { getProjectIcon } from "@/lib/project-icons";

export interface ProjectBadgeProps {
  project: ProjectRecord | null;
  error?: boolean;
}

export function ProjectBadge(_props: ProjectBadgeProps) {
  // Projects feature is temporarily disabled
  return null;
  /*
  const { project, error } = _props;
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
            const IconComponent = getProjectIcon(project.icon);
            return (
              <IconComponent
                className="h-4 w-4"
                style={{
                  color: project.color || "var(--color-primary)",
                }}
              />
            );
          }
          return <FolderIcon className="h-4 w-4 text-primary" />;
        })()}
        <span className="text-sm font-medium text-foreground">
          {project?.name || "Unknown Project"}
        </span>
      </div>
    </div>
  );
  */
}
