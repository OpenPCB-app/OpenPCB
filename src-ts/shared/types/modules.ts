// =============================================================================
// Module Types
// =============================================================================

import type * as React from "react";
import type { HttpRouter } from "./http";
import type { WsRouter } from "./ws";
import type { Logger } from "./logger";
import type { EventBus } from "./events";
import type { ModuleManifest } from "./manifest";
import type { RegisterToolFunction } from "./tool.types";
export interface ModuleDbHandle {
  getRawDb(): unknown;
  query<T = unknown>(
    sqlTemplate: string,
    tableName: string,
    params?: unknown[],
  ): Promise<T[]>;
  execute(
    sqlTemplate: string,
    tableName: string,
    params?: unknown[],
  ): Promise<void>;
  createTable(tableName: string, columnDefinitions: string): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  transaction<T>(
    fn: (handle: ModuleDbHandle) => Promise<T>,
    options?: unknown,
  ): Promise<T>;
}
import type { MentionRegistration } from "./mention";
import type { ProjectRecord } from "./project.types";

/** Module type classification */
export type ModuleKind =
  | "space"
  | "service"
  | "integration"
  | "widget"
  | "system";

/** Explicit core capability keys modules can request from host runtime */
export type ModuleCoreCapability =
  | "projects"
  | "contentEditor"
  | "toolRegistry";

export interface SpaceModuleSidebarButtons {
  left_top: React.ReactNode[];
  left_bottom: React.ReactNode[];
  right_top: React.ReactNode[];
  right_bottom: React.ReactNode[];
}
/** Module Provider Interface */

export interface ModuleProvider {
  getAllModules(): ModuleDefinitionV2[];
  getModuleById(moduleId: string): ModuleDefinitionV2 | undefined;
  registerModuleShortcuts(moduleId: string): void;
  getSpaceModules(): ModuleDefinitionV2[];
  getSpaceSidebarButtons(
    moduleId: string | null,
  ): SpaceModuleSidebarButtons | undefined;
}

/** Base props passed to space components */
export interface ModuleSpaceProps {
  moduleId: string;
  namespace: string;
}

/** Base props passed to widget components */
export interface ModuleWidgetProps {
  moduleId: string;
  widgetId: string;
  slot: string;
}

// =============================================================================
// Service Registry
// =============================================================================

/**
 * Module Service Registry
 * Maps service IDs to service implementations
 */
export interface ModuleServiceRegistry {
  [serviceId: string]: unknown;
}

/**
 * Module Context
 *
 * Runtime context provided to each module during initialization.
 * Contains module identity, utilities, and service access.
 */
export interface ModuleContext {
  /** Module unique identifier */
  moduleId: string;

  /** Module manifest metadata */
  manifest: ModuleManifest;

  /** Scoped logger instance */
  logger: Logger;

  /** Module-scoped event bus */
  events: EventBus;

  /** Module-isolated database handle */
  db: ModuleDbHandle;

  /** Mention provider registration */
  mentions: MentionRegistration;

  /** Core services available to modules */
  core: {
    projects?: {
      list: () => Promise<ProjectRecord[]>;
      get: (id: string) => Promise<ProjectRecord | null>;
      current: () => ProjectRecord | null;
    };
    /** Content editor integration - register content targets */
    contentEditor?: {
      registerTarget: (target: ContentTarget) => void;
      unregisterTarget: (targetType: string) => void;
    };
    /** Tool registry integration - register tool handlers */
    toolRegistry?: {
      registerTool: RegisterToolFunction;
    };
  };
}

/**
 * Content target interface for module context
 * Simplified version for module registration
 */
export interface ContentTarget {
  readonly targetType: string;
  readonly label: string;
  readonly description?: string;
  readonly supportedModes: Array<"replace" | "append" | "selection" | "generate">;
  exists(targetId: string): Promise<boolean>;
  getContent(targetId: string): Promise<unknown>;
  getContentContext(targetId: string, selection?: unknown): Promise<unknown>;
  setContent(targetId: string, content: unknown): Promise<void>;
  applySelectionUpdate(targetId: string, selection: unknown, newContent: unknown): Promise<void>;
  validateSelection?(targetId: string, selection: unknown): Promise<boolean>;
  getMetadata?(targetId: string): Promise<Record<string, unknown>>;
}

// =============================================================================
// Module Definition
// =============================================================================

/**
 * Module Definition (V2)
 * Full-featured module with services, widgets, and lifecycle hooks
 */
export interface ModuleDefinitionV2 {
  id: string;
  namespace: string;
  label: string;
  version: string;
  kind: ModuleKind;

  /** React component for primary space (for space modules) */
  spaceComponent?: React.ComponentType<ModuleSpaceProps>;

  /** Widget components mapped by widget ID */
  widgets?: Record<string, React.ComponentType<ModuleWidgetProps>>;

  /** Factory function to create service registry */
  services?: (ctx: ModuleContext) => ModuleServiceRegistry;

  /** HTTP and WebSocket endpoint registration */
  endpoints?: (ctx: ModuleContext, http: HttpRouter, ws: WsRouter) => void;

  /** Called when module is activated */
  onActivate?: (ctx: ModuleContext) => Promise<void> | void;

  /** Called when module is deactivated */
  onDeactivate?: (ctx: ModuleContext) => Promise<void> | void;
}

/**
 * Module configuration (input to createModuleV2)
 */
export interface ModuleV2Config {
  label: string;
  namespace: string;
  version: string;
  kind?: ModuleKind;
  spaceComponent?: React.ComponentType<ModuleSpaceProps>;
  widgets?: Record<string, React.ComponentType<ModuleWidgetProps>>;
  services?: (ctx: ModuleContext) => ModuleServiceRegistry;
  onActivate?: (ctx: ModuleContext) => Promise<void> | void;
  onDeactivate?: (ctx: ModuleContext) => Promise<void> | void;
  endpoints?: (ctx: ModuleContext, http: HttpRouter, ws: WsRouter) => void;
}
