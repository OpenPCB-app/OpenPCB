/**
 * The one guard every global / canvas keydown handler starts with (T-002):
 *
 *   if (isShortcutBlocked(event)) return;
 *
 * Duck-typed on purpose (no `instanceof HTMLElement`) so it works across
 * iframes/portals and in node unit tests. `isEditableShortcutTarget` from
 * @openpcb/r3f-eda-canvas is not reused: it throws without a DOM, treats
 * checkboxes as editable and misses role=textbox/combobox.
 */

/** Minimal element surface the guard reads. */
interface GuardElement {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
}

/** `<input type>` values that do not take typed text. */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "image",
  "range",
  "color",
  "file",
]);

const TEXT_ENTRY_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

const OVERLAY_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="menubar"],[role="listbox"]';

/** Controls whose own activation keys (Enter/Space) must not double-fire. */
const ACTIVATABLE_SELECTOR =
  'button,a[href],summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="row"]';

/**
 * Widgets that move focus or value with arrow keys: roving tablists, radio
 * groups, sliders, and kit roving groups (SegmentedControl) marked with
 * `data-roving-focus` — a plain `role="group"` does not own arrows.
 */
const ARROW_OWNER_SELECTOR =
  '[role="tablist"],[role="radiogroup"],[role="slider"],[data-roving-focus]';

/** Native `<input type>`s that change their own value with arrow keys. */
const ARROW_INPUT_TYPES = new Set(["radio", "range"]);

const ACTIVATION_KEYS = new Set(["Enter", " "]);
const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function asElement(target: EventTarget | null | undefined): GuardElement | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<GuardElement> & { nodeType?: number };
  if (candidate.nodeType !== undefined && candidate.nodeType !== 1) return null;
  if (typeof candidate.tagName !== "string") return null;
  if (typeof candidate.getAttribute !== "function") return null;
  if (typeof candidate.closest !== "function") return null;
  return candidate as GuardElement;
}

/** Lower-cased `type` of an `<input>` (missing = "text"), else null. */
function inputType(element: GuardElement): string | null {
  if (element.tagName.toUpperCase() !== "INPUT") return null;
  return (element.getAttribute("type") ?? "text").toLowerCase();
}

/** True when typing into `target` would edit text (input, textarea, …). */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  const element = asElement(target);
  if (!element) return false;
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  const type = inputType(element);
  if (type !== null) return !NON_TEXT_INPUT_TYPES.has(type);
  if (element.isContentEditable) return true;
  const role = element.getAttribute("role");
  if (role && TEXT_ENTRY_ROLES.has(role)) return true;
  return Boolean(element.closest('[contenteditable]:not([contenteditable="false"])'));
}

/** True when `target` sits inside a dialog, menu or listbox. */
export function isInsideOverlay(target: EventTarget | null | undefined): boolean {
  const element = asElement(target);
  return Boolean(element?.closest(OVERLAY_SELECTOR));
}

interface QueryableDocument {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

/**
 * True while a modal is open anywhere (kit Dialog / DialogHost and every
 * hand-rolled modal set `aria-modal="true"`), wherever focus happens to be.
 */
export function isModalOpen(doc?: QueryableDocument | null): boolean {
  const root = doc ?? (typeof document === "undefined" ? null : document);
  if (!root) return false;
  const modals = root.querySelectorAll('[aria-modal="true"]');
  for (let index = 0; index < modals.length; index += 1) {
    const modal = asElement(modals[index] as EventTarget);
    if (modal && !modal.closest("[hidden]")) return true;
  }
  return false;
}

export interface ShortcutGuardEvent {
  key: string;
  target: EventTarget | null;
  isComposing?: boolean;
  /** An earlier handler (e.g. a kit roving group) already consumed the key. */
  defaultPrevented?: boolean;
}

export interface ShortcutGuardOptions {
  /**
   * Let the shortcut fire while typing (e.g. a `Mod+K` palette). Dialogs,
   * menus and open modals still block it.
   */
  allowInEditable?: boolean;
  /** Document to probe for open modals (defaults to the global one). */
  doc?: QueryableDocument | null;
}

/**
 * True when the focused control handles `event.key` itself: Enter/Space on a
 * button-like control or non-text input (checkbox, radio, submit, …), arrows /
 * Home / End / PageUp / PageDown in a roving widget, radio or range input — or
 * a handler already `preventDefault`ed one of those keys.
 */
function isKeyOwnedByTarget(event: ShortcutGuardEvent): boolean {
  const activation = ACTIVATION_KEYS.has(event.key);
  if (!activation && !NAVIGATION_KEYS.has(event.key)) return false;
  if (event.defaultPrevented) return true;
  const element = asElement(event.target);
  if (!element) return false;
  const type = inputType(element);
  if (activation) {
    if (type !== null && NON_TEXT_INPUT_TYPES.has(type)) return true;
    return Boolean(element.closest(ACTIVATABLE_SELECTOR));
  }
  if (type !== null && ARROW_INPUT_TYPES.has(type)) return true;
  return Boolean(element.closest(ARROW_OWNER_SELECTOR));
}

/**
 * True when a global shortcut must NOT run: IME composition, typing in an
 * editable field, focus inside a dialog/menu/listbox, a modal is open, or
 * the focused control owns the key (see `isKeyOwnedByTarget`).
 */
export function isShortcutBlocked(
  event: ShortcutGuardEvent,
  options: ShortcutGuardOptions = {},
): boolean {
  if (event.isComposing) return true;
  const target = event.target;
  if (!options.allowInEditable && isEditableTarget(target)) return true;
  if (isInsideOverlay(target)) return true;
  if (isModalOpen(options.doc)) return true;
  return isKeyOwnedByTarget(event);
}
