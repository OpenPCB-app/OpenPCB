#!/usr/bin/env bun
// IPC-7351B pad-fingerprint tables (H15 §3.2) — the data behind generator
// availability and footprint classification.
//
//   bun scripts/gen-ipc-fingerprints.ts --legacy              # regenerate the legacy deny-list
//   bun scripts/gen-ipc-fingerprints.ts --legacy --check      # drift check (exit 1 on drift)
//   bun scripts/gen-ipc-fingerprints.ts --qualified           # append the installed revision blocks
//   bun scripts/gen-ipc-fingerprints.ts --qualified --check   # parity + disjointness check
//
// --legacy runs only while the installed rendering-core is 0.1.3, the ONE
// legacy IPC generator that ever shipped; afterwards the file is frozen and the
// check reports a skip. Run --qualified only AFTER the O6 DRC qualification
// (library-generator-qualification.test.ts) passes on the installed revision:
// it appends that evidence to an append-only table. Revoke a revision by
// deleting its block by hand.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import renderingPackage from "../node_modules/@openpcb/rendering-core/package.json";
import { padGeometryFingerprint } from "../src/modules/library/backend/qualification/pad-fingerprint";
import {
  installedIpcQualification,
  ipcFingerprintKey,
} from "../src/modules/library/shared/generator-qualification";
import {
  LEGACY_IPC_FINGERPRINT_PRESETS,
  LEGACY_IPC_GENERATOR,
  LEGACY_IPC_REMOVED,
} from "../src/modules/library/shared/legacy-ipc-fingerprints.generated";
import {
  QUALIFIED_IPC_FINGERPRINTS,
  type QualifiedIpcFingerprintTable,
} from "../src/modules/library/shared/qualified-ipc-fingerprints.generated";
import { buildFootprintRenderModel } from "../src/shared/rendering/footprint-preview-builder";
import {
  ALL_FAMILIES,
  generateFootprint,
  type DensityLevel,
  type PackageFamily,
} from "../src/shared/rendering/ipc7351b";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_FILE = path.join(
  ROOT,
  "src/modules/library/shared/legacy-ipc-fingerprints.generated.ts",
);
const QUALIFIED_FILE = path.join(
  ROOT,
  "src/modules/library/shared/qualified-ipc-fingerprints.generated.ts",
);
const LEGACY_VERSION = "0.1.3";
const DENSITIES: readonly DensityLevel[] = ["most", "nominal", "least"];

interface RemovedEntry {
  readonly fingerprint: string;
  readonly presets: readonly string[];
  readonly note: string;
}

type MutableTable = Record<string, Record<number, Record<string, string>>>;

function presetKey(family: string, size: string, density: DensityLevel): string {
  return `${family}|${size}|${density}`;
}

/** Every preset of the installed generator, both projections the library stores. */
function installedOutputs(): {
  family: PackageFamily;
  size: string;
  density: DensityLevel;
  source: string;
  preview: string;
}[] {
  const out = [];
  for (const family of ALL_FAMILIES) {
    for (const size of family.sizes) {
      for (const density of DENSITIES) {
        const { source } = generateFootprint(family.id, size.label, density);
        out.push({
          family: family.id,
          size: size.label,
          density,
          source: padGeometryFingerprint(source.pads),
          preview: padGeometryFingerprint(buildFootprintRenderModel(source).pads),
        });
      }
    }
  }
  return out;
}

/** fingerprint → where the accepted table holds it. */
function acceptedLocations(table: QualifiedIpcFingerprintTable): Map<string, string> {
  const out = new Map<string, string>();
  for (const family of Object.keys(table).sort()) {
    const revisions = table[family] ?? {};
    for (const revision of Object.keys(revisions).map(Number).sort((a, b) => a - b)) {
      const block = revisions[revision] ?? {};
      for (const key of Object.keys(block).sort()) {
        const fingerprint = block[key];
        if (fingerprint) out.set(fingerprint, `${family} revision ${revision} ${key}`);
      }
    }
  }
  return out;
}

/** Drop accepted fingerprints from the deny-list, recording why (§5: the legacy pads were correct). */
function subtractAccepted(
  entries: Map<string, string[]>,
  removed: RemovedEntry[],
  table: QualifiedIpcFingerprintTable,
): void {
  for (const [fingerprint, where] of acceptedLocations(table)) {
    const presets = entries.get(fingerprint);
    if (!presets) continue;
    entries.delete(fingerprint);
    const note = `accepted as ${where}`;
    removed.push({ fingerprint, presets, note });
    console.log(`legacy deny-list: removed ${fingerprint} (${presets.join(", ")}): ${note}`);
  }
  removed.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
}

