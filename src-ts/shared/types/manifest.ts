/**
 * Module Manifest Types
 *
 * Defines the structure of module manifest metadata.
 * The full manifest may contain additional properties defined in the schema.
 */

import type { ModuleCoreCapability, ModuleKind } from "./modules";

export interface ModuleDbConfig {
    migrations?: boolean | string;
    prefix?: string;
    /** Allow module access to raw db instance via ctx.db.getRawDb() */
    rawAccess?: boolean;
}

/**
 * Module Manifest
 *
 * Core metadata about a module loaded from manifest.json.
 * Contains identity, version, and configuration information.
 *
 * @see modules/_kit/module.manifest.schema.json for full schema
 */
export interface ModuleManifest {
    /** Unique module identifier (e.g., "hello", "tasks") */
    id: string;

    /** Human-readable module name */
    label: string;

    /** Semantic version (e.g., "1.0.0") */
    version: string;

    /** Module classification */
    kind: ModuleKind;

    /** Fully-qualified namespace (e.g., "space.hello") */
    namespace: string;

    /** Module API version (1 or 2) */
    apiVersion: number;

    /** Optional searchable tags for module discovery */
    tags?: string[];

    /** Optional module description */
    description?: string;

    /** Optional module database settings */
    db?: ModuleDbConfig;

    /** Declared host capabilities requested by module */
    coreCapabilities?: ModuleCoreCapability[];
}
