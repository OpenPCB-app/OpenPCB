import type {
  DensityLevel,
  PackageFamily,
} from "../../../shared/rendering/ipc7351b";
import { ipcFamilyAvailability } from "./generator-qualification";

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

/** Null when the family may be generated; otherwise the reason it is quarantined. */
export function generatorUnavailableReason(
  family: PackageFamily,
): string | null {
  const availability = ipcFamilyAvailability(family);
  return availability.available ? null : availability.reason;
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
