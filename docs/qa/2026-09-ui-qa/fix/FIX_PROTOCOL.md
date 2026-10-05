# Fix protocol — UI QA hardening pass (binding for every implementer and reviewer)

Repo: `/Users/andrejvysny/workspace/openpcb/OpenPCB` (branch `master`). Read `CLAUDE.md` (repo root) first.
QA results: `docs/qa/2026-09-ui-qa/` (README, areas/*, data/triage-approved.json). Your work list:
`docs/qa/2026-09-ui-qa/fix/owners/<OWNER>.md`. The design-system contract: `fix/KIT_SPEC.md` (after wave F0a
it describes components that EXIST in `src/shared/frontend/ui` — read the actual code too).

## Goal
The app must read as a professional, consistent EDA/PCB tool (KiCad/Altium/Flux bar) in dark AND light
themes and be release-ready. Fix every approved entry in your brief completely — root cause, not the symptom —
and migrate every file you own to the design system while you are in it (Full depth: tokens + kit primitives).

## Hard rules
1. **Touch only your owned files** (see ownership table below). New files only inside your owned
   directories. If an entry needs a change in a file you do not own, implement your side against a clearly
   named interface and list the other side under `crossOwner` in your report (the entry's other owner gets
   the same entry and will do their part; co-owned entries say "shared" in your brief).
2. **Never run** `git add`, `git commit`, `git stash`, `git checkout`, `git reset`, `git restore`, or anything
   that rewrites the working tree/index. Other agents edit other files concurrently in this same checkout.
3. **Never start, stop or restart** servers (`npm run dev`, backends on 3100/3200/3300, Vite on 1520/1620/1720).
   Backend owners: the running `bun --watch` backends restart by themselves on file change — that is fine.
   Do not run Playwright e2e (the orchestrator does). You may run `playwright-cli` against stack A
   (`http://127.0.0.1:1520`) to look at things, but the running Vite may serve STALE modules for
   `src/modules/**` and `src/shared/**` edits — do not trust it for your own changes.
4. **Never edit** `node_modules/**` (incl. `@openpcb/*` packages), `src/shared/drc/**`, `docs/pcb-hardening/**`,
   the DRC engine, or generated files by hand (`src/core/frontend/src/generated/**` → only via `npm run gen`,
   and only if your ownership says so).
5. **Checks you run before reporting** (errors in files you do not own are someone else's in-flight work —
   ignore them, but say so):
   - `npm run typecheck:frontend` (core frontend only),
   - `npx tsc -p tsconfig.modules.json --noEmit --pretty false 2>&1 | grep -E "<your paths>"` (module
     frontends + backends are ONLY checked here) — no NEW errors in your files. Pre-existing baseline:
     `docs/qa/2026-09-ui-qa/data/gates/baseline-modules-set.txt`,
   - `npx vitest run --root src/core/frontend <your test files>` or `npm run test:react -- <pattern>` for
     frontend tests (Vitest only covers `src/core/frontend/src/**`, `src/modules/*/frontend/**`,
     `src/shared/frontend/**`); backend owners `cd src/core/backend && bun test <pattern>`.
6. **Preserve** (unless your entry explicitly changes it): every e2e-frozen accessible name / testid
   (list below), hotkeys, persisted localStorage keys, DnD MIME types, command/HTTP contracts.
7. A **new designer command field** must also be added to the `DesignerCommand` union
   (`src/sdks/designer/types.ts`) AND to the parser in `src/modules/designer/backend/routes.ts`, or it is
   silently dropped over HTTP.
8. **Tests:** add/extend unit tests for pure logic you add or fix (stores, parsers, formatters, geometry,
   reducers). No snapshot tests of whole screens.
9. **Style:** match surrounding code; explicit > clever; functions < 50 lines where practical; comments only
   for "why"; no `any`; no new abstractions without two call sites; no dead code left behind (remove
   replaced helpers, unused props, stubs).

## Design-system rules (apply to every file you touch)
- **Colours only via semantic tokens** (`bg-surface-*`, `text-text-*`, `border-border*`, `text-status-*`,
  `bg-status-*-soft`, `border-status-*-border`, `bg-primary`, `text-selection`, `bg-scrim`…). No raw Tailwind
  palette classes (`slate/gray/zinc/violet/blue/red/amber/emerald/…-NNN`, `bg-white`, `text-black`,
  `bg-black/40`), no hex in className/style — except true DOMAIN colours (PCB layer colours, net-class
  colours, 3D materials, pin-type colours) which must come from a named constant or `--color-layer-*`/
  `--color-net-*` token and be tagged `/* domain-color */` on the line.
- **Geometry:** flat. `rounded-control` (2px) for controls, `rounded-float` (3px) for menus/popovers/toasts/
  dialogs, `rounded-full` only for dots/avatars/spinners. No `shadow-md/lg/xl` (use `shadow-float` /
  `shadow-dialog`; docked panels have none). No `backdrop-blur`, no gradients.
- **Sizes:** header bars 34px; panel/section headers 24px; list/table/property rows 22px (Home list 64px);
  controls 22px (`size="sm"` 20px). Text ≥ 10px (`text-2xs` = 10px is the floor; `text-xs` 11px default
  body in dense chrome, `text-sm` 12px, `text-base` 13px titles). Icons: lucide `size={14}` (toolbar 16),
  `strokeWidth={1.5}` everywhere.
- **Controls:** use kit primitives — `Button`/`IconButton`/`ToolbarButton`, `Input`, `NumberInput`, `Select`,
  `Checkbox`, `Switch`, `RadioGroup`, `SegmentedControl`, `SearchField`, `Tabs`/`DockTabs`, `DropdownMenu`,
  `ContextMenu`, `Tooltip`, `Dialog` (+`confirmDialog`/`promptDialog`), `toast`, `Banner`, `EmptyState`,
  `Spinner`/`LoadingState`, `Kbd`, `PropertyGrid`/`PropertyRow`, `PanelSectionHeader`, `TableRow`/
  `TableHeaderRow`. No hand-rolled `<select>`, `<input>`, overlay `fixed inset-0` modals, or outside-click
  popovers when a kit equivalent exists.
- **Never** `window.prompt`, `window.confirm`, `window.alert` → `promptDialog` / `confirmDialog` / `toast`.
- **Errors:** user-facing error text goes through `describeError(err, action)` from
  `src/shared/frontend/http/problem.ts` (never raw "HTTP 500", "Failed to fetch", "Internal error", stack
  traces). Every failure path is visible (toast or inline `Banner` with Retry where it makes sense); no
  silent `catch {}` on user actions.
- **Keyboard:** every global/canvas keydown handler starts with `if (isShortcutBlocked(event)) return;`
  (`src/shared/frontend/keyboard/shortcut-guard.ts`). Every interactive element is reachable by keyboard
  and shows a visible focus ring (`FOCUS_RING` / `FIELD_FOCUS`). Dialogs trap focus and return it.
- **States:** every async surface has loading, empty, error (with retry) states using the kit components.
- **Copy:** sentence case, concise, truthful (no claims the code does not honour), `…` not `...`.
- **Light + dark:** verify both; canvas wells are always dark (`--surface-canvas-well`) — text/borders
  inside wells must use well-appropriate tokens.

## Ownership map (strict)
| Owner | Files |
|---|---|
| F0a | `src/core/frontend/src/index.css`, `src/shared/frontend/ui/**`, new `src/shared/frontend/http/**`, new `src/shared/frontend/keyboard/**`, `src/core/frontend/src/components/ui/**`, `docs/design/design-tokens.md`, new `src/core/frontend/src/ui-discipline.test.ts` + `ui-discipline.baseline.json` |
| F0b | `src/core/frontend/src/{App,AppRouter,AppShell,main}.tsx`, `sentry.ts`, `src/core/frontend/src/{providers,bootstrap,canvas}/**`, `src/core/frontend/src/components/{AppContextMenu,ModuleSpaceHost}.tsx`, `src/shared/frontend/context-menu/**`, `src/modules/designer/frontend/hooks/use-toast.tsx`, `src/core/frontend/index.html`, new `src/core/frontend/public/**` |
| G | new `src/modules/designer/frontend/{lib/grid.ts,stores/grid-prefs.ts(+test),hooks/use-grid-hotkeys.ts}`; grid/snap-related edits only in `components/SchematicCanvas.tsx`, `pcb/PcbCanvas.tsx`, `pcb/PcbScene.tsx`, `pcb/snap.ts`(+spec), `components/DesignerStatusBar.tsx`, `Space.tsx`; backend grid constants: `src/modules/designer/backend/layout/{schematic-autoplace,body-extent}.ts`, `src/modules/assistant/backend/tools/designer-tools.ts`, `src/shared/schematic-routing/{manhattan,segment-drag}.ts` (+ their tests under `src/core/backend/tests/`); `tests/e2e/grid-snap.spec.ts` (new) + coordinate fixes in existing e2e specs |
| DB | `src/modules/designer/backend/**` (except G's two layout files), `src/sdks/designer/**`, `src/core/backend/tests/designer-*` / new designer tests, generated SDK stubs via `npm run gen` |
| LB | `src/modules/library/backend/**`, `src/sdks/library/**`, `src/core/backend/tests/library-*` / new library tests, generated stubs via `npm run gen` |
| C1 | `src/core/frontend/src/screens/{HomeScreen,ModuleScreen}.tsx`, `src/core/frontend/src/screens/home/**`, `src/core/frontend/src/components/{LeftSidebar,TitleBar,ThemeToggle,icon-resolver}.*` |
| C2 | `src/core/frontend/src/screens/SettingsScreen.tsx`, `src/core/frontend/src/settings/**`, `src/core/frontend/src/cloud/**` |
| D1 | `src/modules/designer/frontend/{Space.tsx,api.ts,index.ts,types.ts,useDesignerHighlight.ts}`, `hooks/**`, `stores/**`, `lib/**` (not G's grid files' logic), `components/{DesignerHeader,DesignTabs,DesignerSidebar,CollapsibleSection,DesignerStatusBar,DesignerEmptyState,DesignerPlaceholderView,DesignerRightDock,CloudSyncBadge,CloudPresenceIndicator}.tsx` |
| D2 | `src/modules/designer/frontend/components/{SchematicCanvas,SchematicPrimitivesLayer,DesignerFloatingToolbar,LabelPicker,ComponentCommandPalette,ComponentClassIcon,DesignerErcView}.tsx`, `components/OutlinePanel/**`, `components/SelectionInspector/**`, `components/comments/**` |
| D3a | `src/modules/designer/frontend/pcb/**` EXCEPT D3b's files |
| D3b | `src/modules/designer/frontend/components/{DesignerDrcView,PcbDesignRulesDialog}.*`, `pcb/{PcbExportDialog,CornerOpModal,EdgeDimModal,PcbAutorouteDialog,PcbAutoplaceDialog,PcbPlacePreviewBar,use-pcb-design-rules-dialog}.tsx`, `pcb/import/**`, `pcb/autolayout/**` |
| D4 | `src/modules/designer/frontend/three-d/**`, `components/{DesignerBomView,KicadProjectImportWizard,CloudDesignBrowser}.tsx` |
| L1 | `src/modules/library/frontend/{Space,LibraryCard,ComponentDetailPage,detail-helpers,utils,types,index,tag-grouping}.*`, `src/modules/library/frontend/{components,hooks,lib,three-d}/**` |
| K1 | `src/modules/knowledge/frontend/**`, `src/modules/tasks/frontend/**`, `src/modules/tasks/manifest.json` (+ `npm run gen` for the registry) |
| L2 | `src/modules/library/frontend/import-wizard/{ImportWizardPage,WizardProgressBar,import-api,index,useImportWizardStore,model-conversion}*`, `import-wizard/steps/**` except `SymbolStep`/`FootprintStep`, `import-wizard/components/**` except `FootprintPresetPicker`, `import-wizard/layout/**` |
| L3 | `import-wizard/steps/SymbolStep.tsx`, `import-wizard/editor/**` |
| L4a | `import-wizard/steps/FootprintStep.tsx`, `import-wizard/components/FootprintPresetPicker.tsx` |
| L4b | `import-wizard/footprint-editor/**` |
| A1 | `src/modules/assistant/frontend/{Space.tsx,index.ts}`, `src/modules/assistant/frontend/{hooks,lib,types,cloud}/**` |
| A2 | `src/modules/assistant/frontend/DesignerChatDock.tsx`, `components/{ChatComposer,MentionAutocomplete,MentionBadge,MessageTextWithMentions,ModelSelectorPill,PromptPresetPicker,ProviderCapabilityBadge,SourceChip,chat-format,useChatUserState,useSymbolThumbnails}.*` |
| A3 | `src/modules/assistant/frontend/components/{MessageCard,GenericProposalCard,CopilotPlanCard,PlacementProposalCard,BomResultCard,ComponentResultCard,ToolCard,AssistantRunStatusCard,component-type}.*`, `src/shared/frontend/{markdown,assistant}/**` |
| W4 | anything in-scope left unowned after W2/W3 + `tests/e2e/**` (except `grid-snap.spec.ts`) |

## e2e-frozen names (keep exact)
Buttons: "Route (R)", "Tune (U)", "Board (O)", "Flip part", "Undo", "Redo", "Fit schematic", "Fit board",
"Import outline", "Import DXF…", "Draw custom shape…", "Redraw shape…", "Reset to rectangle",
"New Design"/"New design", "Designer", "Library", "Edit", "Preview…", "Link to Cloud…", "Open from Cloud…",
"Import to local & open", "Run Auto Layout", "Apply candidate"; dialog "Auto Layout"; tabs "Schem"/"PCB";
headings "Designs", "Settings", "No design open"; label "Settings"; texts "Route — click a pad to start",
"100% routed", "Untitled Design", "Custom shape", "Alternatives", "Recommended", "Keep current placement",
"Auto Layout applied"; every `data-testid` that exists today (grep `tests/e2e` before renaming anything).

## Report (your final answer, JSON)
`{"owner":"..","files":["..."],"entriesDone":["T-..."],"entriesPartial":[{"tid":"T-..","why":".."}],"entriesSkipped":[{"tid":"T-..","why":".."}],"crossOwner":[{"to":"D1","tid":"T-..","need":".."}],"testsAdded":["..."],"checks":{"typecheckFrontend":"pass|fail: ..","modulesTscOwnFiles":"clean|<errors>","tests":".."},"notes":".."}`
