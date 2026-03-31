import { lazy, Suspense } from "react";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";

const KnowledgeSpace = lazy(() =>
  import("../../../modules/knowledge/react/Space").then((m) => ({
    default: m.Space,
  })),
);

export function NotesScreen() {
  return (
    <div className="flex h-full">
      <ModuleErrorBoundary moduleId="knowledge" componentName="Knowledge Base">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                <p className="text-xs text-text-muted">
                  Loading knowledge base...
                </p>
              </div>
            </div>
          }
        >
          <KnowledgeSpace />
        </Suspense>
      </ModuleErrorBoundary>
    </div>
  );
}
