# Kit + token spec (wave F0a) — what every later wave builds on

Existing kit: `src/shared/frontend/ui/*` (barrel `index.ts`): Button, Card, Pill/StatusPill, Chip, IconButton,
Tooltip*, Tabs*, DropdownMenu*, ContextMenu*, RelevanceBar, StackedCard, Textarea, PanelSectionHeader,
PropertyGrid/Row, TableHeaderRow/TableRow, SegmentedControl, SearchField, Checkbox, StatusDot, SeverityDiamond,
DockTabs, StatusBar/StatusSegment, Toolbar/ToolbarButton/ToolbarSeparator, CanvasZoomCluster. Style: forwardRef,
`cn()` from `@/lib/utils`, hand-rolled variant maps (no cva), token classes only. Radix is available
(dialog, dropdown-menu, context-menu, tooltip, tabs, scroll-area). Existing Radix dialog wrapper lives at
`src/core/frontend/src/components/ui/dialog.tsx` (3 users) — move it into the kit and leave a re-export shim.
Imperative-UI precedent: zustand store in `src/shared/frontend/context-menu` + host `AppContextMenu` in core.

## Tokens to add (`src/core/frontend/src/index.css`, BOTH `:root` light and `html.dark`, plus `@theme inline` mapping)
- `--scrim` (modal backdrop; dark ≈ rgba(0,0,0,.55), light ≈ rgba(17,17,20,.32)) → `bg-scrim`.
- `--shadow-float`, `--shadow-dialog` (theme-aware, subtle) → `shadow-float`, `shadow-dialog`.
- `--status-{danger,warning,success,info,neutral}-border` (~40% alpha) → `border-status-*-border`.
- Light-theme contrast: `--status-danger` text on `--status-danger-soft` must reach ≥4.5:1 (T-175) — darken the
  light danger/warning text tokens or add `--status-*-text` tokens used on soft backgrounds.
- Canvas-well overlay tokens (theme-INVARIANT, wells are always dark, T-284): `--well-text`, `--well-text-muted`,
  `--well-border`, `--well-surface` (for "Loading preview…" / "No preview" / messages drawn over canvas wells).
