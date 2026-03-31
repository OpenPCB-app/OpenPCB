import type { EditorEngineAdapter } from "./EditorEngineAdapter";
import { TiptapAdapter } from "./TiptapAdapter";

/**
 * Editor Engine Registry
 *
 * Manages available editor adapters and provides the current
 * active adapter. This allows for engine swapping.
 */

type EditorEngineName = "tiptap" | "slate";

const adapters: Map<EditorEngineName, EditorEngineAdapter> = new Map();

// Register adapters
adapters.set("tiptap", new TiptapAdapter());

/**
 * Get the adapter for a specific engine
 */
export function getAdapter(
  engine: EditorEngineName = "tiptap",
): EditorEngineAdapter {
  const adapter = adapters.get(engine);
  if (!adapter) {
    throw new Error(`Editor engine "${engine}" not registered`);
  }
  return adapter;
}

/**
 * Register a new adapter
 */
export function registerAdapter(
  engine: EditorEngineName,
  adapter: EditorEngineAdapter,
): void {
  adapters.set(engine, adapter);
}

/**
 * Get all registered engine names
 */
export function getRegisteredEngines(): EditorEngineName[] {
  return Array.from(adapters.keys());
}

/**
 * Default engine name
 */
export const DEFAULT_ENGINE: EditorEngineName = "tiptap";
