import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  bundledEdaTextConfiguration,
  configureBundledEdaText,
  disposeBundledEdaText,
  installBundledEdaText,
} from "./eda-text-config";

const fontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../core/frontend/public/fonts/eda");
const publicManifest = JSON.parse(readFileSync(path.join(fontDir, "manifest.json"), "utf8")) as {
  filename: string;
  sha256: string;
  coverage: number[][];
  replacement: string;
};

describe("bundled EDA text configuration", () => {
  it("targets the same-origin bundled font pinned by the shipped manifest", () => {
    const configuration = bundledEdaTextConfiguration("/");
    expect(configuration.fontUrl).toBe("/fonts/eda/NotoSans-Regular.ttf");
    expect(configuration.fontSha256).toBe(publicManifest.sha256);
    expect(configuration.coverage).toEqual(publicManifest.coverage);
    expect(configuration.replacement).toBe(publicManifest.replacement);
    expect(bundledEdaTextConfiguration("/app").fontUrl).toBe("/app/fonts/eda/NotoSans-Regular.ttf");
  });

  it("keeps the bundled manifest copy byte-identical to the shipped one", () => {
    expect(readFileSync(new URL("./eda-font-manifest.json", import.meta.url), "utf8"))
      .toBe(readFileSync(path.join(fontDir, "manifest.json"), "utf8"));
  });

  it("pins the exact bytes of the shipped font", () => {
    const bytes = readFileSync(path.join(fontDir, publicManifest.filename));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(publicManifest.sha256);
  });

  it("configures and disposes a canvas package that exposes the offline text runtime", () => {
    const canvas = { configureEdaText: vi.fn(), disposeEdaText: vi.fn() };
    expect(configureBundledEdaText(canvas)).toBe(true);
    expect(canvas.configureEdaText).toHaveBeenCalledWith(bundledEdaTextConfiguration());
    disposeBundledEdaText(canvas);
    expect(canvas.disposeEdaText).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a canvas package without the offline text runtime", () => {
    expect(configureBundledEdaText({ EDAText: () => null })).toBe(false);
    expect(() => disposeBundledEdaText({})).not.toThrow();
  });

  it("configures once however many canvas module entries install it", () => {
    const canvas = { configureEdaText: vi.fn(), disposeEdaText: vi.fn() };
    installBundledEdaText(canvas);
    installBundledEdaText(canvas);
    expect(canvas.configureEdaText).toHaveBeenCalledTimes(1);
    expect(canvas.disposeEdaText).not.toHaveBeenCalled();
  });

  it("is accepted by the installed canvas package when it has the offline text runtime", async () => {
    const canvas = await import("@openpcb/r3f-eda-canvas");
    // The installed package validates the coverage, replacement and SHA-256 pin.
    expect(configureBundledEdaText(canvas)).toBe("configureEdaText" in canvas);
    disposeBundledEdaText(canvas);
  });
});
