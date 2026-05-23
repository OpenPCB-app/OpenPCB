/**
 * Content-addressed cache for rendered preview SVGs.
 *
 * Keys are the symbol/footprint `content_sha256`. When a row lacks a content
 * hash (legacy imports or in-memory snapshots), the cache is bypassed and
 * the SVG is regenerated on every request. That's still cheap — the renderer
 * is a pure string build — but the ETag becomes a hash of the SVG body.
 */

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "@openpcb/rendering-core";
import { getDb } from "../queries";
import { previewSvgs } from "../schema";
import { renderFootprintToSvg, renderSymbolToSvg } from "./render-svg";

/**
 * Bump when the SVG renderer output changes meaningfully (color rules,
 * fill conventions, viewBox math). The prefix is baked into the cache key
 * so older cached SVGs are skipped without manual table truncation.
 */
const RENDERER_VERSION = "v3";

export type PreviewKind = "symbol" | "footprint";
export type PreviewTheme = "light" | "dark" | "auto";

/** App theme → stroke color baked into the SVG so `<img>` shows the right shade. */
const THEME_COLORS: Record<Exclude<PreviewTheme, "auto">, string> = {
  light: "#475569", // slate-600 — visible on light backgrounds
  dark: "#e2e8f0", // slate-200 — visible on dark card backgrounds
};

export function resolveStrokeColor(theme: PreviewTheme): string | undefined {
  return theme === "auto" ? undefined : THEME_COLORS[theme];
}

export interface PreviewResult {
  svg: string;
  etag: string;
  /** True when the SVG came from the cache table (debug / metrics only). */
  cached: boolean;
}

export async function getOrRenderSymbolPreview(
  ctx: CoreBackendModuleContext,
  contentSha256: string | null,
  model: SymbolRenderModel,
  theme: PreviewTheme = "auto",
): Promise<PreviewResult> {
  const strokeColor = resolveStrokeColor(theme);
  return getOrRender(ctx, contentSha256, "symbol", theme, () =>
    renderSymbolToSvg(model, strokeColor ? { strokeColor } : {}),
  );
}

export async function getOrRenderFootprintPreview(
  ctx: CoreBackendModuleContext,
  contentSha256: string | null,
  model: FootprintRenderModel,
  theme: PreviewTheme = "auto",
): Promise<PreviewResult> {
  const strokeColor = resolveStrokeColor(theme);
  return getOrRender(ctx, contentSha256, "footprint", theme, () =>
    renderFootprintToSvg(model, strokeColor ? { strokeColor } : {}),
  );
}

async function getOrRender(
  ctx: CoreBackendModuleContext,
  contentSha256: string | null,
  kind: PreviewKind,
  theme: PreviewTheme,
  render: () => string,
): Promise<PreviewResult> {
  if (contentSha256) {
    const cacheKey = `${RENDERER_VERSION}:${theme}:${contentSha256}`;
    const etag = `"${cacheKey}"`;
    const db = getDb(ctx);
    const row = await db
      .select()
      .from(previewSvgs)
      .where(eq(previewSvgs.contentSha256, cacheKey))
      .get();
    if (row) {
      return { svg: row.svg, etag, cached: true };
    }
    const svg = render();
    await db
      .insert(previewSvgs)
      .values({
        contentSha256: cacheKey,
        kind,
        svg,
        generatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    return { svg, etag, cached: false };
  }
  // No content hash → render fresh, ETag derived from the SVG body itself.
  const svg = render();
  const fallbackEtag = `W/"${createHash("sha256").update(svg).digest("hex").slice(0, 16)}"`;
  return { svg, etag: fallbackEtag, cached: false };
}
