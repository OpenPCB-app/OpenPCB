/**
 * Footprint generator qualification (H15 §3.4), derived at read time from the
 * pads actually stored (library row) or placed (snapshot). Rules 1–2 are
 * purely geometric, so no claim — `sourceKind`, a generation stamp, a forged
 * `ipcRevision` — can make legacy or arbitrary geometry qualify. The stamp or
 * row provenance only selects the claim rules 3–5.
 *
 * Pure apart from the template-verdict LRU.
 */
import type {
  FootprintGenerationStamp,
  LibraryFootprintQualification,
} from "../../../../sdks/library";
import {
  ALL_FAMILIES,
  type PackageFamily,
} from "../../../../shared/rendering/ipc7351b";
import type { FootprintRenderSourcePad } from "../../../../shared/rendering/types";
import {
  ipcFamilyAvailability,
  type InstalledIpcQualification,
} from "../../shared/generator-qualification";
import { LEGACY_IPC_FINGERPRINT_PRESETS } from "../../shared/legacy-ipc-fingerprints.generated";
import {
  QUALIFIED_IPC_FINGERPRINTS,
  type QualifiedIpcFingerprintTable,
} from "../../shared/qualified-ipc-fingerprints.generated";
import {
  describeGeneratedGeometryDefects,
  generatedGeometryDefects,
} from "../import/generated-geometry";
import { padGeometryFingerprint } from "./pad-fingerprint";

/**
 * Test seam: `accepted` overrides the accepted-fingerprint table, `installed`
 * the installed rendering-core manifest (null = none). Production passes
 * nothing.
 */
export interface QualificationInputs {
  readonly accepted?: QualifiedIpcFingerprintTable;
  readonly installed?: InstalledIpcQualification | null;
}

export const NOT_GENERATED: LibraryFootprintQualification = Object.freeze({
  status: "not-generated",
  reason: null,
  generatorKind: null,
  generatorLabel: null,
});

const TEMPLATE_REMEDY = "Regenerate it with non-overlapping parameters.";
const LEGACY_GENERATED_REASON =
  "Generated before generator provenance was recorded; its geometry cannot be verified.";
export const NO_LONGER_MATCHES_REASON =
  "The placed footprint no longer matches its generated library footprint and cannot be verified. Update the part from the Library.";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function presetLabel(size: string, density: string): string {
  return `${size} · ${density}`;
}

function familyLabel(family: PackageFamily): string {
  return ALL_FAMILIES.find((def) => def.id === family)?.label ?? family;
}

function familyOf(id: string): PackageFamily | null {
  return ALL_FAMILIES.find((def) => def.id === id)?.id ?? null;
}

/** The family whose presets include this size label (labels are family-unique). */
function familyOfSize(size: string): PackageFamily | null {
  return (
    ALL_FAMILIES.find((def) => def.sizes.some((s) => s.label === size))?.id ??
    null
  );
}

function familyAvailable(
  family: PackageFamily,
  inputs: QualificationInputs,
): boolean {
  return ipcFamilyAvailability(family, inputs.installed, inputs.accepted)
    .available;
}

const REPLACE_WITH_IPC =
  "Replace it in the Library (Change footprint → IPC package), then update the part.";

/** Pin-aware remedy for an IPC-generated footprint (review finding 23). */
function ipcRemedy(
  family: PackageFamily | null,
  inputs: QualificationInputs,
): string {
  if (family === null) {
    return "No qualified IPC generator for this package is installed yet; replace it with a drawn or verified footprint.";
  }
  return familyAvailable(family, inputs)
    ? REPLACE_WITH_IPC
    : `No qualified generator for ${familyLabel(family)} is installed yet; replace it with a drawn or verified footprint.`;
}

/** A generator with unknown family (legacy-generated): the remedy cannot name one. */
function genericRemedy(inputs: QualificationInputs): string {
  return ALL_FAMILIES.some((def) => familyAvailable(def.id, inputs))
    ? "Replace it in the Library (Change footprint → IPC package, or a drawn or verified footprint), then update the part."
    : "No qualified IPC generator is installed yet; replace it with a drawn or verified footprint.";
}

function unqualified(
  generatorKind: LibraryFootprintQualification["generatorKind"],
  generatorLabel: string | null,
  reason: string,
): LibraryFootprintQualification {
  return {
    status: "unqualified-generator",
    reason,
    generatorKind,
    generatorLabel,
  };
}

interface AcceptedEntry {
  readonly label: string;
}

// fingerprint → accepted preset, per table object (tests inject their own).
const acceptedIndexes = new WeakMap<
  QualifiedIpcFingerprintTable,
  ReadonlyMap<string, AcceptedEntry>
>();

function acceptedIndex(
  table: QualifiedIpcFingerprintTable,
): ReadonlyMap<string, AcceptedEntry> {
  const cached = acceptedIndexes.get(table);
  if (cached) return cached;
  const index = new Map<string, AcceptedEntry>();
  for (const revisions of Object.values(table)) {
    for (const block of Object.values(revisions ?? {})) {
      for (const [key, fingerprint] of Object.entries(block ?? {})) {
        const [size = key, density = ""] = key.split("|");
        index.set(fingerprint, {
          label: density ? presetLabel(size, density) : size,
        });
      }
    }
  }
  acceptedIndexes.set(table, index);
  return index;
}

