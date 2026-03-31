import { useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAppStore } from "@/stores/app-store";
import { useDesigns } from "@/hooks/useDesigns";
import { DesignHeader } from "./design/DesignHeader";
import { EditorToolbar } from "@/components/pcb/toolbar/EditorToolbar";
import { SchematicCanvas } from "@/components/pcb/canvas/SchematicCanvas";
import { ComponentPalette } from "@/components/pcb/palette/ComponentPalette";
import { StatusBar } from "@/components/pcb/StatusBar";
import { useSchematicInteractionController } from "@/components/pcb/useSchematicInteractionController";
import { FloatingPropertiesPopover } from "@/components/pcb/properties/FloatingPropertiesPopover";
import { useSchematicStore } from "@/stores/schematic-store";

function isTextEntryFocused(activeElement: Element | null): boolean {
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (activeElement.isContentEditable) {
    return true;
  }

  if (activeElement instanceof HTMLTextAreaElement) {
    return true;
  }

  if (!(activeElement instanceof HTMLInputElement)) {
    return false;
  }

  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(activeElement.type);
}

export function DesignScreen() {
  const designTab = useNavigationStore((s) => s.designTab);
  const currentProjectId = useNavigationStore((s) => s.currentProjectId);
  const currentDesignId = useNavigationStore((s) => s.currentDesignId);
  const navigateToProject = useNavigationStore((s) => s.navigateToProject);
  const navigateToHome = useNavigationStore((s) => s.navigateToHome);
  const projects = useAppStore((s) => s.projects);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const project = projects.find((p) => p.id === currentProjectId);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const { designs } = useDesigns({
    workspaceId: activeWorkspaceId,
    projectId: currentProjectId,
  });
  const design = designs.find((item) => item.id === currentDesignId);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const controller = useSchematicInteractionController();
  const popoverEntityId = useSchematicStore((s) => s.chrome.popoverEntityId);
  const setPopoverTarget = useSchematicStore((s) => s.setPopoverTarget);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (popoverEntityId) {
        if (isTextEntryFocused(globalThis.document.activeElement)) {
          return;
        }

        setPopoverTarget(null);
        return;
      }

      controller.cancelSession();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller, popoverEntityId, setPopoverTarget]);

  return (
    <div className="flex h-full flex-col">
      {/* Header with project name + tab bar */}
      <DesignHeader
        projectName={project?.name ?? activeWorkspace?.name ?? "Workspace"}
        designName={design?.name ?? "Untitled design"}
        onAiToggle={() => setAiOpen(!aiOpen)}
        aiOpen={aiOpen}
      />

      {/* Toolbar — context-sensitive per tab */}
      {(designTab === "schematic" || designTab === "pcb") && (
        <EditorToolbar controller={controller} />
      )}

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
                  <ComponentPalette controller={controller} />

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

              {!design ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-text-muted">
                  <p className="text-sm font-medium text-text-primary">
                    No design selected
                  </p>
                  <p className="max-w-sm text-sm text-text-muted">
                    Open a design from a project or from the workspace designs list before using the editor.
                  </p>
                  {project ? (
                    <button
                      className="rounded-md border border-border-default px-4 py-2 text-sm text-text-primary hover:bg-bg-input"
                      onClick={() => navigateToProject(project.id)}
                    >
                      Back to Project
                    </button>
                  ) : (
                    <button
                      className="rounded-md border border-border-default px-4 py-2 text-sm text-text-primary hover:bg-bg-input"
                      onClick={navigateToHome}
                    >
                      Back to Home
                    </button>
                  )}
                </div>
              ) : designTab === "schematic" ? (
                <div className="relative h-full">
                  <SchematicCanvas controller={controller} />
                  <FloatingPropertiesPopover />
                </div>
              ) : null}

              {design && designTab === "pcb" && (
                <div className="flex h-full items-center justify-center text-text-muted">
                  PCB layout editor — coming soon
                </div>
              )}

              {design && designTab === "3d" && (
                <div className="flex h-full items-center justify-center text-text-muted">
                  3D viewer — coming soon
                </div>
              )}

              {design && designTab === "bom" && (
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
      <StatusBar />
    </div>
  );
}