- `--surface-schematic-canvas` (dark = current schematic well #101012, light = neutral `--surface-app`-ish, NOT
  the blue-cast #f0f4fb) and `--color-canvas` for the PCB clear colour = `--surface-canvas-well`.
- `--focus-ring` (alias of `--selection`).
- Fix radius leaks (T-016): bare `rounded` must resolve to the flat 2px scale (`--radius` default), and remove
  pill geometry from non-status labels via the primitives.
- Tailwind `@source` for `node_modules/@openpcb/r3f-eda-canvas/dist` (and other `@openpcb/*` dists that ship
  className strings) so their utility classes are generated (T-264) — or, if that is not viable, document it.
- z-order: menus/popovers 50, dialogs 60, toasts 70, tooltips 80.

## Primitives to add (all: forwardRef where it makes sense, `className` passthrough, token classes only,
default height 22px, `size="sm"` 20px, `rounded-control`, `border-border-control`, `bg-surface-input`)
| File | API |
|---|---|
| `focus.ts` | `FOCUS_RING` (visible outline recipe used by IconButton/ToolbarButton today, `focus-visible:` only), `FIELD_BASE`, `FIELD_FOCUS` (`focus-visible:border-selection` + ring), `FIELD_INVALID` |
| `input.tsx` | `Input` (native input attrs except `size`; `size?: "sm"\|"md"`; `invalid?`; `mono?`; `leading?`/`trailing?` ReactNode e.g. unit suffix; `containerClassName?`); `autoComplete="off"` default for search-like usage is up to callers |
| `number-input.tsx` | `NumberInput({ value: number\|null; onCommit(v:number); onDraftChange?; min?; max?; step?; precision?; unit?; allowEmpty?; allowNegative?; size?; invalid?; "aria-label"? })` — text input, `inputMode="decimal"`, accepts locale comma, commits on Enter/blur, Esc reverts, ArrowUp/Down step (Shift ×10), invalid draft shows `FIELD_INVALID` and does NOT commit. Must accept 0 and negatives when allowed (T-157 class of bugs) and never drop the decimal point (Q5-002). Pure parse/clamp helper exported + unit-tested. |
| `field.tsx` | `Field({ label; htmlFor?; hint?; error?; required?; inline?; children })` |
| `select.tsx` | `Select<T extends string>({ options: ReadonlyArray<{id:T; label:string; disabled?:boolean}>; value:T; onChange(id:T); size?; invalid?; "aria-label"?; disabled? })` — styled NATIVE `<select>` (`appearance-none` + chevron; works in canvases/Electron; `color-scheme` gives dark popups) |
| `switch.tsx` | `Switch({ checked; onCheckedChange(b); disabled?; label?; size?; "aria-label"? })` → `<button role="switch" aria-checked>`; on = `bg-primary` |
| `radio-group.tsx` | `RadioGroup<T>({ options; value; onChange; name; orientation?; "aria-label"? })` |
| `dialog.tsx` | Radix wrapper: `Dialog`, `DialogTrigger`, `DialogContent({ size?: "sm"\|"md"\|"lg"\|"xl"\|"full"; showCloseButton?; onEscapeKeyDown? })` (scrim `bg-scrim`, `rounded-float`, `shadow-dialog`, focus trap + return), `DialogHeader({ title; description?; trailing? })` 34px, `DialogBody`, `DialogFooter` (right-aligned kit Buttons), `DialogTitle`, `DialogDescription`, `DialogClose` |
| `dialog-host.tsx` | `confirmDialog({ title; description?; confirmLabel?; cancelLabel?; tone?: "default"\|"danger" }): Promise<boolean>`; `promptDialog({ title; label?; description?; defaultValue?; placeholder?; confirmLabel?; validate?(v): string\|null; maxLength?; inputMode? }): Promise<string\|null>`; `<DialogHost/>` (zustand queue, one at a time). Enter confirms, Esc cancels, focus goes to the input/primary button. |
| `toast.tsx` | `toast.show({ tone?: "info"\|"success"\|"warning"\|"danger"; title?; message; action?: {label; onClick}; durationMs?: number\|null; id? /* dedupe/replace */ }): string`; `toast.info/success/warning/error(message, opts?)`; `toast.dismiss(id)`; `<Toaster/>` — region "Notifications", danger `role="alert"`, others `role="status" aria-live="polite"`, max 3 visible, pause on hover, errors default 8 s, others 4 s, bottom-right above the status bar, never covering header controls |
| `error-boundary.tsx` | `ErrorBoundary({ scope: string; resetKeys?: unknown[]; fallback?(p:{error; reset}); onError? })`, `ErrorFallback({ error; reset; title?; compact? })` (Try again · Copy details · Reload), `setErrorReporter(fn)` |
| `banner.tsx` | `Banner({ tone: "info"\|"warning"\|"danger"\|"success"\|"neutral"; title?; icon?; actions?; onDismiss?; compact?; children })` — danger `role="alert"` |
| `empty-state.tsx` | `EmptyState({ icon?; title; description?; actions?; size?: "sm"\|"md"; align?: "center"\|"start" })` — the ONE empty-state pattern (T-022) |
| `spinner.tsx` | `Spinner({ size?; label? })` (`role="status"`, reduced-motion aware), `LoadingState({ label?; inline? })` |
| `kbd.tsx` + `shortcut.ts` | `Kbd({ keys: string \| string[] })`; `formatShortcut("Mod+Shift+S")` → "⌘⇧S" (mac) / "Ctrl+Shift+S" |
| `dropdown-menu.tsx` (edit) | add `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuShortcut`; menu recipe = the ONE menu look (22px items, `--menu-*` tokens, `rounded-float`, `shadow-float`) (T-025 consumers) |
| `data-table.tsx` (edit) | `TableRow` gains `interactive?` (tabIndex 0, Enter/Space → onClick, focus ring, `aria-selected`) (K35) |
| `row-actions` (edit wherever the kit renders hover-revealed actions) | hover-revealed actions must also show on `group-focus-within` / `focus-visible` (T-008) |
| existing edits | `FOCUS_RING` on Button (all variants — current `focus-visible:border-selection` is invisible on borderless variants), Chip, SegmentedControl options, DockTabs tabs, TabsTrigger, clickable StatusSegment, PanelSectionHeader toggle (K34/T-007). Tabs/DockTabs/SegmentedControl: arrow-key roving tabindex per WAI-ARIA (T-018). SearchField: `autoComplete="off"`, `aria-label` required, optional `shortcutHint` that is only rendered if the caller wires the shortcut. |

## Non-UI shared helpers
- `src/shared/frontend/http/problem.ts`: `class ApiError extends Error { status; code?; type?; title?; detail?; requestId? }`,
  `apiErrorFromResponse(res, fallbackMessage?)` (parses `application/problem+json` and the `{ok:false,error}` envelope
  the backend uses), `isApiError`, `describeError(err, action?: string): string` —
  network `TypeError`/"Failed to fetch" → "Can't reach the local OpenPCB service"; 400/422 → problem detail;
  404 → "… not found"; 409 / `REVISION_CONFLICT` → "The design changed elsewhere — reloaded, try again";
  413 → "File too large"; 5xx → "Something went wrong in the local service (HTTP n)" + detail if safe.
  Prefix with the action ("Couldn't delete part: …"). Unit tests.
