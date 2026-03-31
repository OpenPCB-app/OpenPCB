import { useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useNavigationStore } from "@/stores/navigation-store";
import { ProjectCreateDialog } from "@/components/project/ProjectCreateDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Briefcase, Loader2, Plus } from "lucide-react";

export function ProjectsListView() {
  const { projects, loading, error } = useProjects();
  const navigateToDesign = useNavigationStore((s) => s.navigateToDesign);
  const [createOpen, setCreateOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
        <div className="flex items-center justify-center h-[240px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
        <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
        <div className="text-sm text-destructive">{error}</div>
        <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No projects yet. Create one to organize your chats.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="group flex flex-col justify-between p-5 cursor-pointer hover:bg-surface-muted transition-colors border-none bg-surface shadow-sm"
              onClick={() => navigateToDesign(project.id)}
            >
              <div className="flex justify-between items-start">
                <Briefcase className="h-6 w-6 text-primary/70 group-hover:text-primary transition-colors" />
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors border-transparent bg-secondary text-secondary-foreground">
                  {project.status}
                </span>
              </div>
              <div>
                <div className="font-semibold text-base truncate">
                  {project.name}
                </div>
                {project.description && (
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {project.description}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
