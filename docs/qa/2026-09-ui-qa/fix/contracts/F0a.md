# Contract F0a — design-system foundation (exact API)

Read this instead of guessing. Everything below EXISTS. Kit barrel: `@shared/frontend/ui` (i.e.
`src/shared/frontend/ui/index.ts`; `@shared/frontend/ui/<file>` also works). Non-UI helpers
have their own paths (below). Nothing is mounted yet: `<Toaster/>`, `<DialogHost/>` and the
app `ErrorBoundary` must be mounted once near the app root (handed to F0b, see
"Adoption hand-offs") — until then `toast.*` queues silently and every
`confirmDialog`/`promptDialog` promise never settles (only a dev warning says so), so do not
ship a `window.confirm` replacement before the host is mounted.

## Tokens (utilities; values in `src/core/frontend/src/index.css`)

| Utility | Meaning |
|---|---|
| `bg-scrim` | modal backdrop (theme-aware) |
| `shadow-float` / `shadow-dialog` | menus·popovers·toasts·tooltips / dialogs. No `shadow-md/lg/xl` |
| `border-status-{danger,warning,success,info,neutral}-border` | 40% status stroke |
| `text-status-*` on `bg-status-*-soft` | AA (≥4.5:1) over every chrome surface up to `surface-raised`, both themes |
| `text-well-text`, `text-well-text-muted`, `border-well-border`, `bg-well-surface` | messages over a canvas well (dark in BOTH themes) |
| `bg-surface-schematic-canvas` | schematic editor bg (dark `#101012`, light `#f4f4f5`). JS: `getComputedStyle(document.documentElement).getPropertyValue("--surface-schematic-canvas")` |
| `bg-canvas` | = `--surface-canvas-well` (PCB clear colour). JS: read `--surface-canvas-well` |
| `outline-focus-ring` | focus ring colour (= selection) |
| `rounded` | now 2px (was 4px) |
| `row-actions` | CSS class: hover-revealed actions that also show on row `group` focus-within, own `data-state="open"`, and on no-hover devices. `<div className="group">…<div className="row-actions">…</div></div>` |

z-order: dialogs `z-50` < menus/popovers `z-60` < toasts `z-70` < tooltips `z-80`.
Global `:focus-visible` base rule draws the token ring on anything without its own
`outline-none` recipe.

## Focus / field recipes — `focus.ts`

```ts
export const FOCUS_RING: string;          // inset 1px ring, dense controls
export const FOCUS_RING_OUTSET: string;   // 1px ring outside, standalone/filled buttons
export const FIELD_BASE: string;          // field box: border-control, surface-input, text-xs
export const FIELD_FOCUS: string;         // element IS the field (focus-visible border + ring)
export const FIELD_FOCUS_WITHIN: string;  // wrapper CONTAINS the field
export const FIELD_INVALID: string;       // append after FIELD_FOCUS
export type ControlSize = "sm" | "md";    // 20px | 22px
export const CONTROL_HEIGHT: Record<ControlSize, string>;
```
`<button className={cn("h-[22px] px-2", FOCUS_RING)}>` — never `focus-visible:outline` alone
(Tailwind 4 keeps it invisible after `outline-none`).

## New primitives

**Input** — `Input(props: Omit<InputHTMLAttributes,"size"> & { size?: ControlSize; invalid?; mono?; leading?: ReactNode; trailing?: ReactNode; containerClassName? })`, forwardRef → `<input>`.
Without adornments the input is the box (`className` sizes it); with `leading`/`trailing` the
wrapper is the box (put widths in `containerClassName`).
`<Input aria-label="Name" value={v} onChange={(e) => setV(e.target.value)} />`
`<Input trailing="mm" containerClassName="w-24" … />`

