/**
 * Module Kit - createModule helper
 *
 * Factory function for creating V2 module definitions.
 */
import { ModuleDefinitionV2, ModuleV2Config } from "@shared/types";



// =============================================================================
// Validation
// =============================================================================

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;

function validateNamespace(namespace: string, id: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `Module '${id}' namespace '${namespace}' must follow <prefix>.<name> notation`,
    );
  }
}

function validateId(id: string): void {
  if (!id || !id.trim()) {
    throw new Error("createModuleV2 requires a non-empty id");
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a module definition
 *
 * @param id - Unique module identifier
 * @param config - Module configuration
 * @returns ModuleDefinitionV2
 *
 * @example
 * ```ts
 * export default createModuleV2("my-module", {
 *   label: "My Module",
 *   namespace: "space.mymodule",
 *   version: "1.0.0",
 *   kind: "space",
 *   spaceComponent: MySpaceComponent,
 * });
 * ```
 */
export function createModuleV2(id: string, config: ModuleV2Config): ModuleDefinitionV2 {
  validateId(id);
  validateNamespace(config.namespace, id);

  return {
    id,
    namespace: config.namespace,
    label: config.label,
    version: config.version,
    kind: config.kind ?? "space",
    spaceComponent: config.spaceComponent,
    widgets: config.widgets,
    services: config.services,
    endpoints: config.endpoints,
    onActivate: config.onActivate,
    onDeactivate: config.onDeactivate,
  };
}
