/**
 * Static module registry.
 *
 * Statically imports every first-party module backend so the compiled Bun
 * sidecar binary embeds all module code and their npm dependencies. The
 * module loader uses these exports at runtime instead of resolving a
 * dynamic import against the on-disk `module.backend.ts`, which would
 * otherwise fail in packaged mode because `node_modules/` is not shipped
 * alongside the source files.
 */

import * as assistantBackend from "../../../modules/assistant/module.backend";
import * as designerBackend from "../../../modules/designer/module.backend";
import * as libraryBackend from "../../../modules/library/module.backend";
import * as tasksBackend from "../../../modules/tasks/module.backend";

export type StaticModuleExports = Record<string, unknown>;

export const STATIC_MODULES: ReadonlyMap<string, StaticModuleExports> = new Map<
  string,
  StaticModuleExports
>([
  ["assistant", assistantBackend as unknown as StaticModuleExports],
  ["designer", designerBackend as unknown as StaticModuleExports],
  ["library", libraryBackend as unknown as StaticModuleExports],
  ["tasks", tasksBackend as unknown as StaticModuleExports],
]);
