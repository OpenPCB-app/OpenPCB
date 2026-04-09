import { Box, type LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";

/**
 * Resolve a Lucide icon by its exported name (e.g. "Box", "PenTool").
 * Falls back to Box if the name is unknown. Modules declare their sidebar
 * icon as a string in manifest.json, keeping the manifest serializable.
 *
 * lucide-react exports every icon as a named React component at the top
 * level, so we can look them up by string key directly.
 */
export function resolveLucideIcon(name: string): LucideIcon {
  const icons = LucideIcons as unknown as Record<
    string,
    LucideIcon | undefined
  >;
  return icons[name] ?? Box;
}
