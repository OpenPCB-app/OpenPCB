import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Design-system ratchet (UI QA wave F0a). Counts off-system patterns per
 * in-scope frontend file and fails when any file's count for any rule grows
 * past ui-discipline.baseline.json. Lines tagged `/* domain-color *\/` are
 * exempt (PCB layer / net / pin / 3D colours).
 *
 * Lower the baseline after a migration (never raises an entry):
 *   UI_DISCIPLINE_UPDATE=lower npx vitest run --config src/core/frontend/vitest.config.ts src/core/frontend/src/ui-discipline.test.ts
 * Rewrite it from scratch (raises too — orchestrator only):
 *   UI_DISCIPLINE_UPDATE=reset …same command…
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const baselinePath = path.join(here, "ui-discipline.baseline.json");

type Rule =
  | "palette"
  | "whiteBlack"
  | "hexArbitrary"
  | "nativeDialog"
  | "nativeSelect"
  | "tinyText"
  | "backdropBlur"
  | "heavyShadow";

type Counts = Partial<Record<Rule, number>>;
type Report = Record<string, Counts>;

const PALETTE =
  /(?<![\w-])(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|fill|stroke|from|to|via|outline|placeholder|shadow|decoration|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const WHITE_BLACK = /(?<![\w-])(?:bg|text|border)-(?:white|black)(?![\w-])/g;
const HEX_ARBITRARY = /-\[#[0-9a-fA-F]{3,8}\b/g;
// Bare calls need "(" right after the name so prose like "on confirm (…)" is ignored.
const NATIVE_DIALOG =
  /\bwindow\.(?:prompt|confirm|alert)\s*\(|(?<![\w.$])(?:prompt|confirm|alert)\(/g;
const NATIVE_SELECT = /<select\b/g;
const TINY_TEXT = /(?<![\w-])text-\[(\d*\.?\d+)(px|rem)\]/g;
const BACKDROP_BLUR = /backdrop-blur/g;
const HEAVY_SHADOW = /(?<![\w-])shadow-(?:md|lg|xl|2xl)(?![\w-])/g;
const DOMAIN_COLOR_TAG = /\/\*\s*domain-color\s*\*\/|\/\/\s*domain-color\b/;

const KIT_DIR = "src/shared/frontend/ui/";

function scanRoots(): string[] {
  const modules = path.join(repoRoot, "src/modules");
  const moduleFrontends = readdirSync(modules)
    .map((name) => path.join(modules, name, "frontend"))
    .filter((dir) => existsSync(dir));
  return [
    path.join(repoRoot, "src/core/frontend/src"),
    path.join(repoRoot, "src/shared/frontend"),
    ...moduleFrontends,
  ];
}

function isInScope(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file) || file.endsWith(".d.ts")) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(file)) return false;
  return !/[\\/](generated|node_modules|dist)[\\/]/.test(file);
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && name !== "generated" && name !== "dist") walk(full, out);
    } else if (isInScope(full)) {
      out.push(full);
    }
  }
}

function countTinyText(line: string): number {
  let count = 0;
  for (const match of line.matchAll(TINY_TEXT)) {
    const size = Number(match[1]);
    if ((match[2] === "px" && size < 10) || (match[2] === "rem" && size < 0.625)) count += 1;
  }
  return count;
}

function countLine(line: string, inKit: boolean): Counts {
  const count = (pattern: RegExp) => line.match(pattern)?.length ?? 0;
  return {
    palette: count(PALETTE),
    whiteBlack: count(WHITE_BLACK),
    hexArbitrary: count(HEX_ARBITRARY),
    nativeDialog: count(NATIVE_DIALOG),
    nativeSelect: inKit ? 0 : count(NATIVE_SELECT),
    tinyText: countTinyText(line),
    backdropBlur: count(BACKDROP_BLUR),
    heavyShadow: count(HEAVY_SHADOW),
  };
}

