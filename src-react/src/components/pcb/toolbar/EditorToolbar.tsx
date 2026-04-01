import {
  MousePointer2,
  Component,
  Minus,
  Type,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useSchematicStore } from "@/stores/schematic-store";
import { GRID_PRESETS, type ToolMode } from "../types";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";

const TOOLS: {
  mode: ToolMode;
  icon: typeof MousePointer2;
  label: string;
  shortcut: string;
}[] = [
  { mode: "select", icon: MousePointer2, label: "Select", shortcut: "Esc" },
  { mode: "place", icon: Component, label: "Place Component", shortcut: "A" },
  { mode: "wire", icon: Minus, label: "Draw Wire", shortcut: "W" },
  { mode: "label", icon: Type, label: "Net Label", shortcut: "L" },
];

interface EditorToolbarProps {
  controller?: SchematicInteractionController;
}

export function EditorToolbar({ controller }: EditorToolbarProps) {
  const fallbackController = useSchematicInteractionController();
  const interactionController = controller ?? fallbackController;
  const activeTool = useSchematicStore((s) => s.chrome.activeTool);
  const showGrid = useSchematicStore((s) => s.chrome.showGrid);
  const toggleGrid = useSchematicStore((s) => s.toggleGrid);
  const gridPresetId = useSchematicStore((s) => s.chrome.gridPresetId);
  const setGridPreset = useSchematicStore((s) => s.setGridPreset);
  const zoomAt = useSchematicStore((s) => s.zoomAt);
  const resetViewport = useSchematicStore((s) => s.resetViewport);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-9 items-center gap-1 rounded-lg border border-border-default bg-bg-secondary/90 px-2 shadow-lg backdrop-blur-sm">
        {/* Tool group */}
        <div className="flex items-center gap-0.5">
          {TOOLS.map((tool) => (
            <Tooltip key={tool.mode}>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={activeTool === tool.mode}
                  onPressedChange={() =>
                    interactionController.activateTool(tool.mode)
                  }
                  aria-label={tool.label}
                  className="h-7 w-7 p-0"
                >
                  <tool.icon className="h-4 w-4" />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {tool.label} ({tool.shortcut})
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Edit group */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Undo (Ctrl+Z)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Redo (Ctrl+Shift+Z)
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* View group */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() =>
                  zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)
                }
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Zoom In
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() =>
                  zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8)
                }
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Zoom Out
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => resetViewport()}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Fit to Content (Ctrl+0)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={showGrid}
                onPressedChange={toggleGrid}
                className="h-7 w-7 p-0"
              >
                <Grid3x3 className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Toggle Grid
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-5" />

          {/* Grid Preset Selector */}
          <Select
            value={gridPresetId}
            onValueChange={setGridPreset}
            disabled={!showGrid}
          >
            <SelectTrigger
              className="h-7 w-32 px-2 text-xs border border-border-default rounded bg-bg-secondary hover:bg-bg-input data-[state=open]:bg-bg-input"
              aria-label="Grid preset"
            >
              <SelectValue placeholder="Select grid..." />
            </SelectTrigger>
            <SelectContent>
              {GRID_PRESETS.map((preset) => (
                <SelectItem
                  key={preset.id}
                  value={preset.id}
                  className="text-xs"
                >
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side: active tool label */}
        <span className="text-xs text-muted-foreground">
          {TOOLS.find((t) => t.mode === activeTool)?.label ?? "Select"}
        </span>
      </div>
    </TooltipProvider>
  );
}
