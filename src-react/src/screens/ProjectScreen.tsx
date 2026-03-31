import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  PlusIcon,
  Loader2Icon,
  MessageSquareIcon,
  BotIcon,
  LayoutIcon,
  InfoIcon,
  PaletteIcon,
  CheckIcon,
  BoxIcon,
  BriefcaseIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  LayersIcon,
  PackageIcon,
  TerminalIcon,
  Settings,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjects } from "@/hooks/useProjects";
import { useChatList } from "@/hooks/useChatList";
import { useChatOperations } from "@/hooks/useChatOperations";
import { useProjectFiles } from "@/hooks/useProjectFiles";
import { useNavigationStore } from "@/stores/navigation-store";
import { useChatStore } from "@/stores/chat-store";
import { ProjectFileUpload } from "@/components/project/ProjectFileUpload";
import { ProjectFileList } from "@/components/project/ProjectFileList";
import { AIChatPromptInput } from "@/components/ai-elements/prompt-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listProviders, getProviderResult } from "@/lib/api/provider-api";
import { ProviderInfo, UpdateProjectInput } from "@shared/types";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";

const tabs = [
  { value: "overview", label: "Overview" },
  { value: "chats", label: "Chats" },
  { value: "files", label: "Files" },
  { value: "memory", label: "Memory" },
];

const stats = [
  { label: "Chats", value: "--" },
  { label: "Files", value: "--" },
  { label: "Memory Items", value: "--" },
];

const COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#6366f1",
  "#f97316",
  "#14b8a6",
  "#71717a",
];

