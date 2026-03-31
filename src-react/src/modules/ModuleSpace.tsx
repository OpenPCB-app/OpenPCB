/**
 * Module Space Renderer
 *
 * Dynamically loads and renders module Space components with:
 * - Dynamic imports
 * - Loading states
 * - Error boundaries
 */

import { Suspense, lazy, useMemo, type ComponentType, type ReactElement } from "react";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { getManifestById } from "@shared/generated/modules";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface SpaceComponent {
    Space: ComponentType;
}

// =============================================================================
// Module Space Glob Import
// =============================================================================

// Pre-load all module Space components using Vite's import.meta.glob
// This allows Vite to know about all possible imports at build time
// Note: Use relative path from src-react/src/modules/ to modules/ directory
const spaceModules = import.meta.glob<SpaceComponent>(
    "../../../modules/*/react/Space.tsx",
    { eager: false }
);

// =============================================================================
// Module-level Cache
// =============================================================================

/**
 * Persistent cache for lazy-loaded Space components.
 * Ensures each module is lazy-loaded only ONCE, then reused across renders.
 */
const lazySpaceCache = new Map<string, ComponentType>();

// =============================================================================
// Loading State
// =============================================================================

function ModuleLoadingState({ moduleId }: { moduleId: string }) {
    return (
        <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading {moduleId}...</p>
            </div>
        </div>
    );
}

// =============================================================================
// Error State
// =============================================================================

function ModuleNotFoundError({ moduleId }: { moduleId: string }) {
    return (
        <div className="flex h-full items-center justify-center p-4">
            <Alert variant="destructive" className="max-w-md">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Module Not Found</AlertTitle>
                <AlertDescription>
                    Module "{moduleId}" is not registered or doesn't have a Space component.
                </AlertDescription>
            </Alert>
        </div>
    );
}

// =============================================================================
// Dynamic Space Loader
// =============================================================================

/**
 * Creates a lazy-loaded Space component from module ID.
 * Uses persistent module-level cache to ensure each module is loaded only once.
 */
function useLazySpace(moduleId: string): ComponentType | null {
    return useMemo(() => {
        // Check cache first - if component already created, reuse it
        const cached = lazySpaceCache.get(moduleId);
        if (cached) {
            console.debug(`[ModuleSpace] Using cached component for '${moduleId}'`);
            return cached;
        }

        // Construct the expected glob path for this module
        // Must match the relative path pattern used in import.meta.glob
        const globPath = `../../../modules/${moduleId}/react/Space.tsx`;

        // Find the loader function from the glob imports
        const loader = spaceModules[globPath];

        if (!loader) {
            console.error(`[ModuleSpace] No Space.tsx found for module '${moduleId}' at path: ${globPath}`);
            console.debug("[ModuleSpace] Available modules:", Object.keys(spaceModules));
            return null;
        }

        // Create lazy component - extract the Space export
        const LazyComponent = lazy(() =>
            loader().then((module) => ({ default: module.Space }))
        );

        // Create wrapper component with Suspense boundary
        const LazySpaceWrapper = function LazySpaceWrapper() {
            return (
                <Suspense fallback={<ModuleLoadingState moduleId={moduleId} />}>
                    <LazyComponent />
                </Suspense>
            );
        };

        // Cache it for future use
        lazySpaceCache.set(moduleId, LazySpaceWrapper);
        console.debug(`[ModuleSpace] Created and cached lazy component for '${moduleId}'`);

        return LazySpaceWrapper;
    }, [moduleId]);
}

// =============================================================================
// Module Space Renderer
// =============================================================================

export interface ModuleSpaceProps {
    /** Module ID to render */
    moduleId: string;
}

/**
 * Renders a module's Space component with error boundaries and loading states
 */
export function ModuleSpace({ moduleId }: ModuleSpaceProps): ReactElement {
    const manifest = getManifestById(moduleId);
    const SpaceComponent = useLazySpace(moduleId);

    // Module not found
    if (!manifest) {
        return <ModuleNotFoundError moduleId={moduleId} />;
    }

    // Module doesn't have a space component
    if (manifest.kind !== "space") {
        return <ModuleNotFoundError moduleId={moduleId} />;
    }

    // Space component not found
    if (!SpaceComponent) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <Alert variant="destructive" className="max-w-md">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Space Component Not Found</AlertTitle>
                    <AlertDescription>
                        Module "{moduleId}" is registered but Space.tsx could not be loaded.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <ModuleErrorBoundary moduleId={moduleId}>
            <SpaceComponent />
        </ModuleErrorBoundary>
    );
}