**NumberInput** — forwardRef, props = Input props (minus value/onChange/type/min/max/step/trailing) +
`{ value: number | null; onDraftChange?(draft: string, parsed: number | null); min?; max?; step? (1); precision?; unit?; allowNegative? (true) }` and either
`{ onCommit(v: number) }` or `{ allowEmpty: true; onCommit(v: number | null) }`.
Commits on Enter/blur (clamped to min/max, rounded to precision; skipped if unchanged), Esc
reverts, ArrowUp/Down step (Shift ×10) the DRAFT (commit on Enter/blur), invalid draft shows
invalid and never commits (blur reverts it). Accepts `0`, negatives, `1,5`, typed unit.
`<NumberInput aria-label="Width" value={widthMm} unit="mm" min={0} step={0.1} precision={3} onCommit={setWidthMm} />`
Pure helpers (also exported): `parseNumberDraft(draft, { allowNegative?, unit? }) → {kind:"value",value} | {kind:"empty"} | {kind:"invalid",reason}`,
`clampNumber(v, { min?, max?, precision? })`, `stepNumber(v, 1|-1, { step?, large?, min?, max?, precision? })`,
`roundTo(v, precision?)`, `formatNumberValue(v | null, precision?)`.

**Field** — `Field({ label; htmlFor?; hint?; error?; required?; inline?; className?; children })`.
With `htmlFor` + a single child element it injects `aria-describedby` (`<id>-hint`/`<id>-error`)
and `aria-invalid`. `fieldMessageIds(id)` returns those ids.
`<Field label="Clearance" htmlFor="clr" error={err}><NumberInput id="clr" … /></Field>`

**Select** — generic `Select<T extends string>({ options: ReadonlyArray<{id: T; label: string; disabled?}>; value: T; onChange(id: T); size?; invalid?; placeholder?; containerClassName?; …native select attrs incl. aria-label, disabled, id })`, forwardRef → native `<select>`.
`placeholder` shows while `value` matches no option. Width goes in `containerClassName`.
`<Select aria-label="Lighting scene" options={SCENES} value={scene} onChange={setScene} containerClassName="w-40" />`

**Switch** — `Switch({ checked; onCheckedChange(b); label?; size?; disabled?; "aria-label"?; …button attrs })` → `<button role="switch" aria-checked>`; on = `bg-primary`.
`<Switch checked={snap} onCheckedChange={setSnap} label="Snap to grid" />`

**RadioGroup** — `RadioGroup<T extends string>({ options: {id; label; description?; disabled?}[]; value; onChange; name; orientation? ("vertical"); "aria-label"?; "aria-labelledby"?; disabled?; className? })` — native radios (arrow keys, one Tab stop).
`<RadioGroup name="units" aria-label="Units" options={UNITS} value={u} onChange={setU} />`

**Badge** — `Badge({ tone?: "neutral"|"info"|"success"|"warning"|"danger"|"outline"; icon?; caps?; mono?; …span attrs })` — static square 2px label. Use for "core"/"user", "read-only", "Up to date", "Caution". (`Pill` = status with dot; `Chip` = toggle button.)
`<Badge tone="success">Up to date</Badge>` · `<Badge tone="outline" caps>core</Badge>`

**Banner** — `Banner({ tone: "info"|"warning"|"danger"|"success"|"neutral"; title?; icon? (null hides); actions?; onDismiss?; compact?; floating?; children; …div attrs })`. Danger → `role="alert"`.
`floating` = opaque panel under the tint + float shadow (use for notices over the canvas).
`<Banner tone="danger" title="Export refused" actions={<Button size="sm" onClick={retry}>Retry</Button>}>{describeError(err)}</Banner>`

**EmptyState** — `EmptyState({ icon?; title; description?; actions?; size?: "sm"|"md"; align?: "center"|"start"; titleAs?: "p"|"h1"|"h2"|"h3"|"h4"; well?; …div attrs })`. THE empty pattern. Keep e2e headings with `titleAs` (e.g. "No design open" → `titleAs="h2"`).
`<EmptyState icon={<Search />} title="No parts match “zz”" description="Clear the search to see all parts." actions={<Button size="sm" onClick={clear}>Clear search</Button>} />`

