import { DoubleSide, MeshLambertMaterial } from "three";

const BODY_BY_CATEGORY: Record<string, string> = {
  ic: "#4b5563",
  resistor: "#d4b483",
  "cap-elect": "#4080ff",
  "cap-cer": "#c8c8c8",
};
const IC_EMISSIVE = "#1f2937";
const METAL_EMISSIVE = "#332600";

const GOLD_MATERIAL_TAGS = new Set([
  "pad",
  "pads",
  "lead",
  "leads",
  "pin",
  "pins",
  "terminal",
]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function resolveBodyColor(mountType: string | null, tags: string[]): string {
  const candidates = [mountType, ...tags].filter((value): value is string =>
    Boolean(value),
  );

  for (const rawCandidate of candidates) {
    const candidate = normalize(rawCandidate);
    if (candidate in BODY_BY_CATEGORY) {
      return BODY_BY_CATEGORY[candidate]!;
    }

    if (candidate.includes("resistor") || candidate === "r") {
      return BODY_BY_CATEGORY.resistor!;
    }
    if (candidate.includes("electrolytic") || candidate.includes("cap-elect")) {
      return BODY_BY_CATEGORY["cap-elect"]!;
    }
    if (
      candidate.includes("capacitor") ||
      candidate.includes("cap-cer") ||
      candidate === "c"
    ) {
      return BODY_BY_CATEGORY["cap-cer"]!;
    }
    if (
      candidate.includes("ic") ||
      candidate.includes("qfn") ||
      candidate.includes("soic")
    ) {
      return BODY_BY_CATEGORY.ic!;
    }
  }

  return BODY_BY_CATEGORY.ic!;
}

export function getCategoryMaterial(
  mountType: string | null,
  tags: string[],
): MeshLambertMaterial {
  const normalizedTags = tags.map(normalize);
  const isMetal = normalizedTags.some((tag) => GOLD_MATERIAL_TAGS.has(tag));
  const color = isMetal ? "#d4af37" : resolveBodyColor(mountType, tags);

  return new MeshLambertMaterial({
    color,
    emissive: isMetal ? METAL_EMISSIVE : IC_EMISSIVE,
    emissiveIntensity: isMetal ? 0.1 : 0.28,
    // DoubleSide: B.Cu / mirrored placements apply scale [-1,1,1] which flips
    // winding-order parity; without DoubleSide the body's outward faces become
    // back-faces and get culled, producing see-through bodies in 3D view.
    side: DoubleSide,
  });
}
