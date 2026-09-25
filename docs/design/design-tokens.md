# Design tokens

> Rewritten 2026-09-05 for the neutral EDA redesign. This document describes the system;
> the **values live in one place**: `src/core/frontend/src/index.css`. If a value here and
> a value there disagree, `index.css` wins — fix this file.

The UI is chrome for an EDA tool: dense, neutral, low-chroma, so that saturated canvas
artwork (copper layers, net colours, DRC markers) is the only thing that draws the eye.

**Where tokens live.** `index.css` has four blocks:

1. `@theme` — theme-invariant primitives: fonts, type scale, radii, rhythm, canvas and
   layer palette, plus the Tailwind scale remaps (see §6).
2. `@theme inline` — semantic `--color-*` names mapped to `var(--…)`, so utilities such as
   `bg-surface-panel` resolve per theme.
3. `:root` — light values for every raw variable.
4. `html.dark` — dark values. Dark mode is class-based (`@custom-variant dark`).

After them come the base-layer `:focus-visible` rule and the `.row-actions` class (§9).

Consume tokens through Tailwind utilities (`bg-surface-panel`, `text-text-secondary`,
`border-border-subtle`, `rounded-control`) — not raw hex, and not `slate-*`/`violet-*`.

---

## 1. Semantic tokens

| Group | Tokens |
|---|---|
| Surfaces | `surface-app`, `surface-rail`, `surface-panel`, `surface-panel-head`, `surface-section`, `surface-raised`, `surface-control`, `surface-input`, `surface-hover`, `surface-selected`, `surface-canvas-well`, `surface-schematic-canvas` (schematic editor background: `#101012` dark, neutral `#f4f4f5` light) |
| Elevation | `scrim` (modal backdrop, `bg-scrim`), `shadow-float` (menus, popovers, toasts, tooltips), `shadow-dialog` (dialogs). Per-theme values live in `--elevation-float` / `--elevation-dialog`. Docked panels have no shadow |
| Canvas-well overlay (invariant) | `well-text`, `well-text-muted`, `well-border`, `well-surface` — for "Loading preview…" / "No preview" / messages drawn over a canvas well, which is dark in BOTH themes |
| Focus | `focus-ring` (alias of `selection`) — `outline-focus-ring` |
| Lines | `border`, `border-subtle`, `border-control`, `divider` |
| Text | `text-strong`, `text`, `text-secondary`, `text-tertiary`, `text-disabled`, `text-caps` (uppercase micro-labels) |
| Action | `primary`, `primary-foreground` — neutral, not chromatic |
| Selection | `selection`, `selection-soft` |
| Status | `status-danger`, `status-warning`, `status-success`, `status-info`, `status-neutral`, each with a `-soft` 12–14% fill and a `-border` 40% stroke (`border-status-danger-border`). The base colour is ≥ 4.5:1 as text on its own `-soft` fill over every chrome surface up to `surface-raised`, in both themes (light values were darkened for T-175) |
| Net classes | `net-power`, `net-ground`, `net-signal`, `net-bus` |
| Canvas (invariant) | `canvas` (= `surface-canvas-well`, the PCB clear colour), `canvas-board`, `canvas-grid`, `canvas-grid-major`, `canvas-axis`, `canvas-ratsnest`, `canvas-refdes`, `canvas-pad-number` |
| Layers (invariant) | `layer-f-cu`, `layer-in1-cu`, `layer-in2-cu`, `layer-b-cu`, `layer-f-silks`, `layer-b-silks`, `layer-f-mask`, `layer-b-mask`, `layer-f-paste`, `layer-b-paste`, `layer-f-crtyd`, `layer-b-crtyd`, `layer-edge-cuts`, `layer-drill`, `layer-metadata`, plus `--opacity-copper` |

Status, layer and net-class colours are three **non-overlapping** families: a colour never
means "error" in one place and "bottom copper" in another.

## 2. The accent rule

**Violet is retired.** Chrome is neutral greys. The single chromatic accent is the
selection colour — `#33d1ff` cyan in dark, `#0891b2` in light — and it is used **only** for
selection, focus rings and net highlight. Primary buttons are neutral (`primary` /
`primary-foreground`), not coloured.

## 3. Light and dark

Every semantic token has both values. Light is not an afterthought: the designs were drawn
dark, but `:root` carries the full light column and each screen must be checked with the
`.dark` class removed. Only the canvas and layer palettes are theme-invariant — the PCB
canvas is always dark, because the layer palette is chosen against black.

## 4. Type scale

| Token | Size / line-height | Typical use |
|---|---|---|
| `text-2xs` | 10 / 14 | uppercase micro-labels, status bar |
| `text-xs` | 11 / 15 | table rows, property values, most chrome |
| `text-sm` | 12 / 16 | body default |
| `text-base` | 13 / 18 | panel titles |
| `text-lg` | 15 / 20 | screen headings |
| `text-xl` | 20 / 26 | empty states |

Fonts are **IBM Plex Sans** and **IBM Plex Mono**, bundled via `@fontsource` and imported in
`main.tsx` — Electron runs offline, so nothing is fetched from Google Fonts. Mono is
semantic: it marks a machine identifier (refdes, MPN, net name, coordinate). `body` sets
12px and `font-variant-numeric: tabular-nums` globally so columns of numbers align.

