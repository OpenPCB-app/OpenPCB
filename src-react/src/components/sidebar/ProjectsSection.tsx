"use client";

import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useNavigationStore } from "@/stores/navigation-store";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

export function ProjectsSection() {
  const { projects, loading } = useProjects();
  const navigateToDesign = useNavigationStore((s) => s.navigateToDesign);
  const navigateToHome = useNavigationStore((s) => s.navigateToHome);

  const filteredProjects = useMemo(() => {
    return projects
      .filter((p) => p.preferences?.showInSidebar === true)
      .sort((a, b) => {
        const orderA = a.sortOrder ?? 0;
        const orderB = b.sortOrder ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });
  }, [projects]);

  const pinnedProjects = filteredProjects.slice(0, 5);

  return (
    <div className="flex flex-col gap-2 px-2">
      <div className="flex items-center justify-between px-2 py-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Projects
        </h3>
      </div>

      <div className="flex flex-col gap-0.5">
        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground animate-pulse">
            Loading...
          </div>
        ) : pinnedProjects.length > 0 ? (
          pinnedProjects.map((project) => (
            <Button
              key={project.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2.5 px-3 py-1.5 text-sm font-medium hover:bg-surface-muted transition-colors rounded-lg group"
              onClick={() => navigateToDesign(project.id)}
            >
              <div
                className="h-2 w-2 rounded-full shrink-0 shadow-xs"
                style={{
                  backgroundColor: project.color || "var(--color-primary)",
                }}
              />
              <span className="truncate flex-1 text-left">{project.name}</span>
            </Button>
          ))
        ) : (
          <div className="px-3 py-3 text-center bg-surface-muted/30 rounded-lg border border-border/50">
            <p className="text-[11px] text-muted-foreground">
              No pinned projects
            </p>
          </div>
        )}
      </div>

      {filteredProjects.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-transparent"
          onClick={() => navigateToHome()}
        >
          <span>See all {filteredProjects.length} projects</span>
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
        </Button>
      )}
    </div>
  );
}
