/**
 * IPC-7351B generator availability (H15 §3.2). A family is offered only when
 * the installed rendering-core declares it qualified AND OpenPCB has accepted
 * that exact revision's output (`QUALIFIED_IPC_FINGERPRINTS`). The upstream
 * manifest is a self-check; acceptance is OpenPCB's own, after its DRC
 * qualification, which is why the table lives here and not in the package.
 *
 * Plain data + pure functions: imported by the frontend picker and the server
 * resolver alike, so it must stay free of node-only modules.
 */
import * as ipcNamespace from "../../../shared/rendering/ipc7351b";
import {
  ALL_FAMILIES,
  type DensityLevel,
  type PackageFamily,
} from "../../../shared/rendering/ipc7351b";
import {
  QUALIFIED_IPC_FINGERPRINTS,
  type QualifiedIpcFingerprintTable,
} from "./qualified-ipc-fingerprints.generated";

/** The rendering-core export this module feature-detects (absent ≤ v0.1.3). */
const MANIFEST_EXPORT = "IPC7351B_QUALIFICATION";

const REMEDY = "Import a verified footprint or draw one instead.";

/**
 * Why each family of the only legacy generator (rendering-core ≤ v0.1.3, no
 * manifest) is quarantined. The SOT and QFN strings predate H15 and are kept
 * verbatim.
 */
const LEGACY_REASONS: Readonly<Record<PackageFamily, string>> = {
  chip: `Chip presets are unavailable because the installed generator places the lands outside the component terminals. ${REMEDY}`,
  sot: `SOT presets are unavailable because generated pad counts and tab layouts are incorrect. ${REMEDY}`,
  soic: `SOIC presets are unavailable because the installed generator measures the lead span tip-to-tip as pad centres. ${REMEDY}`,
  qfp: `QFP presets are unavailable because the installed generator's body sizes and lead spans are not taken from package drawings. ${REMEDY}`,
  qfn: `QFN presets are unavailable because the exposed pad overlaps signal pads. ${REMEDY}`,
};

export interface InstalledIpcFamily {
  readonly revision: number;
  readonly qualified: boolean;
}

export type InstalledIpcQualification = Readonly<
  Partial<Record<PackageFamily, InstalledIpcFamily>>
>;

export type IpcFamilyAvailability =
  | { readonly available: true; readonly revision: number }
  | { readonly available: false; readonly reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Feature-detects IPC7351B_QUALIFICATION through the namespace; null on ≤ v0.1.3 or malformed shape.
 *
 * `source` is the module namespace to inspect (tests pass a synthetic one).
 * The namespace is passed as a value so bundlers keep the whole object rather
 * than resolving a missing named export statically. Any malformed family entry
 * voids the whole manifest: fail closed, never partially.
 */
export function installedIpcQualification(
  source: unknown = ipcNamespace,
): InstalledIpcQualification | null {
  const manifest = record(record(source)?.[MANIFEST_EXPORT]);
  if (!manifest) return null;
  const out: Partial<Record<PackageFamily, InstalledIpcFamily>> = {};
  for (const family of ALL_FAMILIES) {
    if (!Object.hasOwn(manifest, family.id)) continue;
    const entry = record(manifest[family.id]);
    const revision = entry?.revision;
    if (
      !entry ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      typeof entry.qualified !== "boolean"
    ) {
      return null;
    }
    out[family.id] = { revision, qualified: entry.qualified };
  }
  return out;
}

// The installed package cannot change at runtime; read its manifest once.
let installedDefault: InstalledIpcQualification | null | undefined;

function installedDefaultQualification(): InstalledIpcQualification | null {
  if (installedDefault === undefined) {
    installedDefault = installedIpcQualification();
  }
  return installedDefault;
}

function familyLabel(family: PackageFamily): string {
  return ALL_FAMILIES.find((def) => def.id === family)?.label ?? family;
}

/** Key of one preset inside an accepted revision block. */
export function ipcFingerprintKey(size: string, density: DensityLevel): string {
  return `${size}|${density}`;
}

/** The accepted fingerprint for one preset of one revision, or null. */
export function acceptedIpcFingerprint(
  family: PackageFamily,
  revision: number,
  size: string,
  density: DensityLevel,
  accepted: QualifiedIpcFingerprintTable = QUALIFIED_IPC_FINGERPRINTS,
): string | null {
  const block = Object.hasOwn(accepted, family)
    ? accepted[family]?.[revision]
    : undefined;
  const key = ipcFingerprintKey(size, density);
  return block && Object.hasOwn(block, key) ? (block[key] ?? null) : null;
}

/**
 * available ⇔ manifest present ∧ entry.qualified ∧ QUALIFIED_IPC_FINGERPRINTS[family][entry.revision] exists.
 *
 * `installed` undefined reads the installed package; `null` means "no
 * manifest". `accepted` is injectable for tests only.
 */
export function ipcFamilyAvailability(
  family: PackageFamily,
  installed: InstalledIpcQualification | null = installedDefaultQualification(),
  accepted: QualifiedIpcFingerprintTable = QUALIFIED_IPC_FINGERPRINTS,
): IpcFamilyAvailability {
  if (installed === null) {
    return { available: false, reason: LEGACY_REASONS[family] };
  }
  const label = familyLabel(family);
  const entry = installed[family];
  if (!entry) {
    return {
      available: false,
      reason: `${label} presets are unavailable because the installed generator declares no qualification for them. ${REMEDY}`,
    };
  }
  if (!entry.qualified) {
    return {
      available: false,
      reason: `${label} presets from generator revision ${entry.revision} are not marked qualified by the installed generator. ${REMEDY}`,
    };
  }
  const block = Object.hasOwn(accepted, family)
    ? accepted[family]?.[entry.revision]
    : undefined;
  if (!block) {
    return {
      available: false,
      reason: `${label} presets from generator revision ${entry.revision} have not passed OpenPCB's land-pattern qualification. ${REMEDY}`,
    };
  }
  return { available: true, revision: entry.revision };
}