## 5. Radii and rhythm

Radii: `radius-none` 0 (docked panels, rows, tabs), `radius-control` 2px (buttons, inputs,
chips), `radius-float` 3px (menus, tooltips, HUDs, toasts, dialogs), `radius-pill` 999px
(status pills only). `radius-card` is kept at 2px as a compatibility alias. Bare `rounded`
reads `--radius`, which is also 2px (T-016). `rounded-full` is for dots, avatars, spinners
and radio indicators only — a static label is a `Badge` (2px), never a pill.

Rhythm (`--spacing-*`, usable as `h-row`, `h-toolbar`, …): `row` 22px, `row-lg` 26px,
`panel-head` 24px, `toolbar` 30px, `tabbar` 34px, `statusbar` 22px, `rail` 80px.

## 6. Compatibility layer (stopgap — remove it)

The redesign lands on a codebase with ~4,000 `slate-*` and ~700 `violet-*` class usages.
Two shims keep those files coherent until they are migrated:

- **Aliases** in `@theme inline`: `surface-card` → `surface-panel`, `surface-card-hover` →
  `surface-hover`, `text-primary` → `text-strong`, `accent` → `selection`, `accent-soft` →
  `selection-soft`, `accent-text` → `text-strong`, plus the `status-*-soft` and `net-*`
  names that predate this system.
- **Tailwind scale remaps** in `@theme`: `--color-slate-50…950` becomes a neutral grey ramp,
  `--color-violet-50…950` becomes a neutral "active" ramp, and `--radius-sm/md/lg/xl` are
  flattened to 2px with `2xl/3xl` at 3px (`rounded-full` still rounds, for dots and
  spinners).

Both are **documented stopgaps**, not API. New code uses the semantic names. The remaining
migration (Assistant, Knowledge, Settings, import wizard, 3D) is tracked as a follow-up; when
it lands, delete the remaps.

## 7. Canvas palette

The `canvas-*` and `layer-*` tokens above are the design's values, but the 2D/3D canvases do
**not** read them yet: the renderer palette is owned by the external package
`@openpcb/r3f-eda-canvas` (`canvasTheme.ts` — `SCHEMATIC_DARK`, `PREVIEW_DARK`,
`PCB_CANVAS_TOKENS`, `PCB_LAYER_COLORS`, `PCB_TRACE_COLORS`), and `EdaCanvas` wraps its own
`CanvasThemeProvider(mode)`. Aligning that package with these values, then bumping the
dependency, is a follow-up.

## 8. Layering (z-order)

| Layer | z | Notes |
|---|---|---|
| Dialogs (scrim + panel) | `z-50` | kit `Dialog`, `DialogHost`, hand-rolled modals |
| Menus, popovers, select popups | `z-60` | above dialogs so a menu opened inside a dialog is never hidden behind it |
| Toasts | `z-70` | `<Toaster/>`, bottom-right above the status bar |
| Tooltips | `z-80` | always on top |

## 9. Focus

- `index.css` sets one base-layer rule, `:focus-visible { outline: 1px solid var(--focus-ring);
  outline-offset: -1px }`, replacing the browser's blue ring app-wide. A component's own
  `outline-none` + kit recipe still wins (utilities beat the base layer).
- Kit recipes (`src/shared/frontend/ui/focus.ts`): `FOCUS_RING` (inset, dense controls),
  `FOCUS_RING_OUTSET` (standalone buttons, filled buttons), `FIELD_BASE`, `FIELD_FOCUS`
  (element is the field), `FIELD_FOCUS_WITHIN` (wrapper contains the field), `FIELD_INVALID`.
- **Tailwind 4 trap:** `outline-none` sets `--tw-outline-style: none`; `focus-visible:outline`
  and `outline-1` only re-read that variable, so the ring stays invisible. The recipes use
  `focus-visible:outline-solid`. `outline-hidden` does not help (4.3 resolves it to none too).
- Hover-revealed row actions: give the row `group` and the actions wrapper `row-actions`
  (plain CSS in `index.css`). They also show on `focus-within`, while their own menu is open
  (`data-state="open"`) and always on devices without hover (T-008).

## 10. Primitive catalogue (`src/shared/frontend/ui`, barrel `index.ts`)

Sizes: controls and rows 22px (`size="sm"` 20px), panel/section headers 24px, header bars
34px (dialog header too). Text floor is `text-2xs` (10px).

