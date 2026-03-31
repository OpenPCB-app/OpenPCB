import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAppStore } from "@/stores/app-store";

export function HomeScreen() {
  const navigateToDesign = useNavigationStore((s) => s.navigateToDesign);
  const projects = useAppStore((s) => s.projects);

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-[960px] px-8 py-8">
          {/* Header */}
          <h1 className="text-2xl font-medium text-text-primary">Home</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Your hardware workspace
          </p>

          {/* Recent Projects */}
          <section className="mt-8">
            <h2 className="text-sm font-medium text-text-primary mb-3">
              Recent projects
            </h2>
            <div className="flex gap-3 flex-wrap">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className="group w-[240px] rounded-lg border border-border-default bg-bg-input p-3 text-left transition-all hover:border-border-strong hover:scale-[1.01]"
                  onClick={() => navigateToDesign(project.id)}
                >
                  {/* Thumbnail placeholder */}
                  <div className="h-14 rounded bg-bg-elevated mb-2" />
                  <p className="text-[13px] font-medium text-text-primary truncate">
                    {project.name}
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Modified recently
                  </p>
                </button>
              ))}

              {/* New project card */}
              <button
                className="flex w-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border-default p-3 text-text-tertiary hover:border-border-strong hover:text-text-secondary transition-colors h-[120px]"
                onClick={() => {
                  /* TODO: open new project dialog */
                }}
              >
                <span className="text-xl">+</span>
                <span className="text-xs mt-1">New project</span>
              </button>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="mt-8">
            <h2 className="text-sm font-medium text-text-primary mb-3">
              Quick actions
            </h2>
            <div className="flex gap-2">
              {["New from template", "Import KiCad", "New component"].map(
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
    </div>
  );
}
