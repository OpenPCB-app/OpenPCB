/**
 * Utility functions for module scaffolding
 */

import type { ModuleKind } from "./types.js";

export function titleCase(value: string): string {
    return value
        .split(/[-_]/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");
}

export function toPascalCase(value: string): string {
    return value
        .split(/[-_]/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
}

export function toCamelCase(value: string): string {
    const pascal = toPascalCase(value);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toSnakeCase(value: string): string {
    return value.replace(/-/g, "_");
}

export function getDefaultNamespace(id: string, kind: ModuleKind): string {
    const normalizedId = id.replace(/-/g, "");
    switch (kind) {
        case "service":
            return `service.${normalizedId}`;
        case "integration":
            return `integration.${normalizedId}`;
        case "widget":
            return `widget.${normalizedId}`;
        case "system":
            return `system.${normalizedId}`;
        case "space":
        default:
            return `space.${normalizedId}`;
    }
}

export function getCrateName(id: string): string {
    return `module_${toSnakeCase(id)}`;
}