function legacyEntriesFromInstalled(): { entries: Map<string, string[]>; combinations: number } {
  const entries = new Map<string, string[]>();
  const outputs = installedOutputs();
  for (const output of outputs) {
    const key = presetKey(output.family, output.size, output.density);
    for (const fingerprint of new Set([output.source, output.preview])) {
      const presets = entries.get(fingerprint) ?? [];
      if (!presets.includes(key)) presets.push(key);
      entries.set(fingerprint, presets);
    }
  }
  return { entries, combinations: outputs.length };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function emitLegacy(
  entries: Map<string, string[]>,
  removed: readonly RemovedEntry[],
  combinations: number,
): string {
  const rows = [...entries.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([fingerprint, presets]) =>
        `  ${quote(fingerprint)}: [${[...presets].sort().map(quote).join(", ")}],`,
    );
  const removedRows = removed.map(
    (entry) =>
      `  { fingerprint: ${quote(entry.fingerprint)}, presets: [${entry.presets.map(quote).join(", ")}], note: ${quote(entry.note)} },`,
  );
  return [
    `// GENERATED by scripts/gen-ipc-fingerprints.ts --legacy from @openpcb/rendering-core ${LEGACY_VERSION}. Do not edit.`,
    "// FROZEN: that generator (== the in-tree generator dda0d07…81c3ccd) is the only legacy IPC-7351B",
    "// generator that ever shipped, so this deny-list is complete and final.",
    "",
    "/** Identity of the generator this deny-list was produced from. */",
    "export const LEGACY_IPC_GENERATOR = {",
    '  package: "@openpcb/rendering-core",',
    `  version: ${quote(LEGACY_VERSION)},`,
    `  combinations: ${combinations},`,
    '  projections: ["source.pads", "buildFootprintRenderModel(source).pads"],',
    "} as const;",
    "",
    "/** fingerprint → presets (\"family|size|density\") that emit it: the label map for reasons. */",
    "export const LEGACY_IPC_FINGERPRINT_PRESETS: Readonly<Record<string, readonly string[]>> = {",
    ...rows,
    "};",
    "",
    "/** Every pad fingerprint the only legacy IPC generator (rendering-core v0.1.3 == in-tree dda0d07…81c3ccd)",
    " *  can emit: ALL_FAMILIES × sizes × densities, fingerprinted over BOTH source.pads and",
    " *  buildFootprintRenderModel(source).pads (deduplicated). Frozen; LEGACY_IPC_GENERATOR records the generator identity. */",
    "export const LEGACY_IPC_FINGERPRINTS: ReadonlySet<string> = new Set(",
    "  Object.keys(LEGACY_IPC_FINGERPRINT_PRESETS),",
    ");",
    "",
    "/** Fingerprints dropped because an accepted revision emits them: those legacy pads were already correct. */",
    "export const LEGACY_IPC_REMOVED: readonly {",
    "  readonly fingerprint: string;",
    "  readonly presets: readonly string[];",
    "  readonly note: string;",
    removedRows.length === 0 ? "}[] = [];" : "}[] = [",
    ...(removedRows.length === 0 ? [] : [...removedRows, "];"]),
    "",
  ].join("\n");
}

function emitQualified(table: QualifiedIpcFingerprintTable): string {
  const families = Object.keys(table).sort();
  const body: string[] = [];
  for (const family of families) {
    const revisions = table[family] ?? {};
    body.push(`  ${family}: {`);
    for (const revision of Object.keys(revisions).map(Number).sort((a, b) => a - b)) {
      const block = revisions[revision] ?? {};
      body.push(`    ${revision}: {`);
      for (const key of Object.keys(block).sort()) {
        body.push(`      ${quote(key)}: ${quote(block[key] ?? "")},`);
      }
      body.push("    },");
    }
    body.push("  },");
  }
  return [
    "// GENERATED by scripts/gen-ipc-fingerprints.ts --qualified. Append-only: never edit a block.",
    "// Revoke a revision by deleting its block; affected parts re-flag at read time (H15 §3.2).",
    "",
    "/** family → accepted revision → \"size|density\" → pad fingerprint. */",
    "export type QualifiedIpcFingerprintTable = Readonly<",
    "  Record<string, Readonly<Record<number, Readonly<Record<string, string>>>>>",
    ">;",
    "",
    "/**",
    " * family → accepted revision → \"size|density\" → fingerprint. Append-only; delete a revision block to revoke it.",
    " * Generated by scripts/gen-ipc-fingerprints.ts --qualified AFTER O6 passes on that revision.",
    " */",
    body.length === 0
      ? "export const QUALIFIED_IPC_FINGERPRINTS: QualifiedIpcFingerprintTable = {};"
      : "export const QUALIFIED_IPC_FINGERPRINTS: QualifiedIpcFingerprintTable = {",
    ...(body.length === 0 ? [] : [...body, "};"]),
    "",
  ].join("\n");
}

/** The installed generator's block for one family: "size|density" → preview fingerprint. */
function installedBlock(family: PackageFamily): Record<string, string> {
  const block: Record<string, string> = {};
  for (const output of installedOutputs()) {
    if (output.family === family) {
      block[ipcFingerprintKey(output.size, output.density)] = output.preview;
    }
  }
  return block;
}

function sameBlock(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a).sort();
  return (
    keys.join("\n") === Object.keys(b).sort().join("\n") &&
    keys.every((key) => a[key] === b[key])
  );
}

