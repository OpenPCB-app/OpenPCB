import type { ReactElement } from "react";
import { CircuitBoard } from "lucide-react";
import type { DesignerPlacedPart } from "../../../../sdks";

type GlyphKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "diode"
  | "led"
  | "ic"
  | "transistor"
  | "crystal"
  | "switch"
  | "fuse"
  | "testpoint"
  | "connector"
  | "fallback";

const LED_COLORS: Record<string, string> = {
  red: "#F87171",
  green: "#34D399",
  blue: "#60A5FA",
  yellow: "#FBBF24",
  amber: "#FBBF24",
  orange: "#FB923C",
  white: "#E5E7EB",
};

function partSearchText(part: DesignerPlacedPart): string {
  return `${part.reference} ${part.symbol.name ?? ""} ${part.value}`.toLowerCase();
}

function glyphKind(part: DesignerPlacedPart): GlyphKind {
  const ref = part.reference.trim().toUpperCase();
  const text = partSearchText(part);
  if (ref.startsWith("SW")) return "switch";
  if (ref.startsWith("TP")) return "testpoint";
  if (ref.startsWith("R")) return "resistor";
  if (ref.startsWith("C")) return "capacitor";
  if (ref.startsWith("L")) return "inductor";
  if (ref.startsWith("D")) return text.includes("led") ? "led" : "diode";
  if (ref.startsWith("Q")) return "transistor";
  if (ref.startsWith("U")) return "ic";
  if (ref.startsWith("Y") || ref.startsWith("X")) return "crystal";
  if (ref.startsWith("F")) return "fuse";
  if (ref.startsWith("J") || ref.startsWith("P")) return "connector";
  if (text.includes("led")) return "led";
  return "fallback";
}

/** LED stroke color from its value/name color word; amber default. */
export function ledColor(part: DesignerPlacedPart): string {
  const text = partSearchText(part);
  for (const [word, color] of Object.entries(LED_COLORS)) {
    if (text.includes(word)) return color;
  }
  return "#FBBF24";
}

/**
 * Type-specific EDA glyph for a placed part. Strokes use `currentColor` so the
 * icon inherits the row/header text color; LEDs are tinted by their value color.
 */
export function ComponentClassIcon({
  part,
  className = "h-3 w-3",
}: {
  part: DesignerPlacedPart;
  className?: string;
}): ReactElement {
  const kind = glyphKind(part);
  if (kind === "fallback") return <CircuitBoard className={className} />;

  const stroke = kind === "led" ? ledColor(part) : "currentColor";
  const common = {
    fill: "none",
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-hidden="true"
      {...common}
    >
      {renderGlyph(kind, part)}
    </svg>
  );
}

function renderGlyph(kind: GlyphKind, part: DesignerPlacedPart): ReactElement {
  switch (kind) {
    case "resistor":
      return <path d="M1 12h3l1.5-4 3 8 3-8 3 8 1.5-4h3" />;
    case "capacitor":
      return (
        <g>
          <path d="M2 12h7M16 12h6" />
          <path d="M9 6v12M15 6v12" />
        </g>
      );
    case "inductor":
      return (
        <path d="M2 13h2a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0h2" />
      );
    case "diode":
      return (
        <g>
          <path d="M3 12h6M15 12h6" />
          <path d="M9 7l6 5-6 5z" />
          <path d="M15 7v10" />
        </g>
      );
    case "led": {
      const color = ledColor(part);
      return (
        <g>
          <path d="M3 13h5M14 13h5" stroke="currentColor" />
          <path d="M8 8l6 5-6 5z" />
          <path d="M14 8v10" />
          <path d="M16 6l3-3M18 4h1v1" stroke={color} />
          <path d="M19 8l3-3M21 6h1v1" stroke={color} />
        </g>
      );
    }
    case "ic":
      return (
        <g>
          <rect x="6" y="4" width="12" height="16" rx="1.5" />
          <circle cx="9" cy="8" r="0.9" fill="currentColor" stroke="none" />
          <path d="M3 8h3M3 12h3M3 16h3M18 8h3M18 12h3M18 16h3" />
        </g>
      );
    case "transistor":
      return (
        <g>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h4M8 8v8M8 10l6-4M8 14l6 4M14 6v4M14 14v4" />
        </g>
      );
    case "crystal":
      return (
        <g>
          <path d="M2 12h4M18 12h4" />
          <path d="M6 7v10M18 7v10" />
          <rect x="9" y="6" width="6" height="12" rx="0.5" />
        </g>
      );
    case "switch":
      return (
        <g>
          <path d="M2 16h4M18 16h4" />
          <circle cx="6" cy="16" r="1" fill="currentColor" stroke="none" />
          <circle cx="18" cy="16" r="1" fill="currentColor" stroke="none" />
          <path d="M6 16l11-7" />
        </g>
      );
    case "fuse":
      return (
        <g>
          <path d="M2 12h3M19 12h3" />
          <rect x="5" y="8" width="14" height="8" rx="4" />
          <path d="M5 12h14" />
        </g>
      );
    case "testpoint":
      return (
        <g>
          <path d="M12 3v9" />
          <circle cx="12" cy="16" r="3.5" />
        </g>
      );
    case "connector":
      return (
        <g>
          <rect x="6" y="4" width="9" height="16" rx="1" />
          <circle cx="10.5" cy="9" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="15" r="1.2" fill="currentColor" stroke="none" />
          <path d="M15 9h6M15 15h6" />
        </g>
      );
    default:
      return <path d="M4 12h16" />;
  }
}
