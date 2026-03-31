import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Archive,
  ExternalLink,
  FileText,
  FolderKanban,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNavigationStore } from "@/stores/navigation-store";
import { useProjects } from "@/hooks/useProjects";
import { useDesigns } from "@/hooks/useDesigns";
import { useChatList } from "@/hooks/useChatList";
import { useChatOperations } from "@/hooks/useChatOperations";
import { ProjectDeleteConfirmDialog } from "@/components/project/ProjectDeleteConfirmDialog";
import { PROJECT_COLORS, PROJECT_ICON_OPTIONS, getProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";
import { useKnowledgeApi } from "@modules/knowledge/react/hooks/useKnowledgeApi";
import { normalizeProjectIconId } from "@shared/types";
import { DesignDialog } from "@/components/design/DesignDialog";

export function ProjectScreen() {
  const {
    currentProjectId,
    navigateToHome,
    navigateToDesign,
    navigateToNotes,
    navigateToChat,
  } = useNavigationStore();
  const { projects, loading, error, update } = useProjects();
  const project = projects.find((item) => item.id === currentProjectId);
  const { designs, create: createDesign, update: updateDesign, remove: removeDesign } =
    useDesigns({
      workspaceId: project?.workspaceId ?? null,
      projectId: currentProjectId,
    });
  const { chats, loading: chatsLoading, refetch: refetchChats } = useChatList(
    currentProjectId ? { projectId: currentProjectId } : undefined,
  );
  const { createNewChat, moveToProject, isCreating } = useChatOperations(refetchChats);
  const knowledgeApi = useKnowledgeApi();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("briefcase");
  const [color, setColor] = useState<string>(PROJECT_COLORS[6]!);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editDesignId, setEditDesignId] = useState<string | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [notesCount, setNotesCount] = useState(0);
  const [notesLoading, setNotesLoading] = useState(false);

  const editDesign = useMemo(
    () => designs.find((item) => item.id === editDesignId) ?? null,
    [designs, editDesignId],
  );
  const recentChats = useMemo(() => chats.slice(0, 5), [chats]);
  const ProjectIcon = getProjectIcon(project?.icon);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description || "");
    setIcon(normalizeProjectIconId(project.icon) || "briefcase");
    setColor(project.color || PROJECT_COLORS[6]!);
    setProjectError(null);
  }, [project]);

  useEffect(() => {
    if (!project?.workspaceId || !project.id) return;
    let cancelled = false;

    const loadNotes = async () => {
      setNotesLoading(true);
      try {
        const pages = await knowledgeApi.getProjectTree(project.id, project.workspaceId);
        if (!cancelled) {
          setNotesCount(pages.length);
        }
      } catch {
        if (!cancelled) {
          setNotesCount(0);
        }
      } finally {
        if (!cancelled) {
          setNotesLoading(false);
        }
      }
    };

    void loadNotes();
    return () => {
      cancelled = true;
    };
  }, [knowledgeApi, project?.id, project?.workspaceId]);

  if (!project) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <Button variant="ghost" size="icon" onClick={navigateToHome} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-medium">{loading ? "Loading project" : "Project not found"}</p>
            <p className="text-sm text-muted-foreground">
              {loading ? "Fetching active projects." : error ?? "Return home and select another project."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const saveProject = async () => {
    if (!name.trim()) {
      setProjectError("Project name is required");
      return;
    }

    setIsSavingProject(true);
    setProjectError(null);
    try {
      await update(project.id, {
        name: name.trim(),
        description: description.trim(),
        icon,
        color,
      });
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Failed to save project");
    } finally {
      setIsSavingProject(false);
    }
  };

  const archiveProject = async () => {
    await update(project.id, { status: "archived" });
    navigateToHome();
  };

  const handleCreateChat = async () => {
    const chat = await createNewChat("New Project Chat");
    if (!chat) return;
    await moveToProject(chat.id, project.id);
    navigateToChat(chat.id);
  };

  const handleOpenNotes = async () => {
    try {
      await knowledgeApi.ensureProjectRoot({
        workspace_id: project.workspaceId,
        project_id: project.id,
        title: project.name,
      });
    } catch (err) {
      console.error("Failed to ensure project root:", err);
    }
    navigateToNotes();
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" onClick={navigateToHome} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl border"
          style={{ borderColor: `${project.color || color}40` }}
        >
          <ProjectIcon className="size-5" style={{ color: project.color || color }} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Hub</p>
          <h1 className="text-lg font-semibold">{project.name}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenNotes}>
            <FileText className="mr-2 size-4" />
            Open Notes
          </Button>
        </div>
      </div>

      <div className="grid flex-1 gap-6 overflow-auto px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
              <CardDescription>Manage the core metadata for this project.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="project-name">Name</Label>
                  <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <div className="flex h-10 items-center rounded-md border px-3 text-sm capitalize">
                    {project.status}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="project-description">Description</Label>
                <Textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Icon</Label>
                  <div className="grid grid-cols-6 gap-2">
                    {PROJECT_ICON_OPTIONS.map(({ id, icon: Icon }) => (
                      <button
                        key={id}
                        className={cn(
                          "flex h-10 items-center justify-center rounded-md border transition-colors",
                          icon === id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                        )}
                        onClick={() => setIcon(id)}
                      >
                        <Icon className="size-4" />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Color</Label>
                  <div className="grid grid-cols-6 gap-2">
                    {PROJECT_COLORS.map((value) => (
                      <button
                        key={value}
                        className={cn(
                          "h-10 rounded-full border-2 transition-transform hover:scale-105",
                          color === value ? "border-foreground" : "border-transparent",
                        )}
                        style={{ backgroundColor: value }}
                        onClick={() => setColor(value)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {projectError && <p className="text-sm text-destructive">{projectError}</p>}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void saveProject()} disabled={isSavingProject}>
                  {isSavingProject ? "Saving..." : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={() => void archiveProject()}>
                  <Archive className="mr-2 size-4" />
                  Archive
                </Button>
                <Button variant="outline" className="text-destructive" onClick={() => setDeleteProjectOpen(true)}>
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Designs</CardTitle>
                <CardDescription>Each project can contain multiple named designs.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                New Design
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {designs.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No designs yet. Create the first design for this project.
                </div>
              ) : (
                designs.map((design) => (
                  <div
                    key={design.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FolderKanban className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{design.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {design.description || "No description"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateToDesign(project.id, design.id)}
                    >
                      <ExternalLink className="mr-2 size-4" />
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${design.name}`}
                      onClick={() => setEditDesignId(design.id)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      aria-label={`Delete ${design.name}`}
                      onClick={() => void removeDesign(design.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Chats</CardTitle>
                <CardDescription>Project-scoped conversations stay attached here.</CardDescription>
              </div>
              <Button size="sm" onClick={() => void handleCreateChat()} disabled={isCreating}>
                {isCreating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                New Chat
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {chatsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading chats...
                </div>
              ) : recentChats.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No project chats yet.
                </div>
              ) : (
                recentChats.map((chat) => (
                  <button
                    key={chat.id}
                    className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
                    onClick={() => navigateToChat(chat.id)}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <MessageSquare className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{chat.title || "Untitled chat"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : "No activity"}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>Project notes stay in the knowledge module under a project root.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Project note tree</p>
                  <p className="text-xs text-muted-foreground">
                    {notesLoading ? "Loading project notes..." : `${notesCount} pages currently scoped to this project`}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleOpenNotes()}>
                  <FileText className="mr-2 size-4" />
                  Open Notes
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parts & Components</CardTitle>
              <CardDescription>Deferred in this pass.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Project-scoped parts inventory and reusable component definitions are intentionally deferred.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <DesignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create Design"
        description="Add a named design artifact inside this project."
        confirmLabel="Create Design"
        onConfirm={(input) =>
          createDesign({
            name: input.name,
            description: input.description,
          }).then(() => undefined)
        }
      />

      <DesignDialog
        open={Boolean(editDesign)}
        onOpenChange={(open) => !open && setEditDesignId(null)}
        title="Rename Design"
        description="Update the design metadata."
        initialName={editDesign?.name}
        initialDescription={editDesign?.description}
        confirmLabel="Save"
        onConfirm={(input) =>
          editDesign
            ? updateDesign(editDesign.id, {
                name: input.name,
                description: input.description,
              }).then(() => undefined)
            : Promise.resolve()
        }
      />

      <ProjectDeleteConfirmDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        project={project}
        onDeleted={navigateToHome}
      />
    </div>
  );
}