| Need | Use |
|---|---|
| Buttons | `Button` (primary / secondary / ghost / danger), `IconButton`, `ToolbarButton` |
| Text / number fields | `Input` (`leading`/`trailing` adornments, `invalid`, `mono`), `NumberInput` (locale comma, Enter/blur commit, Esc revert, Arrow step), `Textarea`, `SearchField` (`shortcut` wires the key) |
| Choice | `Select` (styled native), `Checkbox`, `Switch`, `RadioGroup`, `SegmentedControl` |
| Layout | `Field` (label + hint/error), `PropertyGrid`/`PropertyRow`, `PanelSectionHeader`, `TableHeaderRow`/`TableRow` (`interactive`) |
| Tabs | `Tabs` (Radix), `DockTabs` (roving tabindex, `idPrefix` → `aria-controls`) |
| Menus | `DropdownMenu*` (incl. `CheckboxItem`, `RadioGroup`/`RadioItem`, `Shortcut`), `ContextMenu*`; recipe constants `MENU_CONTENT` / `MENU_ITEM` for custom menus |
| Overlays | `Dialog` + `DialogContent` (`size`), `DialogHeader`/`Body`/`Footer`; `confirmDialog()` / `promptDialog()` via `<DialogHost/>`; `Tooltip` |
| Feedback | `toast.*` via `<Toaster/>`, `Banner` (`floating` over canvases), `Badge`, `Pill`/`StatusPill` (status with dot), `StatusDot`, `SeverityDiamond` |
| States | `EmptyState` (the one empty pattern), `LoadingState`, `Spinner`, `ErrorBoundary`/`ErrorFallback` |
| Keys | `Kbd`, `formatShortcut` / `matchesShortcut` (`"Mod+Shift+S"` → ⌘⇧S / Ctrl+Shift+S) |

Never `window.prompt/confirm/alert` — use `promptDialog` / `confirmDialog` / `toast`.

Non-UI helpers:

- `src/shared/frontend/http/problem.ts` — `ApiError`, `apiErrorFromResponse`,
  `describeError(err, action?, { service? })`, `isRetryableError`. All user-facing error text
  goes through `describeError`; never render `HTTP 500`, "Failed to fetch" or stack traces.
- `src/shared/frontend/keyboard/shortcut-guard.ts` — `isShortcutBlocked(event)`: every global
  or canvas keydown handler starts with `if (isShortcutBlocked(event)) return;`.
  `use-global-shortcut.ts` — `useGlobalShortcut(spec, handler)` wraps it.

## 11. Raw → semantic mapping

| Raw | Semantic |
|---|---|
| `bg-white`/`bg-slate-50` + `dark:bg-slate-900/950` | `bg-surface-panel` (page bg → `bg-surface-app`) |
| `bg-slate-100` + `dark:bg-slate-800` | `bg-surface-raised`; section headers → `bg-surface-section` |
| hover `bg-slate-50/100` + `dark:hover:bg-slate-800` | `hover:bg-surface-hover` |
| selected rows (`bg-violet-50`, `bg-slate-200/700`) | `bg-surface-selected` |
| control fills `bg-slate-200` + `dark:bg-slate-700` | `bg-surface-control` |
| input backgrounds | kit `Input` / `Select` / `Textarea` (`bg-surface-input`) |
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
| rounded-full "core"/"read-only"/"Up to date" labels | `<Badge tone=…>` (2px) |
| `shadow-sm/md/lg/xl` | `shadow-float` (menus/popovers/toasts) or `shadow-dialog`; docked panels none |
| `rounded-lg/xl/2xl` | `rounded-control` / `rounded-float`; `rounded-full` only dots/avatars/spinners |
| `backdrop-blur-*` | remove (opaque panels) |
| `text-[8px]`/`text-[9px]`/`text-[9.5px]` | `text-2xs` |
| `fixed inset-0 bg-black/50` overlays | kit `Dialog` |
| text/borders over a canvas well | `text-well-text`, `text-well-text-muted`, `border-well-border`, `bg-well-surface` (or `EmptyState well` / `LoadingState well`) |
| domain colours (layers, nets, DRC severity, pin types, 3D) | keep, via named constants / tokens, tagged `/* domain-color */` |

## 12. The ratchet test

`src/core/frontend/src/ui-discipline.test.ts` scans `src/core/frontend/src`,
`src/shared/frontend` and `src/modules/*/frontend` (no tests, no `generated/`) and counts per
file: raw palette classes, `bg|text|border-white|black`, arbitrary hex `-[#…]`, native
`prompt/confirm/alert` calls, native `<select` outside the kit, `text-[<10px]`,
`backdrop-blur`, `shadow-md|lg|xl|2xl`. Lines tagged `/* domain-color */` are exempt. It fails
when any file's count for any rule exceeds `ui-discipline.baseline.json` (new files start at 0).

```sh
# lower the baseline after a migration (never raises an entry)
UI_DISCIPLINE_UPDATE=lower npx vitest run --config src/core/frontend/vitest.config.ts src/core/frontend/src/ui-discipline.test.ts
# rewrite from current counts (raises too — orchestrator only)
UI_DISCIPLINE_UPDATE=reset npx vitest run --config src/core/frontend/vitest.config.ts src/core/frontend/src/ui-discipline.test.ts
```

## 13. Package class strings

`@openpcb/r3f-eda-canvas` ships JSX with Tailwind class strings (preview overlays), so
`index.css` adds `@source "../../../../node_modules/@openpcb/r3f-eda-canvas/dist"` — without it
those classes are never generated and borders fall back to `currentColor` (T-264). Follow-up in
the package: use semantic token classes (or none) and default the preview background to
`var(--surface-canvas-well)` instead of `#131313`.
