import type {
  DensityLevel,
  PackageFamily,
} from "../../../shared/rendering/ipc7351b";

export interface IpcGeneratorIdentity {
  kind: "ipc7351b";
  family: PackageFamily;
  size: string;
  density: DensityLevel;
}

export interface TemplateGeneratorIdentity {
  kind: "template";
  templateId: string;
  params: Record<string, unknown>;
}

export type FootprintGeneratorIdentity =
  | IpcGeneratorIdentity
  | TemplateGeneratorIdentity;

export function generatorUnavailableReason(
  family: PackageFamily,
): string | null {
  if (family === "sot") {
    return "SOT presets are unavailable because generated pad counts and tab layouts are incorrect. Import a verified footprint or draw one instead.";
  }
  if (family === "qfn") {
    return "QFN presets are unavailable because the exposed pad overlaps signal pads. Import a verified footprint or draw one instead.";
  }
  return null;
}

export function sameGeneratorIdentity(
  actual: IpcGeneratorIdentity,
  expected: IpcGeneratorIdentity,
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.family === expected.family &&
    actual.size === expected.size &&
    actual.density === expected.density
  );
}