function scanFile(relative: string, source: string): Counts {
  const totals: Counts = {};
  const inKit = relative.startsWith(KIT_DIR);
  for (const line of source.split("\n")) {
    if (DOMAIN_COLOR_TAG.test(line)) continue;
    for (const [rule, n] of Object.entries(countLine(line, inKit)) as [Rule, number][]) {
      if (n > 0) totals[rule] = (totals[rule] ?? 0) + n;
    }
  }
  return totals;
}

function scan(): Report {
  const files: string[] = [];
  for (const root of scanRoots()) walk(root, files);
  const report: Report = {};
  for (const file of files.sort()) {
    const relative = path.relative(repoRoot, file).split(path.sep).join("/");
    const counts = scanFile(relative, readFileSync(file, "utf8"));
    if (Object.keys(counts).length > 0) report[relative] = counts;
  }
  return report;
}

function readBaseline(): Report {
  if (!existsSync(baselinePath)) return {};
  return (JSON.parse(readFileSync(baselinePath, "utf8")) as { files: Report }).files;
}

function lowered(current: Report, baseline: Report): Report {
  const next: Report = {};
  for (const [file, counts] of Object.entries(baseline)) {
    const kept: Counts = {};
    for (const [rule, allowed] of Object.entries(counts) as [Rule, number][]) {
      const now = Math.min(allowed, current[file]?.[rule] ?? 0);
      if (now > 0) kept[rule] = now;
    }
    if (Object.keys(kept).length > 0) next[file] = kept;
  }
  return next;
}

function writeBaseline(files: Report): void {
  const body = { version: 1, generatedBy: "ui-discipline.test.ts", files };
  writeFileSync(baselinePath, `${JSON.stringify(body, null, 2)}\n`);
}

function regressions(current: Report, baseline: Report): string[] {
  const problems: string[] = [];
  for (const [file, counts] of Object.entries(current)) {
    for (const [rule, n] of Object.entries(counts) as [Rule, number][]) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (n > allowed) problems.push(`${file}: ${rule} ${n} > baseline ${allowed}`);
    }
  }
  return problems;
}

describe("ui discipline ratchet", () => {
  it("no in-scope file adds off-system UI patterns", () => {
    const current = scan();
    const mode = process.env.UI_DISCIPLINE_UPDATE;
    if (mode === "reset") writeBaseline(current);
    else if (mode === "lower" || mode === "1") writeBaseline(lowered(current, readBaseline()));
    const problems = regressions(current, readBaseline());
    expect(
      problems,
      "Use semantic tokens / kit primitives (docs/design/design-tokens.md), or tag true domain colours with /* domain-color */.",
    ).toEqual([]);
  });

  it("counts the patterns it claims to", () => {
    const sample = [
      'className="bg-slate-100 dark:hover:border-t-violet-700 text-red-600/50"',
      'className="bg-white text-black/60 border-[#123456] bg-black/40"',
      "if (window.confirm('x')) prompt('y'); onConfirm(); obj.confirm(1); confirmDialog(z) // on confirm (ok)",
      '<select value={v}> text-[9px] text-[10px] text-[0.5rem] backdrop-blur-sm shadow-lg shadow-float',
      'style={{ color: "#ff0000" }} className="bg-[#101010]" /* domain-color */',
    ].join("\n");
    expect(scanFile("src/modules/x/frontend/a.tsx", sample)).toEqual({
      palette: 3,
      whiteBlack: 3,
      hexArbitrary: 1,
      nativeDialog: 2,
      nativeSelect: 1,
      tinyText: 2,
      backdropBlur: 1,
      heavyShadow: 1,
    });
    expect(scanFile(`${KIT_DIR}select.tsx`, "<select")).toEqual({});
  });

  it("lower mode never raises an entry and new files start at zero", () => {
    const baseline: Report = { "a.tsx": { palette: 3, nativeSelect: 1 } };
    const current: Report = { "a.tsx": { palette: 5 }, "b.tsx": { palette: 1 } };
    expect(lowered(current, baseline)).toEqual({ "a.tsx": { palette: 3 } });
    expect(regressions(current, baseline)).toEqual([
      "a.tsx: palette 5 > baseline 3",
      "b.tsx: palette 1 > baseline 0",
    ]);
  });
});