- `src/shared/frontend/keyboard/shortcut-guard.ts`: `isShortcutBlocked(event: KeyboardEvent): boolean` — true when the
  target is editable (input incl. all types except checkbox/radio/button/range, textarea, select, contenteditable,
  `[role=textbox]`, `[role=combobox]`), or inside `[role=dialog]`, `[role=alertdialog]`, `[role=menu]`,
  `[role=listbox]`, or when a kit modal/dialog is open (dialog-host/Radix `aria-modal` present). Reuse
  `isEditableShortcutTarget` from `src/shared/frontend/canvas/utils/keyboard-shortcuts.ts` if it fits. Unit tests.
- `src/core/frontend/src/ui-discipline.test.ts` + `ui-discipline.baseline.json`: ratchet. Scans in-scope frontend
  source (`src/core/frontend/src/**`, `src/modules/*/frontend/**`, `src/shared/frontend/**`, excluding tests and
  `generated/`) and counts per file: raw palette classes
  (`(bg|text|border|ring|divide|fill|stroke|from|to|via|outline|placeholder|shadow|decoration|accent|caret)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}`,
  `(bg|text|border)-(white|black)`, arbitrary hex `-[#…]`), `window.prompt|window.confirm|window.alert` (and bare
  `prompt(`/`confirm(` calls), native `<select` outside the kit, `text-[<10px]`, `backdrop-blur`, `shadow-(md|lg|xl|2xl)`.
  Lines containing `/* domain-color */` are exempt. The test FAILS if any file's count exceeds its baseline; a
  helper script/flag regenerates the baseline (orchestrator lowers it after each area). Start baseline = today's counts.
- `docs/design/design-tokens.md`: document new tokens, the primitive catalogue, the raw→semantic mapping table,
  the ratchet test.

## Raw → semantic mapping (for every implementer)
| Raw | Semantic |
|---|---|
| `bg-white`/`bg-slate-50` + `dark:bg-slate-900/950` | `bg-surface-panel` (page bg → `bg-surface-app`) |
| `bg-slate-100` + `dark:bg-slate-800` | `bg-surface-raised`; section headers → `bg-surface-section` |
| hover `bg-slate-50/100` + `dark:hover:bg-slate-800` | `hover:bg-surface-hover` |
| selected rows (`bg-violet-50`, `bg-slate-200/700`) | `bg-surface-selected` |
| control fills `bg-slate-200` + `dark:bg-slate-700` | `bg-surface-control` |
| input backgrounds | kit `Input`/`Select`/`Textarea` (`bg-surface-input`) |
| `border-slate-200` + `dark:border-slate-800/700` | `border-border`; subtle → `border-border-subtle` |
| control borders `border-slate-300` + `dark:border-slate-700/600` | `border-border-control` |
| `divide-slate-*` | `divide-divider` |
| `text-slate-900` + `dark:text-slate-100` / `text-white` | `text-text-strong` |
| `text-slate-700/800` + `dark:text-slate-200/300` | `text-text` |
| `text-slate-500/600` + `dark:text-slate-400` | `text-text-secondary` |
| `text-slate-400` + `dark:text-slate-500` | `text-text-tertiary` |
| `text-slate-300` + `dark:text-slate-600` | `text-text-disabled` |
| uppercase micro labels | `text-2xs uppercase tracking-[.04em] text-text-caps` |
| `bg-violet-600 text-white hover:bg-violet-700` | `<Button variant="primary">` |
| violet links / active text | `text-text-strong` (+ `hover:underline` for links); selection/focus only → `text-selection` |
| `ring-*`, `focus:ring-*` | `FOCUS_RING` (buttons) / `FIELD_FOCUS` (fields) |
| red/amber/emerald/sky boxes (`bg-*-50/950`, `border-*-200/900`, `text-*-700/300`) | `<Banner tone=…>` or `bg-status-*-soft border-status-*-border text-status-*` |
| `text-red/amber/emerald/green/sky/blue-*` | `text-status-{danger,warning,success,info}` |
| `bg-red-600 text-white` buttons | `<Button variant="danger">` |
| `shadow-sm/md/lg/xl` | `shadow-float` (menus/popovers/toasts) or `shadow-dialog`; docked panels none |
| `rounded-lg/xl/2xl` | `rounded-control` / `rounded-float`; `rounded-full` only dots/avatars/spinners |
| `backdrop-blur-*` | remove (opaque panels) |
| `text-[8px]`/`text-[9px]`/`text-[9.5px]` | `text-2xs` |
| `fixed inset-0 bg-black/50` overlays | kit `Dialog` |
| domain colours (layers, nets, DRC severity, pin types, 3D) | keep, via named constants/tokens, tagged `/* domain-color */` |