/** Rules 1–2: the verdict geometry alone decides, or null when neither table knows `fp`. */
export function geometricQualification(
  fingerprint: string | null,
  inputs: QualificationInputs = {},
): LibraryFootprintQualification | null {
  if (fingerprint === null) return null;
  const accepted = acceptedIndex(inputs.accepted ?? QUALIFIED_IPC_FINGERPRINTS);
  const hit = accepted.get(fingerprint);
  if (hit) {
    return {
      status: "qualified",
      reason: null,
      generatorKind: "ipc7351b",
      generatorLabel: hit.label,
    };
  }
  if (!Object.hasOwn(LEGACY_IPC_FINGERPRINT_PRESETS, fingerprint)) return null;
  const preset = LEGACY_IPC_FINGERPRINT_PRESETS[fingerprint]?.[0] ?? "";
  const [familyId = "", size = "", density = ""] = preset.split("|");
  const family = familyOf(familyId);
  const label = size ? presetLabel(size, density) : null;
  const what = family ? `${familyLabel(family)} ` : "";
  return unqualified(
    "ipc7351b",
    label,
    `Its pads match the legacy IPC-7351B ${what}generator output${label ? ` for ${label}` : ""}, which failed land-pattern qualification. ${ipcRemedy(family, inputs)}`,
  );
}

function finite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Enough structure for the geometry kernel not to read garbage. */
function readablePads(
  pads: readonly unknown[],
): pads is readonly FootprintRenderSourcePad[] {
  return pads.every((pad) => {
    const p = record(pad);
    const center = record(p?.centerMm);
    return (
      p !== null &&
      center !== null &&
      finite(center.x) &&
      finite(center.y) &&
      typeof p.number === "string" &&
      typeof p.shape === "string" &&
      finite(p.widthMm) &&
      finite(p.heightMm) &&
      (p.rotationDeg === undefined || finite(p.rotationDeg))
    );
  });
}

const UNREADABLE = "its pads cannot be read";
const TEMPLATE_CACHE_LIMIT = 1024;
// fingerprint → defect sentence ("" = clean), for readable pads only: there
// the key covers exactly the pad fields the geometry check reads. LRU by Map
// insertion order.
const templateVerdicts = new Map<string, string>();

function templateDefects(
  pads: readonly unknown[] | null,
  fingerprint: string | null,
): string {
  if (pads === null || pads.length === 0 || !readablePads(pads)) {
    return UNREADABLE;
  }
  if (fingerprint !== null) {
    const cached = templateVerdicts.get(fingerprint);
    if (cached !== undefined) {
      templateVerdicts.delete(fingerprint);
      templateVerdicts.set(fingerprint, cached);
      return cached;
    }
  }
  let verdict: string;
  try {
    const defects = generatedGeometryDefects(pads);
    verdict = defects.length ? describeGeneratedGeometryDefects(defects) : "";
  } catch {
    return UNREADABLE;
  }
  if (fingerprint !== null) {
    templateVerdicts.set(fingerprint, verdict);
    if (templateVerdicts.size > TEMPLATE_CACHE_LIMIT) {
      const oldest = templateVerdicts.keys().next().value;
      if (oldest !== undefined) templateVerdicts.delete(oldest);
    }
  }
  return verdict;
}

/** Rules 3–5: the claim selects the check once geometry alone did not decide. */
function claimQualification(
  pads: readonly unknown[] | null,
  fingerprint: string | null,
  generation: FootprintGenerationStamp | null,
  inputs: QualificationInputs,
): LibraryFootprintQualification {
  switch (generation?.kind) {
    case "ipc7351b": {
      const size = generation.label?.split(" · ")[0] ?? "";
      return unqualified(
        "ipc7351b",
        generation.label,
        `Generated by an IPC preset revision that has not passed qualification. ${ipcRemedy(familyOfSize(size), inputs)}`,
      );
    }
    case "template": {
      const defects = templateDefects(pads, fingerprint);
      if (defects === "") {
        return {
          status: "qualified",
          reason: null,
          generatorKind: "template",
          generatorLabel: generation.label,
        };
      }
      return unqualified(
        "template",
        generation.label,
        `Its template output is not manufacturable: ${defects}. ${TEMPLATE_REMEDY}`,
      );
    }
    case "legacy-generated":
      return unqualified(
        "legacy-generated",
        generation.label,
        `${LEGACY_GENERATED_REASON} ${genericRemedy(inputs)}`,
      );
    default:
      return NOT_GENERATED;
  }
}

export function fingerprintPads(
  pads: readonly unknown[] | null,
): string | null {
  return pads === null ? null : padGeometryFingerprint(pads);
}

/** Rules 1–6 (H15 §3.4) on one footprint. Exported for H13's intake qualifier. */
export function classifyFootprintGeometry(
  input: {
    pads: readonly unknown[] | null; // preview pads actually placed / stored
    generation: FootprintGenerationStamp | null; // from snapshot stamp or row provenance
  },
  inputs: QualificationInputs = {},
  fingerprint: string | null = fingerprintPads(input.pads),
): LibraryFootprintQualification {
  return (
    geometricQualification(fingerprint, inputs) ??
    claimQualification(input.pads, fingerprint, input.generation, inputs)
  );
}

/**
 * The generation a row's provenance claims: `sourceKind: "generated"` with an
 * IPC tuple ⇒ ipc7351b, with a template identity ⇒ template, with neither ⇒
 * legacy-generated (pre-`d11ce92`); anything else ⇒ null.
 */
export function generationFromProvenance(
  provenance: unknown,
): FootprintGenerationStamp | null {
  const prov = record(provenance);
  if (prov?.sourceKind !== "generated") return null;
  const generator = record(prov.generator);
  if (
    generator?.kind === "ipc7351b" &&
    typeof generator.family === "string" &&
    typeof generator.size === "string" &&
    typeof generator.density === "string"
  ) {
    return {
      kind: "ipc7351b",
      label: presetLabel(generator.size, generator.density),
    };
  }
  if (
    generator?.kind === "template" &&
    typeof generator.templateId === "string"
  ) {
    return { kind: "template", label: generator.templateId };
  }
  return { kind: "legacy-generated", label: null };
}