const ICONS = [
  { name: "Box", icon: BoxIcon },
  { name: "Briefcase", icon: BriefcaseIcon },
  { name: "Code", icon: CodeIcon },
  { name: "Cpu", icon: CpuIcon },
  { name: "Database", icon: DatabaseIcon },
  { name: "File", icon: FileIcon },
  { name: "Folder", icon: FolderIcon },
  { name: "Globe", icon: GlobeIcon },
  { name: "Layers", icon: LayersIcon },
  { name: "Layout", icon: LayoutIcon },
  { name: "Package", icon: PackageIcon },
  { name: "Terminal", icon: TerminalIcon },
];

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export function ProjectScreen() {
  const { currentProjectId, navigateToHome, navigateToChat } =
    useNavigationStore();
  const { projects, loading, error, update: updateProject } = useProjects();
  const {
    chats,
    loading: chatsLoading,
    refetch,
  } = useChatList(
    currentProjectId ? { projectId: currentProjectId } : undefined,
  );
  const { createNewChat, moveToProject, isCreating } =
    useChatOperations(refetch);
  const {
    pendingModelSelection,
    setProjectDefaultModel,
    setPendingInitialMessage,
  } = useChatStore();

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelsMap, setModelsMap] = useState<Record<string, string[]>>({});

  const project = projects.find((item) => item.id === currentProjectId);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Set project default model in store when project changes
  useEffect(() => {
    if (project?.aiConfig?.defaultProvider && project?.aiConfig?.defaultModel) {
      setProjectDefaultModel({
        provider: project.aiConfig.defaultProvider,
        model: project.aiConfig.defaultModel,
      });
    } else {
      setProjectDefaultModel(null);
    }
  }, [
    project?.id,
    project?.aiConfig?.defaultProvider,
    project?.aiConfig?.defaultModel,
    setProjectDefaultModel,
  ]);

  const {
    files,
    isLoading: filesLoading,
    refetch: refetchFiles,
    deleteFile,
  } = useProjectFiles({
    workspaceId: project?.workspaceId ?? "",
    projectId: currentProjectId ?? undefined,
  });

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const list = await listProviders();
        setProviders(list);

        const currentProvider = project?.aiConfig?.defaultProvider || "openai";
        if (currentProvider && !modelsMap[currentProvider]) {
          const details = await getProviderResult(currentProvider);
          setModelsMap((prev) => ({
            ...prev,
            [currentProvider]: details.models.map((m) => m.id),
          }));
        }
      } catch (err) {
        console.error("Error loading providers:", err);
      }
    };
    if (project?.id) loadProviders();
  }, [project?.id]);

  const handleUpdateSettings = useCallback(
    async (updates: UpdateProjectInput) => {
      if (!currentProjectId) return;
      try {
        await updateProject(currentProjectId, updates);
      } catch (err) {
        console.error("Failed to update project settings:", err);
      }
    },
    [currentProjectId, updateProject],
  );

  const handleProviderChange = async (providerId: string) => {
    if (!project) return;

    handleUpdateSettings({
      aiConfig: {
        ...(project.aiConfig || {}),
        defaultProvider: providerId,
        defaultModel: "",
      },
    });

    if (!modelsMap[providerId]) {
      try {
        const details = await getProviderResult(providerId);
        setModelsMap((prev) => ({
          ...prev,
          [providerId]: details.models.map((m) => m.id),
        }));
      } catch (err) {
        console.error("Error loading models:", err);
      }
    }
  };

  const projectChats = useMemo(() => {
    return chats.filter((c) => c.projectId === currentProjectId);
  }, [chats, currentProjectId]);

  const recentProjectChats = useMemo(() => {
    return [...projectChats]
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [projectChats]);

  const handleCreateChat = async () => {
    if (!currentProjectId) return;
    const chat = await createNewChat();
    if (chat) {
      await moveToProject(chat.id, currentProjectId);
      navigateToChat(chat.id);
    }
  };

  const handleQuickChatSubmit = async (message: PromptInputMessage) => {
    if (!project || !currentProjectId) return;

    const title = message.text?.slice(0, 30) || "New Chat";
    // Use model from pendingModelSelection (set by ModelSelector) or fall back to project defaults
    const chatConfig = pendingModelSelection
      ? {
          provider: pendingModelSelection.provider,
          model: pendingModelSelection.model,
        }
      : {
          provider: project.aiConfig?.defaultProvider,
          model: project.aiConfig?.defaultModel,
        };
    const chat = await createNewChat(title, chatConfig);
    if (!chat) return;

    await moveToProject(chat.id, currentProjectId);
    await refetch();

    // Store the message to be sent as initial message in the new chat
    setPendingInitialMessage({ chatId: chat.id, message });

    // Navigate to chat with project context
    navigateToChat(chat.id);
  };

  if (!project) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={navigateToHome}
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-medium text-foreground">
              {loading ? "Loading project" : "Project not found"}
            </p>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Fetching project details."
                : error ?? "Select another project or go back."}
            </p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-dashed border-border bg-surface p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {loading ? "Loading..." : "This project does not exist."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {loading
                ? "Please wait while we fetch the project."
                : "Use the back button to return."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={navigateToHome}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Project
          </p>
          <h1 className="text-lg font-semibold text-foreground">
            {project.name}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="mr-2 size-4" />
            Settings
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col px-6 pb-6 pt-4">
        <Tabs defaultValue="overview" className="flex h-full flex-col">
          <TabsList className="self-start">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="mt-4 flex-1">
            <div className="pb-6">
              <TabsContent value="overview" className="mt-0">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-foreground">
                      Description
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {project.description || "No description yet."}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    {stats.map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg border border-border bg-surface p-4"
                      >
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {stat.label}
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-foreground">
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">
                        Recent Chats
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {projectChats.length} total
                      </span>
                    </div>

                    {chatsLoading ? (
                      <div className="flex h-32 items-center justify-center">
                        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : recentProjectChats.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {recentProjectChats.map((chat) => (
                          <button
                            key={chat.id}
                            onClick={() => navigateToChat(chat.id)}
                            className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-surface-hover"
                          >
                            <div className="rounded-md bg-primary/10 p-2 text-primary">
                              <MessageSquareIcon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {chat.title || "Untitled Chat"}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="size-3" />
                                <span>
                                  {chat.updatedAt
                                    ? formatRelativeTime(chat.updatedAt)
                                    : "No updates"}
                                </span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-border bg-background p-6 text-center">
                        <p className="text-sm font-medium text-foreground">
                          No chats yet
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Start the first conversation for this project.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="chats" className="mt-0">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-medium text-foreground">
                    Project Chats
                  </h2>
                  <Button
                    size="sm"
                    onClick={handleCreateChat}
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PlusIcon className="mr-2 h-4 w-4" />
                    )}
                    New Chat
                  </Button>
                </div>

                {chatsLoading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : projectChats.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {projectChats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => navigateToChat(chat.id)}
                        className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
                      >
                        <div className="rounded-md bg-primary/10 p-2 text-primary">
                          <MessageSquareIcon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {chat.title || "Untitled Chat"}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {chat.updatedAt
                              ? new Date(chat.updatedAt).toLocaleDateString()
                              : "Never"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <MessageSquareIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 text-sm font-medium text-foreground">
                      No chats yet
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Start a new conversation for this project.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={handleCreateChat}
                      disabled={isCreating}
                    >
                      Create your first chat
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="files" className="mt-0">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-medium text-foreground">
                    Project Files
                  </h2>
                </div>
                {project.workspaceId ? (
                  <div className="space-y-4">
                    <ProjectFileUpload
                      workspaceId={project.workspaceId}
                      projectId={project.id}
                      onUploadComplete={refetchFiles}
                    />
                    <ProjectFileList
                      files={files}
                      isLoading={filesLoading}
                      onDelete={async (id: string) => {
                        await deleteFile(id);
                        await refetchFiles();
                      }}
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <FileIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 text-sm font-medium text-foreground">
                      Workspace required
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      This project is missing a workspace id.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="memory" className="mt-0">
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Coming soon
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Memory tools for projects are on the way.
                  </p>
                </div>
              </TabsContent>
            </div>
          </ScrollArea>

          <div className="absolute bottom-0 left-0 right-0 z-10 pb-4 px-6 pointer-events-none">
            <div className="mx-auto max-w-2xl pointer-events-auto">
              <AIChatPromptInput
                onSubmit={handleQuickChatSubmit}
                placeholder={
                  pendingModelSelection
                    ? `Message ${pendingModelSelection.model.split("/").pop() || pendingModelSelection.model}...`
                    : project?.aiConfig?.defaultModel
                      ? `Message ${project.aiConfig.defaultModel.split("/").pop() || project.aiConfig.defaultModel}...`
                      : "Ask anything..."
                }
                workspaceId={project.workspaceId ?? undefined}
                autoFocus
                autoFocusKey={currentProjectId ?? undefined}
              />
            </div>
          </div>
        </Tabs>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Project Settings</DialogTitle>
            <DialogDescription>
              Manage AI behavior, appearance, and project preferences.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="grid gap-6 py-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BotIcon className="size-4 text-primary" />
                    <CardTitle className="text-base">
                      AI Configuration
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Configure how AI models behave in this project.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Provider</Label>
                      <Select
                        value={project.aiConfig?.defaultProvider || "openai"}
                        onValueChange={handleProviderChange}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {providers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Model</Label>
                      <Select
                        value={project.aiConfig?.defaultModel || ""}
                        onValueChange={(val) =>
                          handleUpdateSettings({
                            aiConfig: {
                              ...(project.aiConfig || {}),
                              defaultModel: val,
                            },
                          })
                        }
                        disabled={
                          !project.aiConfig?.defaultProvider &&
                          !providers.length
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            modelsMap[
                              project.aiConfig?.defaultProvider || "openai"
                            ] || []
                          ).map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>System Prompt</Label>
                    <Textarea
                      placeholder="You are a helpful assistant..."
                      defaultValue={project.aiConfig?.systemPrompt || ""}
                      onBlur={(e) => {
                        if (
                          e.target.value !==
                          (project.aiConfig?.systemPrompt || "")
                        ) {
                          handleUpdateSettings({
                            aiConfig: {
                              ...(project.aiConfig || {}),
                              systemPrompt: e.target.value,
                            },
                          });
                        }
                      }}
                      className="min-h-[100px] resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Prompt Mode</Label>
                      <Select
                        value={project.aiConfig?.systemPromptMode || "append"}
                        onValueChange={(val: "append" | "replace") =>
                          handleUpdateSettings({
                            aiConfig: {
                              ...(project.aiConfig || {}),
                              systemPromptMode: val,
                            },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="append">
                            Append to user prompt
                          </SelectItem>
                          <SelectItem value="replace">
                            Replace base system prompt
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label>
                          Temperature ({project.aiConfig?.temperature ?? 0.7})
                        </Label>
                      </div>
                      <Slider
                        value={[project.aiConfig?.temperature ?? 0.7]}
                        min={0}
                        max={2}
                        step={0.1}
                        onValueChange={([val]) =>
                          handleUpdateSettings({
                            aiConfig: {
                              ...(project.aiConfig || {}),
                              temperature: val,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Max Tokens</Label>
                    <Input
                      type="number"
                      placeholder="Default"
                      defaultValue={project.aiConfig?.maxTokens || ""}
                      onBlur={(e) => {
                        const val = e.target.value
                          ? parseInt(e.target.value)
                          : undefined;
                        if (
                          val !== (project.aiConfig?.maxTokens ?? undefined)
                        ) {
                          handleUpdateSettings({
                            aiConfig: {
                              ...(project.aiConfig || {}),
                              maxTokens: val,
                            },
                          });
                        }
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <PaletteIcon className="size-4 text-primary" />
                    <CardTitle className="text-base">Appearance</CardTitle>
                  </div>
                  <CardDescription>
                    Customize the visual identity of your project.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <Label>Project Icon</Label>
                    <div className="grid grid-cols-6 gap-2">
                      {ICONS.map(({ name, icon: Icon }) => (
                        <Button
                          key={name}
                          variant="outline"
                          size="icon"
                          className={cn(
                            "size-10",
                            project.icon === name &&
                              "border-primary bg-primary/10 text-primary",
                          )}
                          onClick={() => handleUpdateSettings({ icon: name })}
                        >
                          <Icon className="size-5" />
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>Project Color</Label>
                    <div className="grid grid-cols-6 gap-2">
                      {COLORS.map((color) => (
                        <button
                          key={color}
                          className={cn(
                            "size-10 rounded-full border-2 border-transparent transition-all hover:scale-110",
                            project.color === color &&
                              "border-foreground scale-110",
                          )}
                          style={{ backgroundColor: color }}
                          onClick={() => handleUpdateSettings({ color })}
                        >
                          {project.color === color && (
                            <CheckIcon className="mx-auto size-4 text-white drop-shadow-md" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <LayoutIcon className="size-4 text-primary" />
                    <CardTitle className="text-base">
                      Display Preferences
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Adjust how the project appears in the interface.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Show in Sidebar</Label>
                      <p className="text-xs text-muted-foreground">
                        Keep this project visible in the main navigation.
                      </p>
                    </div>
                    <Switch
                      checked={project.preferences?.showInSidebar !== false}
                      onCheckedChange={(val) =>
                        handleUpdateSettings({
                          preferences: {
                            ...(project.preferences || {}),
                            showInSidebar: val,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Expanded by Default</Label>
                      <p className="text-xs text-muted-foreground">
                        Automatically show project contents when sidebar loads.
                      </p>
                    </div>
                    <Switch
                      checked={project.preferences?.expandedByDefault === true}
                      onCheckedChange={(val) =>
                        handleUpdateSettings({
                          preferences: {
                            ...(project.preferences || {}),
                            expandedByDefault: val,
                          },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <InfoIcon className="size-4 text-primary" />
                    <CardTitle className="text-base">Project Details</CardTitle>
                  </div>
                  <CardDescription>
                    Basic information about your project.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Project Name</Label>
                    <Input
                      defaultValue={project.name}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== project.name) {
                          handleUpdateSettings({ name: e.target.value });
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      placeholder="Optional project description..."
                      defaultValue={project.description || ""}
                      onBlur={(e) => {
                        if (e.target.value !== (project.description || "")) {
                          handleUpdateSettings({ description: e.target.value });
                        }
                      }}
                      className="min-h-[80px] resize-none"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
