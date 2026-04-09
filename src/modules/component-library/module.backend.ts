import manifest from "./manifest.json";
import { definition } from "./backend";

/**
 * Bun-side barrel. Imported by the module loader via dynamic import;
 * re-exports the manifest (so the loader can cross-check id/version) and
 * the concrete module definition (so the loader can invoke lifecycle
 * hooks without importing other module internals).
 */
export { manifest, definition };
export default definition;
