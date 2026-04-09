/**
 * Shared types for module scaffolding
 */

export type ModuleKind = "space" | "service" | "integration" | "widget" | "system";

export interface ScaffoldOptions {
    id: string;
    label: string;
    namespace: string;
    version: string;
    kind: ModuleKind;
    tags: string[];
    hasHttpEndpoints: boolean;
    hasReactUI: boolean;
    runCodegen: boolean;
}

export interface ModuleManifest {
    id: string;
    label: string;
    version: string;
    apiVersion: number;
    namespace: string;
    kind: ModuleKind;
    tags: string[];
    runner: {
        mode: string;
    };
    fs: {
        root: string;
        permissions: string[];
    };
    db: {
        prefix: string;
        migrations: boolean;
        rawAccess: boolean;
    };
    coreCapabilities: Array<"projects" | "contentEditor" | "toolRegistry">;
    ui: {
        moduleEntry: string;
        primarySpace?: string;
        registerAsSpaceInTopBar: boolean;
    };
    dependsOn: string[];
    exports: {
        services: string[];
        widgets: string[];
    };
    defaultPinned: boolean;
}

export const VALID_KINDS: ModuleKind[] = ["space", "service", "integration", "widget", "system"];

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
