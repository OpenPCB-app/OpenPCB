/**
 * ModuleContext - Context object provided to each module
 * Contains module identity, logger, and event bus
 *
 * This is the runtime implementation that matches the core interface.
 */

import type {
  ModuleContext as ModuleContextInterface,
  ModuleManifest,
  MentionRegistration,
} from "shared/types";
import type { EventBus } from "./EventBus";
import type { Logger } from "./Logger";

/**
 * Runtime module context type
 * Matches the core ModuleContext interface
 */
export type ModuleContext = ModuleContextInterface;

/**
 * Re-export ModuleManifest from core types
 */
export type { ModuleManifest };

/**
 * Create a module context instance
 */
export function createModuleContext(
  moduleId: string,
  manifest: ModuleManifest,
  logger: Logger,
  events: EventBus,
  db: ModuleContextInterface["db"],
  mentions: MentionRegistration,
  core: ModuleContextInterface["core"],
): ModuleContext {
  return {
    moduleId,
    manifest,
    logger,
    events,
    db,
    mentions,
    core,
  };
}
