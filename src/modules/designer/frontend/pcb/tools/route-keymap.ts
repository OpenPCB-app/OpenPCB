/**
 * Route-tool keybinding table — single source of truth for the HUD key hints.
 * The PcbCanvas keydown handler implements these bindings; when adding a key,
 * add it here so the on-canvas hints stay truthful. (Unifying the handler
 * itself onto this table is planned with the P2 commit-engine work.)
 */
export interface RouteKeyBinding {
  /** Display form, e.g. "V", "W", "Enter". */
  keys: string;
  /** Short lowercase action label shown next to the key. */
  label: string;
  /** Shown in the always-visible compact hint row. */
  primary?: boolean;
  /** Only meaningful while a session is active (hidden when idle). */
  requiresSession?: boolean;
  /** Only shown when the pcb.routeAutoFinish feature flag is enabled. */
  requiresAutoFinish?: boolean;
}

export const ROUTE_KEY_BINDINGS: readonly RouteKeyBinding[] = [
  { keys: "Enter", label: "finish", primary: true, requiresSession: true },
  { keys: "V", label: "via + layer", primary: true, requiresSession: true },
  { keys: "W", label: "width", primary: true, requiresSession: true },
  { keys: "⌫", label: "back", primary: true, requiresSession: true },
  { keys: "Esc", label: "cancel", primary: true, requiresSession: true },
  {
    keys: "Tab",
    label: "auto-finish",
    requiresSession: true,
    requiresAutoFinish: true,
  },
  { keys: "/", label: "posture", requiresSession: true },
  { keys: "⇧Space", label: "45°/90°", requiresSession: true },
  { keys: "T/B", label: "layer", requiresSession: true },
  { keys: "1/2", label: "layer" },
  { keys: "⇧", label: "no snap", requiresSession: true },
  { keys: "Alt", label: "no guides", requiresSession: true },
];

/** Hints applicable to the current tool state, compact set first. */
export function routeKeyHints(input: {
  routing: boolean;
  primaryOnly: boolean;
  /** pcb.routeAutoFinish flag state; hides Tab hint when off. Default off. */
  autoFinish?: boolean;
}): readonly RouteKeyBinding[] {
  return ROUTE_KEY_BINDINGS.filter(
    (b) =>
      (input.routing || !b.requiresSession) &&
      (!input.primaryOnly || b.primary === true) &&
      (input.autoFinish === true || !b.requiresAutoFinish),
  );
}
