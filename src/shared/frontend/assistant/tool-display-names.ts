/**
 * Maps internal assistant tool names → user-facing label + Lucide icon name.
 * Internal snake_case names (e.g. `designer_get_design_summary`) must never
 * leak into chat UI. Unmapped tools fall back to humanized snake_case.
 */
export interface ToolDisplay {
  label: string;
  /** Lucide icon name (resolve via resolveLucideIcon / direct import). */
  icon: string;
}

const TOOL_DISPLAY: Record<string, ToolDisplay> = {
  designer_get_design_summary: { label: "Read design", icon: "FileSearch" },
  designer_create_design: { label: "Create design", icon: "SquarePlus" },
  designer_place_components: { label: "Place components", icon: "LayoutGrid" },
  designer_get_part_detail: { label: "Read part detail", icon: "Package" },
  designer_wire_pins: { label: "Wire pins", icon: "Route" },
  designer_add_net: { label: "Add net", icon: "Spline" },
  library_search_components: { label: "Search library", icon: "Search" },
  library_resolve_bom: { label: "Resolve BOM", icon: "ListChecks" },
  library_get_component: { label: "Get component", icon: "Package" },
  library_get_component_detail: { label: "Read component", icon: "Package" },
  bom_set_mpn: { label: "Set MPN", icon: "Barcode" },
  bom_auto_source: { label: "Auto-source BOM", icon: "Sparkles" },
  pcb_run_drc: { label: "Run DRC", icon: "ShieldCheck" },
  schem_run_erc: { label: "Run ERC", icon: "ShieldCheck" },
};

function humanizeSnakeCase(name: string): string {
  const spaced = name.replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function toolDisplay(toolName: string): ToolDisplay {
  return (
    TOOL_DISPLAY[toolName] ?? {
      label: humanizeSnakeCase(toolName),
      icon: "Wrench",
    }
  );
}
