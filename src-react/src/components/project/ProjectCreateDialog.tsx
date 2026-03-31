import { useState } from "react";
import { 
  Briefcase, 
  Code, 
  Database, 
  Folder, 
  Globe, 
  Layout, 
  MessageSquare, 
  Monitor, 
  Settings, 
  Terminal, 
  Zap,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";

const COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
  "#64748b",
  "#000000",
];

const ICONS = [
  { id: "briefcase", icon: Briefcase },
  { id: "code", icon: Code },
  { id: "database", icon: Database },
  { id: "folder", icon: Folder },
  { id: "globe", icon: Globe },
  { id: "layout", icon: Layout },
  { id: "message-square", icon: MessageSquare },
  { id: "monitor", icon: Monitor },
  { id: "settings", icon: Settings },
  { id: "terminal", icon: Terminal },
  { id: "zap", icon: Zap },
];

interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectCreateDialog({
  open,
  onOpenChange,
}: ProjectCreateDialogProps) {
  const { create } = useProjects();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("briefcase");
  const [color, setColor] = useState(COLORS[6]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setName("");
      setDescription("");
      setIcon("briefcase");
      setColor(COLORS[6]!);
      setError(null);
    }
    onOpenChange(open);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await create(name.trim(), description.trim(), icon, color);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  };

  const SelectedIcon = ICONS.find((i) => i.id === icon)?.icon || Briefcase;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-[425px]"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Organize your chats and documents into projects.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              placeholder="Project Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Icon</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <div className="flex items-center gap-2">
                      <SelectedIcon className="h-4 w-4" />
                      <span className="capitalize">{icon.replace("-", " ")}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="grid grid-cols-4 gap-1 p-2">
                  {ICONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Button
                        key={item.id}
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-8 w-8",
                          icon === item.id && "bg-accent"
                        )}
                        onClick={() => setIcon(item.id)}
                      >
                        <Icon className="h-4 w-4" />
                      </Button>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="h-4 w-4 rounded-full border border-muted"
                        style={{ backgroundColor: color }}
                      />
                      <span>Color</span>
                    </div>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="p-2">
                  <div className="grid grid-cols-4 gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn(
                          "h-6 w-6 rounded-full border border-muted transition-all hover:scale-110",
                          color === c && "ring-2 ring-ring ring-offset-2"
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {error && (
            <div className="text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => handleOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
