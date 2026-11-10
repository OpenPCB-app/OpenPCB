/**
 * H13 OP9 grep guard (H13 §3.1.4, KF1 §4): KiCad board/schematic Y is converted at
 * ONE site. No designer KiCad-project import file may dereference a K-frame Y
 * (`.yMm`, or a bbox `.minYMm` / `.maxYMm`) outside `kicad-frame.ts`,
 * `frame-port.ts` or an allow-listed parser file.
 *
 * `PRE_H14_CALL_SITES` is a ratchet, not an exemption: the importer files H13 may
 * not edit still convert verbatim until H14 S3/S6/S10 route them through
 * `frame-port.ts`. Each entry must still exist and still dereference, so the list
 * can only shrink.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const IMPORT_DIR = path.resolve(
  import.meta.dir,
  "../../../modules/designer/backend/import/kicad-project",
);
const FRAME_FILES = new Set(["kicad-frame.ts", "frame-port.ts"]);
/** Files that read KiCad source units on purpose (H14 census). None yet. */
const PARSER_FILES = new Set<string>([]);
const PRE_H14_CALL_SITES = new Map<string, string>([
  ["commit.ts", "H14 S6/S10 (outline bbox + polygon)"],
  ["insert-pcb.ts", "H14 S6 (placements, tracks, vias, zones, keepouts)"],
  ["insert-schematic.ts", "H14 S3 (symbols, pins, labels, wires)"],
]);
const K_FRAME_Y = /\.(?:y|minY|maxY)Mm\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Comments may cite `.yMm`; code may not. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("KiCad frame boundary (exactly-once rule)", () => {
  const files = sourceFiles(IMPORT_DIR);
  const rel = (f: string) => path.relative(IMPORT_DIR, f);

  test("the frame helper exists and is the scanned tree's conversion site", () => {
    expect(files.map(rel)).toContain("kicad-frame.ts");
    expect(K_FRAME_Y.test(code(path.join(IMPORT_DIR, "kicad-frame.ts")))).toBe(true);
  });

  test("no other import file dereferences a KiCad Y", () => {
    const offenders = files
      .map(rel)
      .filter((f) => !FRAME_FILES.has(f) && !PARSER_FILES.has(f) && !PRE_H14_CALL_SITES.has(f))
      .filter((f) => K_FRAME_Y.test(code(path.join(IMPORT_DIR, f))));
    expect(offenders).toEqual([]);
  });

  test("the pre-H14 allow-list only shrinks", () => {
    for (const [file, owner] of PRE_H14_CALL_SITES) {
      const full = path.join(IMPORT_DIR, file);
      const stale = !files.includes(full) || !K_FRAME_Y.test(code(full));
      expect({ file, owner, stale }).toEqual({ file, owner, stale: false });
    }
  });
});
