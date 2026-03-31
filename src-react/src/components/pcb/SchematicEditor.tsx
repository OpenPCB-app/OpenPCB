import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { EditorToolbar } from "./toolbar/EditorToolbar";
import { SchematicCanvas } from "./canvas/SchematicCanvas";
import { ComponentPalette } from "./palette/ComponentPalette";
import { PropertiesPanel } from "./properties/PropertiesPanel";
import { StatusBar } from "./StatusBar";

export function SchematicEditor() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <EditorToolbar />

      {/* Main area: palette + canvas + properties */}
      <div className="relative flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left panel - Component Palette */}
          {!leftCollapsed && (
            <>
              <ResizablePanel
                defaultSize={15}
                minSize={10}
                maxSize={25}
                className="border-r border-border"
              >
                <div className="flex h-full flex-col">
                  <div className="flex h-8 items-center justify-between border-b border-border px-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Components
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => setLeftCollapsed(true)}
                    >
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ComponentPalette />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          {/* Canvas */}
          <ResizablePanel
            defaultSize={leftCollapsed && rightCollapsed ? 100 : 70}
          >
            <div className="relative h-full">
              {/* Collapsed panel toggles */}
              {leftCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute left-1 top-1 z-10 h-6 w-6 p-0"
                  onClick={() => setLeftCollapsed(false)}
                >
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                </Button>
              )}
              {rightCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 z-10 h-6 w-6 p-0"
                  onClick={() => setRightCollapsed(false)}
                >
                  <PanelRightOpen className="h-3.5 w-3.5" />
                </Button>
              )}
              <SchematicCanvas />
            </div>
          </ResizablePanel>

          {/* Right panel - Properties */}
          {!rightCollapsed && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                defaultSize={15}
                minSize={10}
                maxSize={25}
                className="border-l border-border"
              >
                <div className="flex h-full flex-col">
                  <div className="flex h-8 items-center justify-between border-b border-border px-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Properties
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => setRightCollapsed(true)}
                    >
                      <PanelRightClose className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <PropertiesPanel />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
