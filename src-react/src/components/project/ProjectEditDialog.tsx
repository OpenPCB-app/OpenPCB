import { useState, useEffect } from "react";
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
  ChevronDown,
  Trash2
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
import type { ProjectRecord } from "@shared/types";

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

interface ProjectEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRecord;
  onDeleteRequest: () => void;
}

export function ProjectEditDialog({
  open,
  onOpenChange,
  project,
  onDeleteRequest,
}: ProjectEditDialogProps) {
  const { update } = useProjects();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [icon, setIcon] = useState(project.icon || "briefcase");
  const [color, setColor] = useState(project.color || COLORS[6]!);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state with project when it changes or dialog opens
  useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description || "");
      setIcon(project.icon || "briefcase");
      setColor(project.color || COLORS[6]!);
      setError(null);
    }
  }, [open, project]);

  const handleUpdate = async () => {
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await update(project.id, {
        name: name.trim(),
        description: description.trim(),
        icon,
        color,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setIsSaving(false);
    }
  };

  const SelectedIcon = ICONS.find((i) => i.id === icon)?.icon || Briefcase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-[425px]"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Update project details or manage settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-project-name">Name</Label>
            <Input
              id="edit-project-name"
              placeholder="Project Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-project-description">Description</Label>
            <Textarea
              id="edit-project-description"
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

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto"
            onClick={onDeleteRequest}
            disabled={isSaving}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Project
          </Button>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
