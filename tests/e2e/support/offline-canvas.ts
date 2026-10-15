import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Troika's default remote font resolver: the one external fetch r3f-eda-canvas v0.1.4 makes. */
const TROIKA_FONT_RESOLVER = "https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@";

export function isTroikaFontResolver(url: string): boolean {
  return url.startsWith(TROIKA_FONT_RESOLVER);
}

export function isRemoteFontRequest(url: string): boolean {
  return isTroikaFontResolver(url) || /\.(?:woff2?|[ot]tf)$/i.test(new URL(url).pathname);
}

/** Off-host requests seen by the browser fixture: aborted, or let through while the re-pin is pending. */
export interface OffHostRequests { denied: string[]; tolerated: string[] }

export interface CanvasPackage {
  version: string;
  /** The package ships configureEdaText (bundled font, no remote fallback). */
  offlineText: boolean;
}

export function installedCanvasPackage(): CanvasPackage {
  const root = path.resolve("node_modules/@openpcb/r3f-eda-canvas");
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  return { version: manifest.version, offlineText: existsSync(path.join(root, "dist/text/runtime.js")) };
}

export function repinPending(pkg: CanvasPackage): string {
  return `@openpcb/r3f-eda-canvas ${pkg.version} has no offline text runtime: with remote fonts denied, `
    + "Troika's default font never resolves and the scene suspends (F01). Lift after the r3f-eda-canvas re-pin.";
}

interface CanvasPaint { pixels: number; painted: number }

/**
 * Pixels that differ from the dominant (background) colour. A suspended R3F
 * scene paints only its clear colour, so `painted` is 0 for the F01 failure.
 */
export async function canvasPaint(page: Page, canvas: Locator): Promise<CanvasPaint> {
  const png = await canvas.screenshot();
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const background = Math.max(...counts.values());
    const pixels = data.length / 4;
    return { pixels, painted: pixels - background };
  }, png.toString("base64"));
}

export async function expectCanvasGeometry(page: Page, canvas: Locator, what: string): Promise<void> {
  await expect.poll(async () => {
    const paint = await canvasPaint(page, canvas);
    return paint.painted / paint.pixels;
  }, { message: `${what} must paint geometry, not only its clear colour`, timeout: 20_000 }).toBeGreaterThan(0.001);
}