**Spinner / LoadingState** — `Spinner({ size?: "sm"|"md"|"lg"; label? ("Loading"); className? })` (`role="status"`, reduced-motion static);
`LoadingState({ label? ("Loading…"); inline?; well?; className? })`.
`<LoadingState label="Loading components…" />` · `<LoadingState well label="Converting 3D model…" />`

**Kbd + shortcuts** — `Kbd({ keys: string | readonly string[]; …html attrs })`;
`formatShortcut(spec, { mac? })`: `"Mod+Shift+S"` → `"⌘⇧S"` (mac) / `"Ctrl+Shift+S"`; modifiers shown in the order written.
`matchesShortcut(event, spec, { mac? })`: exact modifiers (`"N"` ≠ ⌘N); Shift ignored for symbols unless named.
Letters/digits match the layout's character (QWERTZ Ctrl+Y is `Mod+Y`, never `Mod+Z`; AZERTY `q` ≠ `A`;
Dvorak `;` ≠ `Z`); `event.code` is used only when the layout gave no usable character — letters: a
non-ASCII one (macOS ⌥ symbols, non-Latin layouts); digits: not a letter/digit (AZERTY's unshifted row).
`parseShortcut(spec)`, `isMacPlatform()`. Spec syntax: `Mod|Cmd|Meta|Ctrl|Alt|Option|Shift` + key (`Escape`/`Esc`, `Enter`, `Space`, `Delete`, `ArrowUp`/`Up`, `F5`, `/`, `Mod++`).
`<Kbd keys="Mod+K" />` · `<Kbd keys={["G", "G"]} />`

**Dialog** — `Dialog`, `DialogTrigger`, `DialogClose` (Radix);
`DialogContent({ size?: "sm"|"md"|"lg"|"xl"|"full" ("md" = 32rem); showCloseButton? (true); onEscapeKeyDown?; onOpenAutoFocus?; …Radix content props })` — `bg-scrim`, `rounded-float`, `shadow-dialog`, `aria-modal="true"`, focus trap + return;
`DialogHeader({ title; description?; trailing? })` (34px bar, 12px/500 title = accessible name);
`DialogBody`, `DialogFooter` (right-aligned; primary last), `DialogTitle`, `DialogDescription`.
`src/core/frontend/src/components/ui/dialog.tsx` is a re-export shim.
```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent size="lg">
    <DialogHeader title="Design rules" />
    <DialogBody>…</DialogBody>
    <DialogFooter><Button onClick={close}>Cancel</Button><Button variant="primary">Save</Button></DialogFooter>
  </DialogContent>
</Dialog>
```

**confirmDialog / promptDialog / DialogHost** (`dialog-host.tsx`, store in `dialog-host-store.ts`)
```ts
confirmDialog({ title; description?; confirmLabel? ("Confirm"); cancelLabel? ("Cancel"); tone?: "default"|"danger" }): Promise<boolean>
promptDialog({ title; label?; description?; defaultValue?; placeholder?; confirmLabel? ("OK"); cancelLabel?; validate?(v): string | null; maxLength?; inputMode? }): Promise<string | null>  // NOT trimmed
cancelAllDialogs(): void; useDialogHostStore; <DialogHost/>  // mounted once by F0b
```
FIFO queue, one at a time; Enter confirms (focus on the primary button / the input), Esc,
× and scrim cancel. `if (!(await confirmDialog({ title: "Delete R3?", confirmLabel: "Delete", tone: "danger" }))) return;`
`const name = await promptDialog({ title: "Rename design", defaultValue: d.name, validate: (v) => v.trim() ? null : "Name is required" });`

**Toast** (`toast.tsx`, store in `toast-store.ts`)
```ts
toast.show({ tone?: "info"|"success"|"warning"|"danger"; title?; message; action?: { label; onClick }; durationMs?: number | null; id? }): string
toast.info|success|warning(message, opts?) / toast.error(message, opts?)  // error = tone "danger"
toast.dismiss(id); toast.clear();  <Toaster/>  // mounted once by F0b
```
Defaults: danger 8 s, others 4 s, `durationMs: null` = sticky; same `id` replaces (dedupe) and
restarts the timer; newest 3 visible; hover/focus pauses; region "Notifications", danger
`role="alert"`, others `role="status"`; bottom-right above the status bar.
`toast.error(describeError(err, "sync to cloud", { service: "OpenPCB Cloud" }), { id: "cloud-sync", action: { label: "Retry", onClick: retry } });`

**ErrorBoundary** — `ErrorBoundary({ scope: string; resetKeys?: readonly unknown[]; fallback?({ error, reset }); onError?(error, info); children })`;
`ErrorFallback({ error; reset; title?; compact? })` (Try again · Copy details · Reload, `role="alert"`);
`setErrorReporter(fn | null)` with `fn(error, { scope, componentStack? })`; `errorDetails(error)`.
`<ErrorBoundary scope="designer/pcb" resetKeys={[designId]}>…</ErrorBoundary>`

**Roving helper** — `nextRovingIndex({ key; current; count; orientation?; isDisabled? }): number | null`.

## Changed primitives (all backward compatible)

- `Button`, `IconButton`, `ToolbarButton`, `CanvasZoomCluster`, `Chip`, `TabsTrigger`, clickable
  `StatusSegment`, `PanelSectionHeader` toggle: visible token focus ring (`FOCUS_RING`; Button uses the outset one).
- `DockTabs`: one Tab stop, ArrowLeft/Right/Home/End move + select (automatic activation),
  new `idPrefix?: string` → tab `id` + `aria-controls`; pair the panel with
  `dockTabPanelProps(prefix, id)` (`{ id, role: "tabpanel", "aria-labelledby" }`), ids from `dockTabIds(prefix, id)`.
  `<div {...dockTabPanelProps("side", active)}>…</div>`
- `SegmentedControl`: still `role="group"` of `aria-pressed` buttons (e2e locators unchanged), now
  one Tab stop with ArrowLeft/Right/Home/End moving focus; Enter/Space select; container carries
  `data-roving-focus` so `isShortcutBlocked` leaves its arrows alone.
- `TableRow`: `interactive?: boolean` → `tabIndex 0`, Enter/Space fire `onClick` (only when the
  row itself is the target), focus ring, `aria-selected`, default `role="row"` (give the list
  `role="grid"`, or pass `role="option"` inside `role="listbox"`).
- `SearchField`: `autoComplete="off"` default; `aria-label` falls back to `placeholder`
  (always pass one); NEW `shortcut?: string` wires the key (focus + select, guarded, only the
  visible field) and renders `<Kbd>`; `shortcutHint` is now `@deprecated` (display-only).
  `<SearchField aria-label="Search parts" shortcut="/" value={q} onChange={…} />`
- `Checkbox`: `size?: "sm"|"md"` sets the label row height (omit = unchanged); focus ring on the box.
- `Textarea`: `invalid?: boolean`; field recipe (FIELD_BASE/FOCUS).
- `DropdownMenu`: added `DropdownMenuGroup`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`,
  `DropdownMenuRadioItem`, `DropdownMenuShortcut({ keys?: string } | children)`; exported recipe
  constants `MENU_CONTENT`, `MENU_ITEM`, `MENU_ITEM_DESTRUCTIVE` (use them for the app context
  menu so every menu shares one look). Menus now `z-60` + `shadow-float`; `ContextMenu*` uses the same recipe.
- `Tooltip`: `z-80`, `shadow-float`.

## Non-UI helpers

`src/shared/frontend/http/problem.ts` (`@shared/frontend/http/problem`)
```ts
class ApiError extends Error { status; code?; type?; title?; detail?; requestId?; body?; get diagnostic(): string }  // message is user-safe copy
apiErrorFromResponse(res: Response, fallbackMessage?): Promise<ApiError>   // problem+json, {error}, {error:{code,message}}, {ok:false,code}, {message}; x-request-id
apiErrorFromBody(status, body, requestId?): ApiError
isApiError(err); isNetworkError(err); isRetryableError(err); isSafeDetail(detail)
describeError(err: unknown, action?: string, { service?: string }?): string
CLOUD_UNREACHABLE_TYPE = "https://openpcb.dev/problems/cloud-unreachable"; CLOUD_UNREACHABLE; LOCAL_SERVICE_UNREACHABLE
```
`if (!res.ok) throw await apiErrorFromResponse(res);` … `setError(describeError(err, "delete part"))` → "Couldn't delete part: …".
Mapping: network failure (fetch's TypeError, "Failed to fetch"/NetworkError text re-thrown as a
string or plain Error, ApiError status 0) → "Can't reach <service>" when `service` is given
(browser fetched that remote directly, e.g. Open from Cloud → CLOUD_UNREACHABLE), else "Can't reach
the local OpenPCB service"; cloud problem type → CLOUD_UNREACHABLE; backend detail with an outbound
connect failure (incl. "failed to fetch …") → "Can't reach <service|the remote service> — …"
(`{ service: "OpenPCB Cloud" }` → CLOUD_UNREACHABLE); 400/422 → safe detail;
404 → safe detail or "Not found — it may have been deleted"; `REVISION_CONFLICT` → "The design
changed elsewhere — reload it and try again"; other 409 → safe detail; 413 → "File too large";
5xx → "Something went wrong in the local service (HTTP n)[: safe detail]"; legacy
`Error("HTTP 500")` is upgraded; stack traces / runtime strings never shown.
`isRetryableError`: network, cloud-unreachable, 408, 429, 5xx (not 4xx, not 409, not abort).

`src/shared/frontend/keyboard/shortcut-guard.ts`
```ts
isShortcutBlocked(event: { key; target; isComposing?; defaultPrevented? }, { allowInEditable?, doc? }?): boolean
isEditableTarget(target); isInsideOverlay(target); isModalOpen(doc?)
```
Blocked when: IME composing; target editable (text-like input, textarea, select,
contenteditable, role textbox/searchbox/combobox/spinbutton) unless `allowInEditable`; inside
`role` dialog/alertdialog/menu/menubar/listbox; any `[aria-modal="true"]` open; Enter/Space on
a button/link/tab/menuitem/option/checkbox/radio/switch/row or a native non-text `<input>`
(checkbox, radio, submit, button, reset, range, file, color — the kit Checkbox/RadioGroup);
Arrow*/Home/End/PageUp/PageDown inside `role` tablist/radiogroup/slider, a `[data-roving-focus]`
group (kit SegmentedControl), or on `<input type="radio|range">`; any of those Enter/Space/
navigation keys when `event.defaultPrevented` (an earlier handler consumed it). A plain
`role="group"` or a focused button does NOT take arrows (canvas nudge keeps working).
Event type: `{ key; target; isComposing?; defaultPrevented? }` — pass the real KeyboardEvent.
Custom roving widgets: put `data-roving-focus` on the container (or use tablist/radiogroup).
Trap: a listener that `preventDefault`s an arrow/Enter/Space only to stop scrolling, and runs
before a guarded handler for the same key, makes that key read as consumed. Capture-phase
window listeners run before React handlers, so they rely on the role checks, not `defaultPrevented`.
`const onKey = (e: KeyboardEvent) => { if (isShortcutBlocked(e)) return; … }`
A dialog's OWN key handling must not use the guard (its own modal would block it) — use
`isEditableTarget` there if needed.

`src/shared/frontend/keyboard/use-global-shortcut.ts`
```ts
useGlobalShortcut(spec: string | readonly string[], handler: (e: KeyboardEvent) => void | boolean, { enabled?, allowInEditable? }?)
```
Window keydown, exact `matchesShortcut`, guarded; skipped if `defaultPrevented`; handler returns
`false` to decline (no preventDefault). `useGlobalShortcut("N", () => createDesign(), { enabled: designerAvailable });`

## Ratchet

`src/core/frontend/src/ui-discipline.test.ts` + `ui-discipline.baseline.json`: a file may not add
raw palette / white-black / hex / native dialog / native select / sub-10px text /
backdrop-blur / heavy shadow. Tag true domain colours `/* domain-color */` on the line. Lower
after migrating: `UI_DISCIPLINE_UPDATE=lower npx vitest run --config src/core/frontend/vitest.config.ts src/core/frontend/src/ui-discipline.test.ts`.

## Adoption hand-offs (sites outside F0a's files)

F0a built the shared side of these entries; the listed sites are in other owners' files and are
named in no other brief, so F0a's report hands them over (`crossOwner`). Line numbers are from
2026-09-26 — find the pattern, not the line.

| Owner | Entry | Site | Need |
|---|---|---|---|
| F0b | T-004, T-014 | `App.tsx` / `AppShell.tsx` | Mount `<Toaster/>` and `<DialogHost/>` once near the root (next to the T-003 ErrorBoundary). |
| L1 | T-006 | `components/CloudLibrarySyncButton.tsx:58` | Keep the button label; `throw await apiErrorFromResponse(res)`; show `describeError(err, "sync the library", { service: "OpenPCB Cloud" })` in a tooltip or notice; Retry when `isRetryableError(err)`. |
| D3b | T-006 | `pcb/PcbAutorouteDialog.tsx:137,304`, `pcb/PcbAutoplaceDialog.tsx:193` | Error phase: `<Banner tone="danger">{describeError(e, "auto-route the board", { service: "OpenPCB Cloud" })}</Banner>` + Retry (re-submit) when `isRetryableError(e)`; Auto-place gets a footer. |
| D1 | T-006 | `components/CloudSyncBadge.tsx:83` | Toast text through `describeError(err, "sync to cloud", { service: "OpenPCB Cloud" })` (T-388 covers the badge, not this toast). |
| D1 | T-006 | `api.ts:88-96, 191, 671-679, 735` | `throw await apiErrorFromResponse(res)` instead of `new Error(problem.detail ?? "HTTP n")`, so status / problem type reach `describeError` / `isRetryableError`. |
| D4 | T-006 | `components/CloudDesignBrowser.tsx:70,92,215` | "Failed to fetch" → `describeError(err, "load cloud designs", { service: "OpenPCB Cloud" })` + Retry. |
| A1 | T-006 | `Space.tsx:487` | A failed run is not "paused": say it failed, reason via `describeError(…, { service: "OpenPCB Cloud" })`. |
| DB | T-006 | `backend/autoroute/client.ts:34,48,61`, `backend/autoplace/client.ts:34,48,61` | Catch connect failures / timeouts → `new AppError(<safe detail>, 503, "Can't reach OpenPCB Cloud", "https://openpcb.dev/problems/cloud-unreachable")` (`AppError` from `src/core/contracts/errors`). |
| LB | T-006 | `backend/cloud-sync.ts:66,110,167,182,192` | Same 503 `cloud-unreachable` mapping. |
| W4 | T-006 | `assistant/backend/cloud/cloud-context.ts:50` (unowned) | Same mapping. The brief's helper at `src/core/backend/http/cloud-fetch.ts` cannot be imported by modules (layer rule); a shared helper would live in `src/core/contracts/` (unowned). |
| D2 | T-008 | `OutlinePanel/OutlineRow.tsx:159` | Replace `opacity-0 … group-hover:opacity-100` with `row-actions` (row = `group`). |
| D3b | T-008 | `components/DesignerDrcView.tsx:430` | Same for "Waive (accept)". |
| D1 | T-008 | `components/DesignTabs.tsx:267` | Inactive-tab close × → `row-actions` (tab = `group`). |
| C1 | T-007 | `home/HomeSidebar.tsx:58,91`, `home/DesignCard.tsx:114,180` | `outline-none` without a ring → add `FOCUS_RING` (the global `:focus-visible` rule cannot reach `outline-none`). |
| L1 | T-007 | `LibraryCard.tsx:72` (`focus-visible:border-selection` on a borderless button = invisible), `FacetSidebar.tsx:186`, `ActiveFilterChips.tsx:69,82`, `TagChip.tsx:46,66`, `TagFilterChips.tsx:61`, `CloudLibrarySyncButton.tsx:110,123`, `PreviewModal.tsx:46`, `ComponentDetailPage.tsx:550,612`, `three-d/ThreeDComponentPreview.tsx:147` | `FOCUS_RING` (`FOCUS_RING_OUTSET` for the filled button). |
| D4 | T-007 | `DesignerBomView.tsx:355,371,655,662` (buttons), `:451` + `three-d/Board3DOverlay.tsx:222` (native selects) | `FOCUS_RING`; selects → kit `Select`. |
| D3a | T-007 | `pcb/PcbTopToolbar.tsx:67` (select), `:491,596`; `pcb/PcbLayerTabStrip.tsx:97` | `FOCUS_RING` / kit `Select`. |
| C2 | T-007 | `settings/panels/AssistantPanel.tsx:951,974` | Hand-rolled field/select with `outline-none` → kit `Input` / `Select`. |
| A2 | T-007 | `components/ModelSelectorPill.tsx:144,181,193,205` | Same → kit `Input` / `Select`. |
| D2 | T-014 | `components/LabelPicker.tsx:40` (power-port picker), `components/ComponentCommandPalette.tsx:288` | Kit `Dialog`/`DialogContent` recipe (surface-panel, `shadow-dialog`), focus trap + return to the trigger. (D3b T-150 names these files but does not own them.) |
| C2 | T-016, T-017 | `settings/panels/LibrariesPanel.tsx:384` (core/user pill), `:475` ("Up to date", `text-selection` pill); `AssistantPanel.tsx:586,591` (DEFAULT/LOCAL `Pill`) | Non-status labels → `<Badge tone="outline" caps>` / `<Badge tone="success">Up to date</Badge>`; no `rounded-full`. |
| L1 | T-017 | `components/LibraryTable.tsx:227`, `components/LibraryPreviewPane.tsx:95`, `ComponentDetailPage` header "CORE" | One source badge: `<Badge tone="outline" caps>` (T-266 covers only the 9.5px size). |
| D4 | T-017 | `components/DesignerBomView.tsx:778` (missing-MPN note) | `<Banner tone="warning" compact>`. |
| D3a | T-018 | `pcb/PcbLayerTabStrip.tsx:71-97`, `pcb/PcbLayersPanel.tsx` | Layer strip: roving tabindex + ArrowLeft/Right (`nextRovingIndex`); Layers list: one Tab stop, arrows between rows (eye/opacity reachable by arrow or shortcut). |
| D1 | T-018 | `components/DesignerRightDock.tsx` | `DockTabs idPrefix="dock"` + spread `dockTabPanelProps("dock", active)` on the panel (aria-controls). T-087 covers design tabs + view tablist name. |
| D2 | T-022 | `OutlinePanel/OutlineEmptyState.tsx` | Kit `EmptyState` (`align="start"`, `size="sm"`, `actions`). |
| K1 | T-022 | `components/Editor/PageEditor.tsx:215` | "No page selected" bordered card → kit `EmptyState` with one "New page" action. |
| L1 | T-264 | `components/LibraryPreviewPane.tsx` (detail error, ~:138) | Bare "Internal error" → `describeError` + Retry (`EmptyState well` or `Banner`). |

Already covered by the owner's own entry (use the kit there): T-002 guard — D3a T-133, C1 T-033,
C2 T-065, L2 T-309, D2 T-125; T-008 — A1 T-350 (`Space.tsx:1328`), K1 T-376 (`TreeItem.tsx:209`);
T-014 — D3b T-150 (rules/export/outline modals), C1 T-030 (Home delete); T-016 — A1/A2/A3 T-348
(bubble radii, assistant pills); T-017 — C2 T-062/T-075 (notes, read-only, Caution);
T-022 — C1 T-047, L1 T-259, D1 T-085, A1 T-336; T-284 — L1 (lead).
