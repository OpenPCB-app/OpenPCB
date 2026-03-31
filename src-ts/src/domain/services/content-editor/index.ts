/**
 * Content Editor Module
 *
 * AI-powered content editing system with:
 * - Multiple edit modes (replace, append, selection)
 * - Snapshot-based rollback
 * - Lock-based concurrency control
 * - SSE streaming
 */

// Types
export * from "./types";
export * from "./errors";

// Interfaces
export type { ContentTarget, TargetRegistrationOptions } from "./content-target.interface";

// Services
export { ContentEditorService, type ContentEditorConfig } from "./content-editor-service";
export {
  ContentTargetRegistry,
  getContentTargetRegistry,
  initializeContentTargetRegistry,
} from "./content-target-registry";

// Utilities
export {
  buildEditPrompt,
  getRecommendedTemperature,
  getRecommendedMaxTokens,
  type BuiltPrompt,
  type PromptBuilderOptions,
} from "./prompt-builder";

export {
  parseEditOutput,
  validateNotEmpty,
  OutputAccumulator,
  extractText,
  isSubstantiallyDifferent,
  type ParseResult,
} from "./output-parser";
