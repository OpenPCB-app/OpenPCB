import type {
  CoreBackendModuleContext,
  ModuleDefinition,
} from "../../contracts/modules/backend-module";
import type { ModuleErrorBoundary } from "../router/module-types";

/**
 * Re-export the public contract types so downstream callers inside
 * core/backend can import them from one place. Modules should import
 * the types directly from `core/contracts/modules/backend-module`.
 */
export type { CoreBackendModuleContext, ModuleDefinition };

/**
 * Backend definition shape as seen at runtime. Adds the optional
 * error boundary, which is a core/backend internal concern (not exposed
 * to modules through contracts).
 */
export interface CoreBackendModuleDefinition extends ModuleDefinition {
  errorBoundary?: ModuleErrorBoundary;
}

export function isCoreBackendModuleDefinition(
  value: unknown,
): value is CoreBackendModuleDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CoreBackendModuleDefinition>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return false;
  }
  if (
    candidate.registerRoutes &&
    typeof candidate.registerRoutes !== "function"
  ) {
    return false;
  }
  if (candidate.registerSdk && typeof candidate.registerSdk !== "function") {
    return false;
  }
  if (candidate.onActivate && typeof candidate.onActivate !== "function") {
    return false;
  }
  if (candidate.onDeactivate && typeof candidate.onDeactivate !== "function") {
    return false;
  }
  if (
    candidate.errorBoundary &&
    typeof candidate.errorBoundary !== "function"
  ) {
    return false;
  }
  return true;
}
