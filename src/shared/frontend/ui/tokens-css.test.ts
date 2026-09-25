import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import { FIELD_FOCUS, FOCUS_RING, FOCUS_RING_OUTSET } from "./focus";

/*
 * Compiles the real index.css with Tailwind and inspects the generated CSS —
 * the regressions here (T-007 invisible ring, T-016 4px `rounded`) were only
 * visible in generated output, not in class strings.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = path.resolve(here, "../../../core/frontend/src/index.css");
const require = createRequire(import.meta.url);

let build: (candidates: string[]) => string;

beforeAll(async () => {
  const css = readFileSync(indexCss, "utf8")
    .replace(/^@plugin .*$/gm, "")
    .replace(/^@source .*$/gm, "");
  const compiler = await compile(css, {
    base: path.dirname(indexCss),
    loadStylesheet: async (id, base) => {
      const file = require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id);
      return { path: file, base, content: readFileSync(file, "utf8") };
    },
  });
  build = (candidates) => compiler.build(candidates);
});

/** The generated rule block for one utility class (selector as Tailwind escapes it). */
function ruleFor(css: string, className: string): string {
  const selector = `.${className.replace(/[:/[\]().]/g, (c) => `\\${c}`)}`;
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${pattern} \\{[\\s\\S]*?\\n  \\}`));
  return match?.[0] ?? "";
}

describe("focus ring recipes (T-007)", () => {
  for (const [name, recipe] of [
    ["FOCUS_RING", FOCUS_RING],
    ["FOCUS_RING_OUTSET", FOCUS_RING_OUTSET],
  ] as const) {
    it(`${name} sets a solid outline style on :focus-visible`, () => {
      const classes = recipe.split(/\s+/);
      const css = build(classes);
      const solid = ruleFor(css, "focus-visible:outline-solid");
      expect(solid).toContain(":focus-visible");
      expect(solid).toContain("outline-style: solid");
      // outline-none alone would leave --tw-outline-style: none (the bug).
      expect(classes).toContain("focus-visible:outline-solid");
      expect(ruleFor(css, "focus-visible:outline-focus-ring")).toContain(
        "outline-color: var(--focus-ring)",
      );
    });
  }

  it("FIELD_FOCUS switches the border to the selection colour", () => {
    const css = build(FIELD_FOCUS.split(/\s+/));
    expect(ruleFor(css, "focus-visible:border-selection")).toContain(
      "border-color: var(--selection)",
    );
  });

  it("the base layer replaces the UA ring with the token ring", () => {
    const css = build([]);
    expect(css).toMatch(/@layer base \{[\s\S]*:focus-visible \{\s*outline: 1px solid var\(--focus-ring\)/);
  });
});

describe("tokens", () => {
  it("bare `rounded` resolves to the flat 2px radius (T-016)", () => {
    const css = build(["rounded"]);
    expect(ruleFor(css, "rounded")).toContain("border-radius: var(--radius)");
    expect(css).toMatch(/--radius: 2px;/);
  });

  it.each([
    ["bg-scrim", "background-color: var(--scrim)"],
    ["shadow-float", "--tw-shadow: var(--elevation-float)"],
    ["shadow-dialog", "--tw-shadow: var(--elevation-dialog)"],
    ["border-status-danger-border", "border-color: var(--status-danger-border)"],
    ["text-well-text", "color: var(--well-text)"],
    ["bg-well-surface", "background-color: var(--well-surface)"],
    ["bg-surface-schematic-canvas", "background-color: var(--surface-schematic-canvas)"],
    ["bg-canvas", "background-color: var(--surface-canvas-well)"],
    ["outline-focus-ring", "outline-color: var(--focus-ring)"],
  ])("%s compiles to its token", (candidate, declaration) => {
    expect(ruleFor(build([candidate]), candidate)).toContain(declaration);
  });

  it("every themed token added in F0a has a light and a dark value", () => {
    const source = readFileSync(indexCss, "utf8");
    const light = source.slice(source.indexOf(":root {"), source.indexOf("html.dark {"));
    const dark = source.slice(source.indexOf("html.dark {"));
    for (const token of [
      "--scrim",
      "--elevation-float",
      "--elevation-dialog",
      "--surface-schematic-canvas",
      "--status-danger-border",
      "--status-warning-border",
      "--status-success-border",
      "--status-info-border",
      "--status-neutral-border",
    ]) {
      expect(light, token).toContain(`${token}:`);
      expect(dark, token).toContain(`${token}:`);
    }
  });
});

type Rgb = [number, number, number];

function tokenValue(block: string, token: string): string {
  const value = block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`${token} missing`);
  return value.trim();
}

/** `#rrggbb` → rgb; `rgba(r, g, b, a)` → rgb + alpha. */
function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const n = Number.parseInt(hex, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const parts = value.match(/^rgba\(([^)]+)\)$/)?.[1]?.split(",").map(Number);
  if (!parts || parts.length !== 4) throw new Error(`unparsed colour ${value}`);
  return { rgb: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], alpha: parts[3] ?? 1 };
}

function contrast(a: Rgb, b: Rgb): number {
  const lum = (rgb: Rgb) => {
    const [r, g, bl] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("status text contrast (T-175)", () => {
  const source = readFileSync(indexCss, "utf8");
  const themes = {
    light: source.slice(source.indexOf(":root {"), source.indexOf("html.dark {")),
    dark: source.slice(source.indexOf("html.dark {")),
  };
  const surfaces = ["app", "rail", "panel", "raised", "input"];
  const tones = ["danger", "warning", "success", "info", "neutral"];

  for (const [theme, block] of Object.entries(themes)) {
    it(`${theme}: text-status-* on bg-status-*-soft is ≥ 4.5:1 over every chrome surface`, () => {
      for (const surface of surfaces) {
        const under = parseColor(tokenValue(block, `--surface-${surface}`)).rgb;
        for (const tone of tones) {
          const text = parseColor(tokenValue(block, `--status-${tone}`)).rgb;
          const soft = parseColor(tokenValue(block, `--status-${tone}-soft`));
          const tint = soft.rgb.map((c, i) => c * soft.alpha + (under[i] ?? 0) * (1 - soft.alpha)) as Rgb;
          expect(contrast(text, tint), `${tone} over ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it("well text stays ≥ 4.5:1 on the always-dark canvas well (T-284)", () => {
    const well = parseColor(tokenValue(themes.light, "--surface-canvas-well")).rgb;
    const wellSurface = parseColor(tokenValue(themes.light, "--well-surface")).rgb;
    for (const token of ["--well-text", "--well-text-muted"]) {
      const text = parseColor(tokenValue(themes.light, token)).rgb;
      expect(contrast(text, well), token).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, wellSurface), token).toBeGreaterThanOrEqual(4.5);
    }
  });
});
