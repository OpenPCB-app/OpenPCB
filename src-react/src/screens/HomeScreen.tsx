import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAppStore } from "@/stores/app-store";
import { DesignDialog } from "@/components/design/DesignDialog";
import { useDesigns } from "@/hooks/useDesigns";

export function HomeScreen() {
  const navigateToDesign = useNavigationStore((s) => s.navigateToDesign);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const workspaces = useAppStore((s) => s.workspaces);
  const [createDesignOpen, setCreateDesignOpen] = useState(false);
  const [editDesignId, setEditDesignId] = useState<string | null>(null);
  const { designs, create, update, remove } = useDesigns({
    workspaceId: activeWorkspaceId,
    projectId: null,
  });
  const workspace =
    workspaces.find((item) => item.id === activeWorkspaceId) ?? null;
  const editDesign = useMemo(
    () => designs.find((design) => design.id === editDesignId) ?? null,
    [designs, editDesignId],
  );

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary min-h-0">
      <ScrollArea className="flex-1 h-full">
        <div className="mx-auto max-w-[960px] px-8 py-8">
          {/* Header */}
          <h1 className="text-2xl font-medium text-text-primary">Home</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Your hardware workspace
          </p>

          {/* Quick Actions */}
          <section className="mt-8">
            <h2 className="text-sm font-medium text-text-primary mb-3">
              Quick actions
            </h2>
            <div className="flex gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-bg-input px-4 text-sm font-medium text-brand-light transition-colors hover:bg-brand-bg"
                disabled={!activeWorkspaceId}
                onClick={() => setCreateDesignOpen(true)}
              >
                <Plus className="h-4 w-4" />
                New design
              </button>
              {["New component", "New from template", "Import KiCad"].map(
                (action) => (
                  <button
                    key={action}
                    className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-brand-light hover:bg-brand-bg transition-colors"
                  >
                    {action}
                  </button>
                ),
              )}
            </div>
          </section>

          {/* Recent Designs */}
          <section className="mt-8">
            <div className="mb-3">
              <h2 className="text-sm font-medium text-text-primary">
                Recent designs
              </h2>
              <p className="mt-1 text-xs text-text-tertiary">
                Standalone designs for simple boards and single-part work.
                {workspace ? ` Stored in ${workspace.name}.` : ""}
              </p>
            </div>

            {designs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-default p-4 text-sm text-text-tertiary">
                No workspace designs yet.
              </div>
            ) : (
              <div className="flex gap-3 flex-wrap">
                {designs.map((design) => (
                  <div
                    key={design.id}
                    className="group w-[240px] rounded-lg border border-border-default bg-bg-input p-3 text-left transition-all hover:border-border-strong hover:scale-[1.01] cursor-pointer"
                    onClick={() => navigateToDesign(null, design.id)}
                  >
                    {/* Thumbnail placeholder */}
                    <div className="h-14 rounded bg-bg-elevated mb-2" />
                    <p className="text-[13px] font-medium text-text-primary truncate">
                      {design.name}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5 truncate">
                      {design.description || "No description"}
                    </p>
                    {/* Actions - visible on hover */}
                    <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        aria-label={`Edit ${design.name}`}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs bg-bg-elevated text-text-tertiary hover:text-text-primary hover:bg-bg-primary border border-border-default"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditDesignId(design.id);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        aria-label={`Delete ${design.name}`}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs bg-bg-elevated text-text-tertiary hover:text-destructive hover:bg-bg-primary border border-border-default"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(design.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent Projects - DISABLED */}
          {/*
          <section className="mt-8">
            <h2 className="text-sm font-medium text-text-primary mb-3">
              Recent projects
            </h2>
            <div className="flex gap-3 flex-wrap">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className="group w-[240px] rounded-lg border border-border-default bg-bg-input p-3 text-left transition-all hover:border-border-strong hover:scale-[1.01]"
                  onClick={() => navigateToProject(project.id)}
                >
                  <div className="h-14 rounded bg-bg-elevated mb-2" />
                  <p className="text-[13px] font-medium text-text-primary truncate">
                    {project.name}
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Modified recently
                  </p>
                </button>
              ))}
              <button
                className="flex w-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border-default p-3 text-text-tertiary hover:border-border-strong hover:text-text-secondary transition-colors h-[120px]"
                onClick={() => setCreateOpen(true)}
              >
                <span className="text-xl">+</span>
                <span className="text-xs mt-1">New project</span>
              </button>
            </div>
          </section>
          */}

          {/* Recent Notes + Recent Chats side by side */}
          <div className="mt-8 grid grid-cols-2 gap-6">
            {/* Recent Notes */}
            <section>
              <h2 className="text-sm font-medium text-text-primary mb-3">
                Recent notes
              </h2>
              <div className="space-y-0.5">
                <p className="text-xs text-text-muted py-2">No notes yet</p>
              </div>
            </section>

            {/* Recent Chats */}
            <section>
              <h2 className="text-sm font-medium text-text-primary mb-3">
                Recent chats
              </h2>
              <div className="space-y-0.5">
                <p className="text-xs text-text-muted py-2">No chats yet</p>
              </div>
            </section>
          </div>
        </div>
      </ScrollArea>

      {/* Projects feature is temporarily disabled
      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(project) => navigateToProject(project.id)}
      />
      */}

      <DesignDialog
        open={createDesignOpen}
        onOpenChange={setCreateDesignOpen}
        title="Create Workspace Design"
        description="Store a design directly in the workspace without attaching it to a project."
        confirmLabel="Create Design"
        onConfirm={(input) =>
          create({
            name: input.name,
            description: input.description,
          }).then((design) => navigateToDesign(null, design.id))
        }
      />

      <DesignDialog
        open={Boolean(editDesign)}
        onOpenChange={(open) => !open && setEditDesignId(null)}
        title="Rename Workspace Design"
        description="Update the design metadata."
        initialName={editDesign?.name}
        initialDescription={editDesign?.description}
        confirmLabel="Save"
        onConfirm={(input) =>
          editDesign
            ? update(editDesign.id, {
                name: input.name,
                description: input.description,
              }).then(() => undefined)
            : Promise.resolve()
        }
      />
    </div>
  );
}