function fail(message: string): never {
  console.error(`gen-ipc-fingerprints: ${message}`);
  process.exit(1);
}

async function writeOrCheck(file: string, text: string, check: boolean): Promise<boolean> {
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current === text) return true;
  if (check) {
    console.error(`drift: ${path.relative(ROOT, file)} differs from the generator output`);
    return false;
  }
  await fs.writeFile(file, text);
  console.log(`wrote ${path.relative(ROOT, file)}`);
  return true;
}

async function runLegacy(check: boolean): Promise<void> {
  if (renderingPackage.version !== LEGACY_VERSION) {
    if (check) {
      console.log(
        `legacy deny-list is frozen (installed rendering-core ${renderingPackage.version}); check skipped`,
      );
      return;
    }
    fail(
      `--legacy needs the legacy generator ${LEGACY_VERSION}; installed is ${renderingPackage.version}. The table is frozen.`,
    );
  }
  const { entries, combinations } = legacyEntriesFromInstalled();
  const removed: RemovedEntry[] = [];
  subtractAccepted(entries, removed, QUALIFIED_IPC_FINGERPRINTS);
  const ok = await writeOrCheck(
    LEGACY_FILE,
    emitLegacy(entries, removed, combinations),
    check,
  );
  if (!ok) fail("run `bun scripts/gen-ipc-fingerprints.ts --legacy` and commit the result");
  console.log(
    `legacy deny-list: ${entries.size} fingerprints over ${combinations} presets${check ? " (up to date)" : ""}`,
  );
}

async function runQualified(check: boolean): Promise<void> {
  const installed = installedIpcQualification();
  const table: MutableTable = {};
  for (const [family, revisions] of Object.entries(QUALIFIED_IPC_FINGERPRINTS)) {
    table[family] = {};
    for (const [revision, block] of Object.entries(revisions)) {
      table[family]![Number(revision)] = { ...block };
    }
  }
  if (installed === null) {
    if (!check) fail("the installed rendering-core has no IPC7351B_QUALIFICATION manifest; nothing to qualify");
    console.log(`no qualification manifest in rendering-core ${renderingPackage.version}; parity check skipped`);
  } else {
    for (const family of ALL_FAMILIES) {
      const entry = installed[family.id];
      if (!entry?.qualified) continue;
      const block = installedBlock(family.id);
      const existing = table[family.id]?.[entry.revision];
      if (existing) {
        if (!sameBlock(existing, block)) {
          fail(
            `${family.id} revision ${entry.revision}: installed output differs from the accepted block. Accepted blocks are never edited; the generator must bump its revision.`,
          );
        }
      } else if (check) {
        console.log(`${family.id} revision ${entry.revision}: not accepted (family stays unavailable)`);
      } else {
        (table[family.id] ??= {})[entry.revision] = block;
        console.log(`${family.id} revision ${entry.revision}: accepted ${Object.keys(block).length} presets`);
      }
    }
  }

  const entries = new Map(
    Object.entries(LEGACY_IPC_FINGERPRINT_PRESETS).map(([fingerprint, presets]) => [
      fingerprint,
      [...presets],
    ]),
  );
  const removed: RemovedEntry[] = [...LEGACY_IPC_REMOVED];
  subtractAccepted(entries, removed, table);
  if (check && removed.length !== LEGACY_IPC_REMOVED.length) {
    fail("accepted and legacy fingerprint sets overlap; run --qualified to record the removal");
  }
  const qualifiedOk = await writeOrCheck(QUALIFIED_FILE, emitQualified(table), check);
  const legacyOk =
    removed.length === LEGACY_IPC_REMOVED.length ||
    (await writeOrCheck(
      LEGACY_FILE,
      // The frozen file's own count: the installed generator is no longer the legacy one.
      emitLegacy(entries, removed, LEGACY_IPC_GENERATOR.combinations),
      check,
    ));
  if (!qualifiedOk || !legacyOk) fail("fingerprint tables drifted");
}

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
if (args.has("--legacy") === args.has("--qualified")) {
  fail("pass exactly one of --legacy or --qualified (optionally with --check)");
}
if (args.has("--legacy")) await runLegacy(check);
else await runQualified(check);
