// Byte-identical copy of src/core/frontend/public/fonts/eda/manifest.json: Vite
// refuses JS imports from public/, while the font + licence + manifest must still
// ship side by side.
import fontManifest from "./eda-font-manifest.json";

type GlyphCoverage = readonly (readonly [number, number])[];

/** Mirrors `EdaTextConfiguration` from @openpcb/r3f-eda-canvas text/runtime. */
export interface EdaTextConfiguration {
  fontUrl: string;
  fontSha256: string;
  coverage: GlyphCoverage;
  replacement: string;
  timeoutMs?: number;
}

interface EdaTextModule {
  configureEdaText?: (configuration: EdaTextConfiguration) => void;
  disposeEdaText?: () => void;
}

const FONT_TIMEOUT_MS = 5000;

function glyphCoverage(intervals: readonly (readonly number[])[]): GlyphCoverage {
  return intervals.map((interval) => {
    const [first, last] = interval;
    if (interval.length !== 2 || first === undefined || last === undefined) {
      throw new Error("Bundled EDA font manifest has an invalid coverage interval");
    }
    return [first, last] as const;
  });
}

export function bundledEdaTextConfiguration(
  baseUrl: string = import.meta.env.BASE_URL,
): EdaTextConfiguration {
  return {
    // Same-origin path under the Vite base; the canvas runtime refuses any other origin.
    fontUrl: `${baseUrl.replace(/\/?$/, "/")}fonts/eda/${fontManifest.filename}`,
    fontSha256: fontManifest.sha256,
    coverage: glyphCoverage(fontManifest.coverage),
    replacement: fontManifest.replacement,
    timeoutMs: FONT_TIMEOUT_MS,
  };
}

/**
 * Points every EDA canvas at the bundled font. Feature-detected because the
 * pinned r3f-eda-canvas v0.1.4 has no `configureEdaText`; the export arrives
 * with the next r3f-eda-canvas tag. Returns whether the package was configured.
 */
export function configureBundledEdaText(canvasModule: object): boolean {
  const api = canvasModule as EdaTextModule;
  if (typeof api.configureEdaText !== "function") return false;
  api.configureEdaText(bundledEdaTextConfiguration());
  return true;
}

export function disposeBundledEdaText(canvasModule: object): void {
  const api = canvasModule as EdaTextModule;
  if (typeof api.disposeEdaText === "function") api.disposeEdaText();
}

let installed = false;

/**
 * Called by the canvas-hosting module entries, which already load the package
 * root. Not from app startup: loading the root of pinned v0.1.4 runs its
 * import-time remote font preload on every launch, even with no canvas open.
 * Idempotent because reconfiguring discards the loaded font generation.
 */
export function installBundledEdaText(canvasModule: object): void {
  if (installed) return;
  installed = true;
  if (!configureBundledEdaText(canvasModule) || typeof window === "undefined") return;
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) disposeBundledEdaText(canvasModule);
  });
}
