/**
 * One shortcut spec syntax for display (`formatShortcut`, `<Kbd>`) and
 * matching (`matchesShortcut`, `useGlobalShortcut`): modifiers + one key
 * joined by "+", e.g. `"Mod+Shift+S"`, `"Escape"`, `"/"`, `"Mod++"`.
 * `Mod` is ⌘ on macOS and Ctrl elsewhere. Modifiers display in the order
 * written, so write them in the order you want shown.
 */
export type ShortcutModifier = "mod" | "ctrl" | "meta" | "alt" | "shift";

export interface ParsedShortcut {
  modifiers: ShortcutModifier[];
  key: string;
}

const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  mod: "mod",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  space: " ",
  spacebar: " ",
  tab: "Tab",
  backspace: "Backspace",
  del: "Delete",
  delete: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  plus: "+",
};

export function parseShortcut(spec: string): ParsedShortcut {
  const trimmed = spec.trim();
  // A trailing "+" key ("Mod++") would otherwise vanish in the split.
  const endsWithPlusKey = trimmed.length > 1 && trimmed.endsWith("++");
  const parts = (endsWithPlusKey ? trimmed.slice(0, -2) : trimmed)
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const modifiers: ShortcutModifier[] = [];
  let key = endsWithPlusKey ? "+" : trimmed === "+" ? "+" : "";
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier && !modifiers.includes(modifier)) {
      modifiers.push(modifier);
      continue;
    }
    key =
      KEY_ALIASES[part.toLowerCase()] ??
      (/^f\d{1,2}$/i.test(part) ? part.toUpperCase() : part);
  }
  return { modifiers, key };
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

interface PlatformOptions {
  /** Override platform detection (tests, previews). */
  mac?: boolean;
}

const MAC_MODIFIER: Record<ShortcutModifier, string> = {
  mod: "⌘",
  meta: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
};

const PC_MODIFIER: Record<ShortcutModifier, string> = {
  mod: "Ctrl",
  meta: "Win",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
};

const MAC_KEY: Record<string, string> = {
  Enter: "↩",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  Escape: "Esc",
};

const COMMON_KEY: Record<string, string> = {
  " ": "Space",
  Escape: "Esc",
  Delete: "Del",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

function displayKey(key: string, mac: boolean): string {
  if (mac && MAC_KEY[key]) return MAC_KEY[key];
  if (COMMON_KEY[key]) return COMMON_KEY[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** `"Mod+Shift+S"` → `"⌘⇧S"` (macOS) / `"Ctrl+Shift+S"` (elsewhere). */
export function formatShortcut(spec: string, options: PlatformOptions = {}): string {
  const mac = options.mac ?? isMacPlatform();
  const { modifiers, key } = parseShortcut(spec);
  const names = modifiers.map((m) => (mac ? MAC_MODIFIER[m] : PC_MODIFIER[m]));
  const keyName = key ? displayKey(key, mac) : "";
  if (mac) return [...names, keyName].join("");
  return [...names, keyName].filter((part) => part.length > 0).join("+");
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/**
 * Letters and digits match the character the layout produced, so QWERTZ
 * Ctrl+Y (physical KeyZ) is Mod+Y, never Mod+Z, and Dvorak's ";" (KeyZ) is
 * not Z. The physical key is used only when the layout gave no usable
 * character: for letters a non-ASCII one (macOS Option "˜"/"Dead", non-Latin
 * "я"); for digits anything but a letter/digit (AZERTY's unshifted "&").
 */
function keyMatches(event: ShortcutEvent, key: string): boolean {
  if (key.length === 1 && /[a-z]/i.test(key)) {
    if (event.key.toLowerCase() === key.toLowerCase()) return true;
    if (/^[\x20-\x7e]$/.test(event.key)) return false;
    return event.code === `Key${key.toUpperCase()}`;
  }
  if (key.length === 1 && /[0-9]/.test(key)) {
    if (event.key === key) return true;
    if (/^[a-z0-9]$/i.test(event.key)) return false;
    return event.code === `Digit${key}`;
  }
  if (key === "Escape") return event.key === "Escape" || event.key === "Esc";
  return event.key === key;
}

/**
 * Exact-modifier match: `"N"` does not fire on ⌘N, `"Mod+K"` does not fire
 * on ⌘⇧K. Shift is only compared for letters, named keys and when the spec
 * names it — `"?"` matches however the layout produces it.
 */
export function matchesShortcut(
  event: ShortcutEvent,
  spec: string,
  options: PlatformOptions = {},
): boolean {
  const mac = options.mac ?? isMacPlatform();
  const { modifiers, key } = parseShortcut(spec);
  if (!key) return false;
  const wantMeta = modifiers.includes("meta") || (mac && modifiers.includes("mod"));
  const wantCtrl = modifiers.includes("ctrl") || (!mac && modifiers.includes("mod"));
  const wantAlt = modifiers.includes("alt");
  const wantShift = modifiers.includes("shift");
  if (event.metaKey !== wantMeta || event.ctrlKey !== wantCtrl) return false;
  if (event.altKey !== wantAlt) return false;
  const printableSymbol = key.length === 1 && key !== " " && !/[a-z0-9]/i.test(key);
  if ((wantShift || !printableSymbol) && event.shiftKey !== wantShift) return false;
  return keyMatches(event, key);
}
