export interface PreviewTheme {
  symbolStroke: string;
  symbolFill: string;
  symbolPinDot: string;
  symbolPinLine: string;
  symbolPinLabel: string;
  symbolPinNumber: string;
  symbolRefLabel: string;
  symbolValueLabel: string;
  footprintPad: string;
  footprintPadNumber: string;
  footprintSilk: string;
  footprintFab: string;
  footprintDrill: string;
}

export const DEFAULT_PREVIEW_THEME: PreviewTheme = {
  symbolStroke: "#94a3b8",
  symbolFill: "#1e293b",
  symbolPinDot: "#38bdf8",
  symbolPinLine: "#e2e8f0",
  symbolPinLabel: "#e2e8f0",
  symbolPinNumber: "#94a3b8",
  symbolRefLabel: "#e0af68",
  symbolValueLabel: "#cbd5e1",
  footprintPad: "#c9a227",
  footprintPadNumber: "#0f172a",
  footprintSilk: "#cbd5e1",
  footprintFab: "#64748b",
  footprintDrill: "#0f172a",
};
