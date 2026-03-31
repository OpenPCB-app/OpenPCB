"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Maximize2Icon } from "lucide-react";
import mermaid from "mermaid";
import type { ComponentProps } from "react";
import { memo, useEffect, useRef, useState } from "react";

export type MermaidDiagramProps = ComponentProps<"div"> & {
  code: string;
  className?: string;
};

// Initialize mermaid once
let mermaidInitialized = false;

const initializeMermaid = () => {
  if (!mermaidInitialized && typeof window !== "undefined") {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      fontFamily: "inherit",
    });
    mermaidInitialized = true;
  }
};

export const MermaidDiagram = memo(function MermaidDiagram({
  code,
  className,
  ...props
}: MermaidDiagramProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const fullSizeRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [previewId] = useState(
    () => `mermaid-preview-${Math.random().toString(36).substr(2, 9)}`,
  );

  useEffect(() => {
    if (!previewRef.current || !code.trim()) {
      return;
    }

    let isMounted = true;

    const renderPreview = async () => {
      try {
        setIsRendering(true);
        setError(null);

        initializeMermaid();

        const element = previewRef.current;
        if (!element || !isMounted) {
          return;
        }

        element.className = "mermaid";
        element.textContent = code;
        element.id = previewId;

        try {
          await mermaid.run({
            nodes: [element],
            suppressErrors: false,
          });

          if (isMounted && element) {
            const svg = element.querySelector("svg");
            if (svg) {
              svg.removeAttribute("width");
              svg.removeAttribute("height");
              svg.classList.add("mx-auto");
              svg.classList.add("max-h-[calc(55vh-160px)]");
              svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
            }
          }

          if (isMounted) {
            setIsRendering(false);
          }
        } catch (renderError) {
          if (isMounted) {
            throw renderError;
          }
        }
      } catch (err) {
        if (isMounted) {
          const errorMessage =
            err instanceof Error
              ? err.message
              : "Failed to render Mermaid diagram";
          setError(errorMessage);
          setIsRendering(false);
          console.error("Mermaid rendering error:", err);
        }
      }
    };

    renderPreview();

    return () => {
      isMounted = false;
    };
  }, [code, previewId]);

  useEffect(() => {
    if (!isDialogOpen || !code.trim()) {
      return;
    }

    let isMounted = true;

    const renderFullSize = async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (!isMounted || !fullSizeRef.current) {
        return;
      }

      try {
        initializeMermaid();

        const element = fullSizeRef.current;
        if (!element || !isMounted) {
          return;
        }

        element.innerHTML = "";

        const newId = `mermaid-full-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        element.className = "mermaid";
        element.textContent = code;
        element.id = newId;

        await mermaid.run({
          nodes: [element],
          suppressErrors: false,
        });
      } catch (err) {
        console.error("Mermaid full-size rendering error:", err);
      }
    };

    renderFullSize();

    return () => {
      isMounted = false;
    };
  }, [isDialogOpen, code]);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive my-4",
          className,
        )}
        {...props}
      >
        <div className="font-semibold mb-1">Mermaid Diagram Error</div>
        <div className="text-muted-foreground">{error}</div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs">Show code</summary>
          <pre className="mt-2 text-xs overflow-auto bg-muted p-2 rounded">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "mermaid-container my-4 rounded-md border bg-surface p-2 relative group cursor-pointer max-w-full w-auto",
          isRendering && "min-h-[200px] flex items-center justify-center",
          className,
        )}
        onClick={() => setIsDialogOpen(true)}
        {...props}
      >
        {isRendering && (
          <div className="text-foreground text-sm">Rendering diagram...</div>
        )}

        <div className="max-w-[400px] w-auto max-h-[calc(55vh-160px)] min-h-[200px]">
          <div
            ref={previewRef}
            className={cn(
              "mermaid-preview max-w-[300px] max-h-[calc(55vh-160px)] w-auto",
              isRendering && "hidden",
            )}
          />
        </div>

        {!isRendering && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center pointer-events-none">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 backdrop-blur-sm rounded-md px-3 py-1.5 flex items-center gap-2 text-sm border pointer-events-auto">
              <Maximize2Icon className="size-4" />
              <span>Click to view full size</span>
            </div>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh]">
          <DialogTitle className="sr-only">Mermaid Diagram</DialogTitle>
          <div className="overflow-auto mx-auto max-w-full max-h-[calc(95vh-160px)] flex items-center justify-center p-4 min-h-[200px]">
            <div ref={fullSizeRef} className="mermaid-full-size w-full" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
