import { MousePointer2, Route, Undo2, Redo2 } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { usePcbStore } from "@/stores/pcb-store";

const TOOLS = [
  { mode: "select", icon: MousePointer2, label: "Select", shortcut: "Esc" },
  { mode: "route", icon: Route, label: "Route Traces", shortcut: undefined },
] as const;

export function PcbToolbar() {
  const activeTool = usePcbStore((s) => s.activeTool);
  const setActiveTool = usePcbStore((s) => s.setActiveTool);
  const undo = usePcbStore((s) => s.undo);
  const redo = usePcbStore((s) => s.redo);
  const canUndo = usePcbStore((s) => s.canUndo());
  const canRedo = usePcbStore((s) => s.canRedo());
  const routingSession = usePcbStore((s) => s.routingSession);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-9 items-center gap-1 rounded-lg border border-border-default bg-bg-secondary/90 px-2 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-0.5">
          {TOOLS.map((tool) => (
            <Tooltip key={tool.mode}>
              <TooltipTrigger asChild>
                <Toggle
                  size="sm"
                  pressed={activeTool === tool.mode}
                  onPressedChange={() => setActiveTool(tool.mode)}
                  aria-label={tool.label}
                  className="h-7 w-7 p-0"
                >
                  <tool.icon className="h-4 w-4" />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={!canUndo || routingSession !== null}
                onClick={undo}
                aria-label="Undo"
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
                disabled={!canRedo || routingSession !== null}
                onClick={redo}
                aria-label="Redo"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Redo (Ctrl+Shift+Z)
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground">
          {routingSession
            ? `Routing (${routingSession.width}mm on ${routingSession.layer})`
            : TOOLS.find((t) => t.mode === activeTool)?.label ?? "Select"}
        </span>
      </div>
    </TooltipProvider>
  );
}
