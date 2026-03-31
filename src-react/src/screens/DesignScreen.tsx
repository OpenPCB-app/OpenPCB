import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAppStore } from "@/stores/app-store";
import { DesignHeader } from "./design/DesignHeader";
import { DesignStatusBar } from "./design/DesignStatusBar";
import { EditorToolbar } from "@/components/pcb/toolbar/EditorToolbar";
import { SchematicCanvas } from "@/components/pcb/canvas/SchematicCanvas";
import { ComponentPalette } from "@/components/pcb/palette/ComponentPalette";

export function DesignScreen() {
  const designTab = useNavigationStore((s) => s.designTab);
  const currentProjectId = useNavigationStore((s) => s.currentProjectId);
  const projects = useAppStore((s) => s.projects);
  const project = projects.find((p) => p.id === currentProjectId);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Header with project name + tab bar */}
      <DesignHeader
        projectName={project?.name ?? "Untitled project"}
        onAiToggle={() => setAiOpen(!aiOpen)}
        aiOpen={aiOpen}
      />

      {/* Toolbar — context-sensitive per tab */}
      {(designTab === "schematic" || designTab === "pcb") && <EditorToolbar />}

      {/* Main area */}
      <div className="relative flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left sidebar: Components / Layers / Design Tree */}
          {!leftCollapsed && (
            <>
              <ResizablePanel
                defaultSize={15}
                minSize={10}
                maxSize={20}
                className="border-r border-border-default"
              >
                <div className="flex h-full flex-col bg-bg-secondary">
                  <div className="flex h-8 items-center justify-between border-b border-border-default px-2">
                    <span className="text-[10px] font-medium tracking-wider text-text-secondary uppercase">
                      Components
                    </span>
                    <button
                      className="h-5 w-5 flex items-center justify-center text-text-tertiary hover:text-text-secondary"
                      onClick={() => setLeftCollapsed(true)}
                    >
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <ComponentPalette />

                  {/* Layers section */}
                  <div className="border-t border-border-default">
                    <div className="flex h-8 items-center px-2">
                      <span className="text-[10px] font-medium tracking-wider text-text-secondary uppercase">
                        Layers
                      </span>
                    </div>
                    <div className="px-2 pb-2">
                      {["F.Cu", "B.Cu", "F.SilkS", "F.Mask", "Edge.Cuts"].map(
                        (layer) => (
                          <div
                            key={layer}
                            className="flex items-center gap-2 h-6 text-xs text-text-secondary"
                          >
                            <span className="h-2 w-2 rounded-sm bg-copper-front" />
                            <span>{layer}</span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          {/* Canvas area */}
          <ResizablePanel defaultSize={leftCollapsed ? 100 : 85}>
            <div className="relative h-full">
              {leftCollapsed && (
                <button
                  className="absolute left-1 top-1 z-10 h-6 w-6 flex items-center justify-center rounded text-text-tertiary hover:bg-bg-input"
                  onClick={() => setLeftCollapsed(false)}
                >
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                </button>
              )}

              {designTab === "schematic" && <SchematicCanvas />}

              {designTab === "pcb" && (
                <div className="flex h-full items-center justify-center text-text-muted">
                  PCB layout editor — coming soon
                </div>
              )}

              {designTab === "3d" && (
                <div className="flex h-full items-center justify-center text-text-muted">
                  3D viewer — coming soon
                </div>
              )}

              {designTab === "bom" && (
                <div className="flex h-full items-center justify-center text-text-muted">
                  Bill of Materials — coming soon
                </div>
              )}
            </div>
          </ResizablePanel>

          {/* AI Copilot panel (right) */}
          {aiOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                defaultSize={20}
                minSize={8}
                maxSize={25}
                className="border-l border-border-default"
              >
                <div className="flex h-full flex-col bg-bg-secondary">
                  <div className="flex h-8 items-center justify-between border-b border-border-default px-3">
                    <span className="text-xs font-medium text-text-secondary">
                      AI Copilot
                    </span>
                    <button
                      className="text-text-tertiary hover:text-text-secondary text-xs"
                      onClick={() => setAiOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-3">
                    <p className="text-xs text-text-muted">
                      Ask anything about your design...
                    </p>
                  </div>
                  <div className="border-t border-border-default p-2">
                    <input
                      type="text"
                      placeholder="Ask the copilot..."
                      className="w-full h-8 rounded-md bg-bg-input px-3 text-xs text-text-primary placeholder:text-text-tertiary border border-border-default focus:border-border-strong focus:outline-none"
                    />
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Status Bar */}
      <DesignStatusBar />
    </div>
  );
}
