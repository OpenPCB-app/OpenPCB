import type { ReactElement } from "react";
import type { ModuleSpaceProps } from "@modules/_kit/createModule";

export function ComponentLibrarySpace({ moduleId, namespace }: ModuleSpaceProps): ReactElement {
    return (
        <div className="space-y-4 rounded-lg border border-dashed p-4">
            <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Component Library Space
                </p>
                <span className="text-xs text-muted-foreground">{namespace}</span>
            </div>
            <div className="text-sm text-muted-foreground">
                <p>Module ID: {moduleId}</p>
            </div>
            <p className="text-sm text-muted-foreground">
                Update <code>modules/component-library/react/Space.tsx</code> to customize this space.
            </p>
        </div>
    );
}
