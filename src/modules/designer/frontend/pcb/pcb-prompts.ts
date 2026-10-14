import { promptDialog } from "@shared/frontend/ui/dialog-host-store";

const POSITIVE_MM_ERROR = "Enter a number greater than 0 (mm).";

/** Strictly positive, finite millimetre value; null for anything else. */
export function parsePositiveMm(value: string): number | null {
  if (value.trim() === "") return null;
  const mm = Number(value);
  return Number.isFinite(mm) && mm > 0 ? mm : null;
}

/** Kit replacement for the native numeric prompt (Electron has no window.prompt). */
export async function promptPositiveMm(
  title: string,
  label: string,
  currentMm: number,
): Promise<number | null> {
  const input = await promptDialog({
    title,
    label,
    defaultValue: currentMm.toString(),
    inputMode: "decimal",
    confirmLabel: "Apply",
    validate: (value) =>
      parsePositiveMm(value) === null ? POSITIVE_MM_ERROR : null,
  });
  return input === null ? null : parsePositiveMm(input);
}

/** Overlay text label prompt; null when cancelled. */
export function promptOverlayText(): Promise<string | null> {
  return promptDialog({
    title: "Add overlay text",
    label: "Text",
    confirmLabel: "Add",
    validate: (value) => (value.trim() === "" ? "Enter some text." : null),
  });
}
