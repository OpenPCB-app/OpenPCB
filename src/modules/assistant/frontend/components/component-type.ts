import {
  Box,
  Cpu,
  Lightbulb,
  Plug,
  RectangleHorizontal,
  Triangle,
  type LucideIcon,
} from "lucide-react";

export type ComponentTypeKey =
  | "led"
  | "resistor"
  | "capacitor"
  | "inductor"
  | "diode"
  | "transistor"
  | "ic"
  | "connector"
  | "other";

export interface ComponentTypeInfo {
  key: ComponentTypeKey;
  label: string;
  /** Lucide approximation — EDA glyphs (resistor/capacitor) don't exist in Lucide. */
  icon: LucideIcon;
}

const TYPE_INFO: Record<ComponentTypeKey, ComponentTypeInfo> = {
  led: { key: "led", label: "LED", icon: Lightbulb },
  resistor: { key: "resistor", label: "Resistor", icon: RectangleHorizontal },
  capacitor: {
    key: "capacitor",
    label: "Capacitor",
    icon: RectangleHorizontal,
  },
  inductor: { key: "inductor", label: "Inductor", icon: RectangleHorizontal },
  diode: { key: "diode", label: "Diode", icon: Triangle },
  transistor: { key: "transistor", label: "Transistor", icon: Cpu },
  ic: { key: "ic", label: "IC", icon: Cpu },
  connector: { key: "connector", label: "Connector", icon: Plug },
  other: { key: "other", label: "Component", icon: Box },
};

function classifyOne(hay: string): ComponentTypeInfo {
  if (/\bled\b|light.?emitting/.test(hay)) return TYPE_INFO.led;
  if (/diode|rectifier|schottky|zener/.test(hay)) return TYPE_INFO.diode;
  if (/transistor|mosfet|\bbjt\b|\bnpn\b|\bpnp\b|\bfet\b/.test(hay))
    return TYPE_INFO.transistor;
  if (/capacitor|\bcap\b/.test(hay)) return TYPE_INFO.capacitor;
  if (/inductor|\bcoil\b|\bferrite\b/.test(hay)) return TYPE_INFO.inductor;
  if (/resistor|\bres\b/.test(hay)) return TYPE_INFO.resistor;
  if (/connector|header|socket|\bplug\b|\bjack\b|terminal/.test(hay))
    return TYPE_INFO.connector;
  if (
    /\bic\b|regulator|\blogic\b|\bgate\b|microcontroller|\bmcu\b|amplifier|op-?amp|\bnand\b|\bnor\b/.test(
      hay,
    )
  )
    return TYPE_INFO.ic;
  return TYPE_INFO.other;
}

/**
 * Best-effort component classification from free-text signals, checked in
 * priority order — pass the cleanest signal (library component name) first so
 * a noisy refdes like "LED_limit_R1" can't override a "Resistor" match.
 * Purely decorative (icon + label); no functional behaviour depends on it.
 */
export function classifyComponentType(
  ...signals: Array<string | null | undefined>
): ComponentTypeInfo {
  for (const signal of signals) {
    if (!signal) continue;
    const info = classifyOne(signal.toLowerCase());
    if (info.key !== "other") return info;
  }
  return TYPE_INFO.other;
}

const LED_COLOR_TONES: Record<string, { text: string; bg: string }> = {
  red: { text: "text-status-danger", bg: "bg-status-danger-soft" },
  green: { text: "text-status-success", bg: "bg-status-success-soft" },
  yellow: { text: "text-status-warning", bg: "bg-status-warning-soft" },
  amber: { text: "text-status-warning", bg: "bg-status-warning-soft" },
  blue: { text: "text-sky-500", bg: "bg-sky-500/10" },
  white: { text: "text-slate-500", bg: "bg-slate-500/10" },
};

/** Returns Tailwind tone classes for a known LED color value, else null. */
export function ledColorTone(
  value: string | null | undefined,
): { text: string; bg: string } | null {
  if (!value) return null;
  return LED_COLOR_TONES[value.trim().toLowerCase()] ?? null;
}
