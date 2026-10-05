[← index](README.md)


# Coverage per QA charter

Each charter's checklist with per-theme status, known-finding verdicts and untested items (as reported by the QA agent).

## f1a

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Latency shim first-render: Schem (No design open + Empty design flash), PCB (Loading PCB + Components 0 + 0 DRC), 3D (spinner card), BOM (Loading + zero counters/Synced), DRC full view (raw ?.1 / net pt:… labels), DRC dock, ERC dock (Running…) | tested | tested | 1440x900 |
| No-latency flash measurement of No design open/Empty design (~50 ms) | n/a | tested | 1440x900 |
| Race: double-click Run DRC under latency (2 POST /drc/runs, no pending state) | tested | n/a | 1440x900 |
| Race: toolbar Undo 3x fast under latency (2 applied, 3rd HISTORY_EMPTY silent, no pending UI) | tested | n/a | 1440x900 |
| Race: drag PCB part then another before first resolves (REVISION_CONFLICT, snap-back, 2/2) | tested | n/a | 1440x900 |
| Race: BOM MPN typing + line switch within debounce (lost), with PATCH in flight (lands on right refdes; truncation when a save returns mid-typing), view switch within debounce (lost) | tested | tested | 1440x900 |
| Race: Export Download double-click under latency (guarded, 1 request) | tested | n/a | 1440x900 |
| Race: press N twice on Home (2 designs created) | tested | n/a | 1440x900 |
| Commands 500: schematic move, wire, PCB move, route commit, via, delete, flip; error surfaces; rollback; server diff after unroute (no divergence, rev unchanged) | tested | tested | 1440x900, 1100x720 |
| Offline mid-edit: PCB move/route/delete, schematic Value edit, comment post; back online recovery without reload; revision compare | tested | n/a | 1440x900 |
| K41 DRC view: projection/pcb 500 (labels unresolved, Edit rules disabled), GET /drc 500 ('Run DRC to validate' + 0 DRC), POST /drc/runs 500, report GET 500 after run; full view + dock + toolbar (toolbar DRC is a dock toggle, not a runner) | tested | tested | 1440x900 |
| ERC run with /erc 500 | tested | n/a | 1440x900 |
| Design rules Save & re-run: commands 500 (unhandled rejection, no UI error) and stale revision (silent drop) from DRC full view and PCB DRC dock | tested | n/a | 1440x900 |
| Export dialog Download: export 500, offline, recovery after online | tested | n/a | 1440x900 |
| Board panel Import DXF… with sample.txt and garbage.step | tested | n/a | 1440x900 |
| PCB view opened with projection/pcb 500 ('PCB projection unavailable', not endless; recovers only on view switch) | tested | n/a | 1440x900 |
| K10 toast: error (palette placement 500) + warning (BOM line without placement → PCB); DOM role/aria-live, dismiss name/size, blur/shadow, 3 s lifetime, covered controls, pixel probes | tested | tested | 1440x900, 1100x720 |
| White-screen check after injections (snapshot non-empty, console errors = injected 500s + 2 unhandled rejections: comment post, rules save) | tested | tested | 1440x900 |
| Error strips/toasts at 1100x720 | tested | tested | 1100x720 |
| Cleanup: unroute all, network online, __qaDelay=0, sessions f1a-dark/f1a-light closed | tested | tested | 1440x900 |

Known findings: K10 confirmed; K41 confirmed; K09 partial; K40 partial; K01 partial

Untested:
- Cloud-linked design offline behaviour — Stack A has cloud off; covered by Q10 on C1
- 3D view under request failure — 3D only shows loading card under latency; 3D failure state already covered by Q5-033
- Light-theme repeats of races/offline flows — Behavioural (theme-independent); light used for first-render, K10, K41, command-failure strip/toast and BOM view-switch loss

## f1b

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Seed QA-f1b-stress through backend 3100 (≥150 place_part, ~60 create_wire, outline, ~20 traces) | tested | n/a | n/a |
| Time to first render per view on 150 parts | tested | n/a | 1440x900 |
| FPS: schematic wheel/pan/part drag (150 parts) | tested | n/a | 1440x900 |
| FPS: PCB wheel/pan/drag (150 parts, 784 DRC markers) | tested | n/a | 1440x900 |
| FPS: 3D orbit/zoom | tested | n/a | 1440x900 |
| Box-select all → Delete → count Undo steps (Q3-011 at scale) | tested | n/a | 1440x900 |
| Outline with 150 rows: scroll, filter, sort, dblclick frame | tested | tested | 1440x900 |
| PCB: ratsnest, Fit board, Fit to parts, drag, Layers/Components panel | tested | tested | 1440x900, 1100x720 |
| DRC run time + hundreds/thousands of violations (scroll, click-to-frame, severity toggles) | tested | n/a | 1440x900 |
| ERC dock with many violations | tested | n/a | 1440x900 |
| BOM 150 lines: select all, bulk DNP, Export CSV, search latency | tested | tested | 1440x900, 1100x720 |
| Input latency >1 s / UI freezes | tested | n/a | 1440x900 |
| Long text: 200-char Value, 120-char MPN/Manufacturer, 300-char Datasheet URL, refdes R123456789, 80-char net label, 120-char design name, long PCB overlay text (K02 prompt accepted) | tested | tested | 1440x900, 1100x720 |
| Long text: Outline columns, canvas overlap, BOM table+inspector, PCB Components panel, DRC messages, 3D refdes, Export-dialog warning list, status bar, Home | tested | tested | 1440x900, 1100x720 |
| 60-char net class name | blocked | blocked | 1440x900 |
| Export content audit: Gerber layer set/names | tested | n/a | n/a |
| Export content audit: Excellon vs vias+THT | tested | n/a | n/a |
| Export content audit: PnP rows/side/rotation/units | tested | n/a | n/a |
| Export content audit: BOM CSV grouping vs BOM view | tested | n/a | n/a |
| Export with no parts / no outline on fresh QA-f1b design | tested | n/a | 1440x900 |
| Export naming / 4-layer option | tested | tested | 1440x900, 1100x720 |
| Net classes: add class, assign nets, Save, route width chip | tested | tested | 1440x900 |
| Net classes: invalid values (0, negative, >1 mm clearance, 999) | tested | n/a | 1440x900 |
| Length group → Tune (U) target prefill | tested | tested | 1440x900, 1100x720 |
| Net classes / groups reload persistence | tested | tested | 1440x900 |
| Design rules dialog at 1100x720 | tested | n/a | 1100x720 |
| Light probes: Tune HUD | tested | tested | 1440x900 |
| Light probes: Measure (M) readout | tested | tested | 1440x900 |
| Light probes: overlap picker (Alt+click) | blocked | blocked | 1440x900 |
| Light probes: copper-fill rows in Layers panel | tested | tested | 1440x900 |
| Light probes: PCB comment thread popup | tested | tested | 1440x900 |
| Light probes: schematic Outline Actions menu, BOM Export ▾ menu | tested | tested | 1440x900 |
| Light probes: DRC marker tooltip | tested | tested | 1440x900 |
| 3D with long text / board silkscreen | tested | tested | 1440x900 |
| Console during stress (WebGL context lost, long tasks, errors) | tested | tested | 1440x900 |

Known findings: K30 confirmed; K02 confirmed; K43 partial; Q3-011 confirmed; Q4-016 confirmed; Q4-025 confirmed; Q5-023 confirmed; Q3-004 partial

Untested:
- 3D perf on non-Apple GPU — only headless Chromium on Apple M4 Pro (ANGLE Metal) available
- Bottom-side PnP rotation convention vs JLCPCB 3D preview — needs the fab's viewer; file shows Rotation 90 / Layer Bottom for a flipped 90° part
- Custom… trace width prompt (K03) with net classes — owned by the PCB agent; not repeated

## f1c

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Settings → Libraries: install beta.1 (reinstall), beta.2 (upgrade), beta.1 (downgrade), beta.2 ×2 (idempotent): progress/feedback, core card version, sources table | tested | tested | 1440x900, 1100x720 |
| Library header counts/facets update without reload after install/remove | tested | tested | 1440x900 |
| Remove source (K06 native confirm → accept) and check Library list + existing design parts | tested | n/a | 1440x900 |
| Crafted-pack edge cases: pack without kind, pack reusing core ids | tested | n/a | 1440x900 |
| Invalid / tampered .opclib install errors | n/a | tested | 1440x900 |
| N2 / Library→design placement path: MIME code check + synthetic DragEvents (both MIMEs) + real HTML5 drag | tested | n/a | 1440x900 |
| Long-text part via wizard (200-char name, 300-char description, 26 tags): table, grid, preview, detail, fullscreen, Cmd+K palette, inspector, BOM | tested | tested | 1440x900, 1100x720 |
| Library true empty state (fetch shim {ok,data:{components:[]}} + empty facets) | tested | tested | 1440x900, 1100x720 |
| Library with 100 synthetic long-named items (table + grid) | tested | n/a | 1440x900 |
| 2.5 s delay shim: list, preview pane and detail loading states | tested | tested | 1440x900 |
| Detail save error: PATCH 500 (problem+json and empty body) and offline | tested | n/a | 1440x900 |
| Keyboard-only wizard walk (Symbol → Footprints → 3D → Metadata → Import) | tested | partial | 1440x900 |
| Settings at scale: 10 providers with 126-char labels, default-provider select, 1100x720, cleanup | tested | tested | 1440x900, 1100x720 |
| Library search consistency (found while navigating) | tested | tested | 1440x900 |
| DOM census + console per screen | tested | tested | 1440x900 |

Known findings: N2 confirmed; K06 confirmed; K43 confirmed; K40 confirmed; K21 confirmed; K34 partial; K36 confirmed; K44 confirmed; K07 confirmed; Q6-016 premise refuted

Untested:
- Real cross-space drag from a Library row onto the schematic — Impossible by design: Library and Designer are separate full-screen spaces with no spring-loaded rail. Simulated with synthetic events and an injected native drag source instead
- Long MPN/manufacturer in the Library (table/detail) — Neither the wizard nor PATCH /components accepts manufacturer/MPN; tested on the placed instance (inspector/BOM) instead
- Light-theme repetition of the source-remove and synthetic drop flows — Theme-independent behaviour; the visual states were captured in dark

## f1d

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Latency 2.5 s + in-memory nav Home→Docs→Assistant→Settings General/Libraries/About→Tasks, first-render screenshots | tested | tested | 1440x900 |
| Flashes of misleading empty states / missing spinners / layout jumps | tested | tested | 1440x900 |
| Assistant send before config load (captured+blocked POST) | tested | n/a | 1440x900 |
| Home 300 designs: list+grid render, rAF scroll FPS, sort (Name), search, filters, detail panel, status count | tested | tested | 1440x900, 1100x720, 1920x1080 |
| Assistant 200 chats + 120-msg chat: sidebar scroll, filters, multi-select bar, header truncation, 'Loading older messages' pagination (3 pages), 10k msg/wide code/30-col table | tested | tested | 1440x900, 1100x720 |
| Docs 300 pages 8 deep: tree scroll, indentation vs truncation, expand/collapse, search results, breadcrumb | tested | tested | 1440x900, 1100x720 |
| Recovery without reload after 500 on Home / Docs tree / Assistant chats / Settings sources | tested | tested | 1440x900 |
| Census on mocked many-item screens | tested | tested | 1440x900, 1100x720 |
| Console errors | tested | tested | 1440x900 |
| Native dialog calls | tested | tested | 1440x900 |

Known findings: K40 confirmed; K32 confirmed; K25 confirmed; K36 confirmed; K42 confirmed; K45 partial

Untested:
- Tasks 500 recovery — known white-screen (Q9-022); skipped to avoid a React crash mid-session
- Physical wheel/trackpad scrolling of the assistant thread — playwright-cli mousewheel dispatched no wheel events in this setup; programmatic scrollTop used instead (same IntersectionObserver path)

## f2a

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Home: N creates design, double-click tab rename to QA-f2a-golden | tested | n/a | 1440x900 |
| Cmd+K place 555, 2+ resistors, 2 caps, LED, 2-pin header (8 parts) | tested | tested | 1440x900 |
| G (GND) and P (VCC) ports; wiring pin→corner→pin, 7 nets | tested | n/a | 1440x900 |
| ERC run + deliberately open pin (CONT) reported? | tested | n/a | 1440x900 |
| Board 40×30 via Board panel Width field + Apply | tested | n/a | 1440x900 |
| Drag parts onto board, R rotate, F flip to bottom | tested | n/a | 1440x900 |
| Route all ratsnest with R: 2 layers, 5 vias (V), W/Shift+W width, delete+reroute, Split and reroute | tested | tested | 1440x900, 1100x720 |
| How user knows routing complete | tested | n/a | 1440x900 |
| Z pour on B.Cu via area-tool-options (layer/net/pads thermal→solid→thermal), pour-aware ratsnest, thermal spokes, non-GND clearance | tested | tested | 1440x900, 1100x720 |
| Copper-fill toggle, Remove redundant pour traces, K keepout (fill recedes), Shift+Z cutout | tested | n/a | 1440x900 |
| DRC from dock to 0 errors, unrouted connection flagged, waive one warning, rerun after pour | tested | tested | 1440x900 |
| Export dialog DRC gate, BOM+PnP, Download, unzip, fab-file audit | tested | n/a | 1440x900 |
| 3D finished board: pour, traces, bottom part, refdes | tested | tested | 1440x900 |
| Reload: tabs/view/camera restore; Cmd+Z PCB, toolbar Undo/Redo schematic across reload | tested | n/a | 1440x900 |
| Schematic part move → GND zone net orphaned? (F1B-013 extension) | tested | n/a | 1440x900 |
| Route + pour repeat at 1100×720 and light; pixel probes of route rows, area-tool-options bar, pour/thermal colours | tested | tested | 1440x900, 1100x720 |

Known findings: Q3-014 confirmed; Q6-023 confirmed; F1B-013 partial; F1B-002 confirmed; F1B-009 confirmed; F1B-033 confirmed; Q4-004 confirmed; Q4-001 confirmed; Q4-023 confirmed; Q3-006 confirmed; F1B-014 confirmed; F1B-017 confirmed; Q4-006 confirmed; Q4-003 confirmed; Q3-004 confirmed; Q4-041 confirmed; Q4-042 confirmed; F2B-010 partial; Q4-043 confirmed; Q4-017 confirmed; K37 confirmed; K38 confirmed; Q5-028 confirmed; Q3-028 confirmed; F1A-010 confirmed; F2B-011 confirmed; K12 untested; K44 confirmed; N1 untested; F1B-019 untested; Q3-015 n/a; spike/Q4-001 confirmed

Untested:
- O-key board sketch — used Board panel Width field (charter allows either)
- Export with DRC errors present (gate blocking) — covered by F2B-008; golden board was error-free at export time
- QA-f2a-scratch design — not needed; light/1100 repeats done on golden with Undo

## f2b

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Build 4L/6L/blind fixtures outside the repo | tested | n/a |  |
| Import 2L/4L/6L/blind via Home → Import KiCad…; review step (layer count, warnings), result | tested | tested | 1440x900 |
| Fidelity 2L/4L: footprints, segments, vias, zones, nets vs kicad_pcb, /projection/pcb, UI | tested | n/a | 1440x900 |
| 4L layer tab strip In1/In2 | tested | tested | 1440x900, 1100x720 |
| Layers panel rows + inner-layer colour distinctness (probe) | tested | tested | 1440x900 |
| Layer keys 1/2/3/4, PgUp/PgDn | tested | n/a | 1440x900 |
| Alt+click solo on inner layer | tested | n/a | 1440x900 |
| Dim/Hide display modes | tested | n/a | 1440x900 |
| Board panel Stackup | tested | tested | 1440x900 |
| 3D stackup and thickness | blocked | n/a | 1440x900 |
| 4L routing: R, key 3, layer-pair chip + options, V via continues on pair layer, commit | tested | n/a | 1440x900, 1100x720 |
| Zone on In2 (Zone layer list) | tested | tested | 1440x900 |
| DRC on 4L | tested | n/a | 1440x900 |
| Undo/redo of route | tested | n/a | 1440x900 |
| 4L export with inner layers | tested | n/a | 1440x900 |
| 4L export with inner box unchecked | tested | n/a | 1440x900 |
| 6L: In3/In4 reach (tabs/keys/panel), route on In3 | tested | tested | 1440x900, 1100x720 |
| 6L export 422 'Unsupported layer count' UX | tested | tested | 1440x900 |
| Blind via: render, inspector type, DRC | tested | n/a | 1440x900 |
| Blind via export 422 'Unsupported via type' + locate via | tested | tested | 1440x900 |
| DRC on imported 2L: totals by type + ≥3 spot checks | tested | n/a | 1440x900 |
| 1100×720: 6-layer strip overflow cue; route row with layer-pair chip | tested | tested | 1100x720 |
| Console / native dialogs | tested | tested | 1440x900 |

Known findings: K30 confirmed; Q5-019 confirmed; Q5-020 confirmed; Q5-021 confirmed; Q5-029 confirmed; Q4-011 confirmed; Q4-013 confirmed; F1B-001 confirmed; Q4-041 partial; Q4-042 confirmed; Q4-005 confirmed; Q4-016 confirmed; Q4-006 confirmed; Q4-025 confirmed; Q4-023 confirmed; Q4-009 confirmed

Untested:
- 3D inner-layer stackup rendering — imported boards render off-screen in 3D (Q5-020)
- Routing on In3/In4 (6L) — no UI path to select or see In3/In4 (F2B-007)
- Light-theme routing/DRC interaction on 4L — time-boxed; theme-independent logic verified in dark, light used for rendering/dialog checks

## f2c

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Settings › Assistant read-only: default provider oMLX (unreachable) shows 'Active' + green dot | tested | n/a | 1440x900 |
| Assistant space: New chat → 'hello' to unreachable oMLX (feedback in ~1.1 s: only 'Retrying … chat-only mode', no error/Retry/settings link; task 'completed') | tested | tested | 1440x900, 1100x720 |
| First-run empty chat list (simulated GET /chats → []): welcome state + green default pill, no provider guidance | n/a | tested | 1440x900 |
| Model pill → OpenAI (no key) → send: 400 'API key required for provider: OpenAI', no CTA, Retry = resend 400; banner off-screen in long chat | tested | tested | 1440x900, 1100x720 |
| Dock Cmd+I on Schem + PCB: send to unreachable provider; OpenAI no-key in dock | tested | tested | 1440x900, 1100x720 |
| Dock with hung local provider (black-hole listener on :8000): Working…/Stop, Stop, reload mid-run, second send, queue, no timeout (6m51s) | tested | n/a | 1440x900 |
| Assistant space chat selection after 'Open in Assistant view' (jumps back on refresh) | tested | n/a | 1440x900 |
| Runtime theme switch via Settings Dark→Light→Back on Schem/PCB/3D/Library list+detail/wizard draw/Assistant/Docs vs fresh-reload baseline (pixel diff: identical) | tested | tested | 1440x900 |
| Runtime theme switch Light→Dark via Settings vs fresh dark (identical); Settings screen runtime vs fresh (identical) | tested | tested | 1440x900 |
| System preference + live OS scheme change (emulateMedia) with Schem/PCB/Library/menu mounted — schematic palette stuck | tested | tested | 1440x900 |
| Portalled menu (Library 'Component actions') during live theme switch → --menu-bg follows | tested | n/a | 1440x900 |
| Library list GET 500: first open, search keystroke, facet toggle; unroute + recovery | tested | tested | 1440x900, 1100x720 |
| Library /facets 500: silent empty rail + wrong counts; recovery on search | tested | n/a | 1440x900 |
| Comments: 2000-char body, unbroken 300-char URL (wraps OK), 25 replies (opens at top, reply not scrolled), 31 threads (crowding, edge clipping, offscreen chips), latency (<2 ms API) | tested | tested | 1440x900, 1100x720 |
| Comments list GET 500 on design open: silent, no retry; post during failure; unroute recovery needs view switch | tested | n/a | 1440x900 |
| Drag a comment pin (works, persisted; thread updatedAt not bumped) | tested | n/a | 1440x900 |
| Popup near right edge at 1100 flips left (OK); wheel over popup scrolls popup not canvas (OK) | tested | n/a | 1100x720, 1440x900 |
| Light contrast probes: assistant warning text (#364153 OK), pill dot raw emerald, comment popup meta 10px #a8a8ad on white (same as F1B-023) | n/a | tested | 1440x900 |

Known findings: K08 confirmed; Q10-016 (dock 'Working…' forever, cloud) partial; Q8-024 partial; Q8-017 confirmed; Q8-018 confirmed; F1B-023 confirmed; Q3-006 confirmed

Untested:
- Toasts during a live theme switch — No toast trigger was available without extra library mutations. Toasts use dark: classes that follow the <html> class, so the risk is low.
- Changing provider base URL/keys to simulate other failure modes — Charter says Settings › Assistant is read-only; a hung server was simulated with a local TCP black-hole on :8000 instead.
- Retry button on a cancelled run — Already reported as Q8-031; not re-verified.
- OpenCode Zen (no key, labelled Active) send — It would send to an external endpoint; OpenAI covered the no-key path.

## q1

| Item | Dark | Light | Viewports |
|---|---|---|---|
| boot / initial Home render, console | tested | tested | 1440x900 |
| rail items, active state, tooltips, aria-current | tested | tested | 1440x900, 1100x720 |
| right-click empty area + inside Home search input (K33) | tested | tested | 1440x900 |
| theme switching Settings→General Light/Dark/System + persistence across reload | tested | tested | 1440x900 |
| Home List/Grid toggle + persistence across reload/navigation | tested | tested | 1440x900, 1100x720 |
| filters All/Recent/Starred/Archived + count accuracy | tested | tested | 1440x900 |
| star/unstar + persistence across reload | tested | tested | 1440x900 |
| archive/unarchive via grid card More actions + Archived filter | tested | n/a | 1440x900 |
| archive via detail panel actions menu | tested | n/a | 1440x900 |
| search via '/' and Cmd/Ctrl+K, filtering, Esc clears, no-results state | tested | n/a | 1440x900 |
| sort Modified/Created/Name + header indicator (K25) | tested | n/a | 1440x900 |
| row click → detail panel; dblclick opens; Enter opens selected; detail Open button | tested | tested | 1440x900 |
| N creates design (renamed QA-q1-alpha) then deleted | tested | tested | 1440x900 |
| N hotkey edge cases (modifiers, open menu, behind modal) | tested | n/a | 1440x900 |
| Import KiCad… opens wizard (open/close only) | tested | n/a | 1440x900 |
| delete flow via More actions → Delete (K26: role, Esc, focus trap, close label, N/Enter behind modal) | tested | tested | 1440x900 |
| grid card menu stubs (K43) | tested | n/a | 1440x900 |
| status bar + sync footer text with cloud off | tested | tested | 1440x900, 1100x720 |
| keyboard-only list operation (K35) + focus visibility (K34) | tested | tested | 1440x900 |
| load error 500 then reload (K32), create error 500 | tested | tested | 1440x900 |
| empty-state via mocked {designs:[]} | tested | n/a | 1440x900 |
| 120-char design name truncation: list, grid, detail, designer tab, delete modal | tested | tested | 1440x900, 1100x720 |
| deleting a design open in a designer tab | tested | n/a | 1440x900 |
| 1100x720 layout (list + grid) | tested | tested | 1100x720 |
| DOM census Home list/grid both themes, Settings General light | tested | tested | 1440x900, 1100x720 |
| pixel probes: star/count contrast, thumbnails, error strip | tested | tested | 1440x900 |

Known findings: K25 confirmed; K26 confirmed; K32 confirmed; K33 confirmed; K34 partial; K35 confirmed; K40 partial; K43 confirmed

Untested:
- System theme following a live OS light↔dark change — headless Chromium: cannot flip prefers-color-scheme via playwright-cli; System resolved to Light as expected
- Electron-only surfaces (TitleBar, app version status segment, Settings Updates/Files) — browser stack only
- Theme flash on boot (no inline pre-React theme script in index.html) — not observable reliably in Vite dev; not filed
- K34 remaining kit components (tabs, dock tabs, chip, status segment, section header) — outside Home/shell charter

## q10

| Item | Dark | Light | Viewports |
|---|---|---|---|
| A: Settings has no Account tab (only General/Libraries/Assistant/Privacy/About) | tested | tested | 1440x900 |
| A: Home sync footer degrades to 'Local' (rail still says 'Local only — not signed in' → covered by Q1-019) | tested | tested | 1440x900 |
| A: Designer header has no Open from Cloud / sync badge / presence; shows 'Local' | tested | tested | 1440x900 |
| A: PCB has no Auto Layout / Route Board / Auto Place buttons | tested | tested | 1440x900 |
| A: Library has no cloud sync/pull buttons | tested | tested | 1440x900 |
| A: Assistant has no OpenPCB Cloud provider / copilot entries; no cloud network calls | tested | n/a | 1440x900 |
| A: zero cloud console noise per page (Home, Settings, Designer, Library, Assistant, Docs) | tested | tested | 1440x900 |
| A+C1: third-party network calls at runtime (cdn.jsdelivr.net font resolver) and no-internet behaviour of canvases/previews (Q10-001) | tested | tested | 1440x900 |
| C1: Home 'Sign in to sync' footer → Settings → Account | tested | tested | 1440x900, 1100x720 |
| C1: Settings → Account signed out; 'Sign in to OpenPCB Cloud' with dead auth/web URL (Q10-011) | tested | tested | 1440x900 |
| C1: Settings → Account signed in offline: identity, plan, sync switch (Q10-007), Sign out offline (Q10-002) | tested | tested | 1440x900, 1100x720 |
| C1: Designer Local chip (signed out) and sync badge states: 'cloud: …', 'cloud: rev N', 'cloud: error (N×)' (Q10-006, Q10-018) | tested | tested | 1440x900, 1100x720 |
| C1: auto-link failure toast (Q10-004) | tested | tested | 1440x900 |
| C1: Open from Cloud dialog offline (Q10-010) | tested | tested | 1440x900 |
| C1: PCB Auto Layout signed out (Q10-012) and signed in → Run (Q10-003) | tested | tested | 1440x900, 1100x720 |
| C1: Route Board / Auto Place signed out (Q10-005) and signed in offline (Q10-004), layout/overlap (Q10-014) | tested | tested | 1440x900, 1100x720 |
| C1: Library Sync to Cloud / Pull offline (Q10-004) | tested | tested | 1440x900, 1100x720 |
| C1: comments with cloud.comments on — local add works offline; cloud pull blocking (Q10-009) | tested | n/a | 1440x900 |
| C1: linked design editing while offline — local commands unaffected (fire-and-forget mirror), badge stale (Q10-006), realtime reconnect spam (Q10-008) | tested | n/a | 1440x900 |
| C1: Assistant OpenPCB Cloud provider seeded for Pro; send offline in Space (Q10-004/Q10-015) and in designer dock (Q10-016) | tested | n/a | 1440x900 |
| C1: console error count per page load (see notes) | tested | tested | 1440x900 |
| Native dialog spy: 0 prompt/confirm/alert across q10 flows | tested | tested | 1440x900 |
| 1100x720 layout: Home, Library header with Sync buttons (table collapse Q10-017), Designer header with Open from Cloud + badge (fits), PCB floating buttons + Auto-route panel (Q10-014), Auto Layout dialog (fits), Account (fits) | tested | tested | 1100x720 |

Known findings: K40 partial; K45 partial; K43 partial

Untested:
- Presence avatars with real peers — requires a reachable Supabase realtime + a second signed-in client; offline path covered by Q10-008
- Real browser-handoff sign-in / deep-link callback and invite acceptance — Electron-only deep links; cloud dead by design on C1
- Settings → Libraries 'Check for updates' with no internet — the check runs in the backend process, which has internet; cannot black-hole backend egress without restarting servers (forbidden)
- Auto Layout/Route Board with a black-holed (non-refusing) service host — AUTO_LAYOUT_URL is a backend env constant (localhost:3002, refused instantly); changing it needs a backend restart
- Free-tier (non-Pro) signed-in session variants — time; Pro variant covers a superset of surfaces (Auto Layout is not tier-gated)
- Stack C2 (prod preview) — not in q10 charter

## q11

| Item | Dark | Light | Viewports |
|---|---|---|---|
| DOM census + metrics + screenshot + palette-audit (canvas masked): Home list | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Home grid | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Designer empty state (no design open) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Schematic (GUIDE-VALIDATE) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): PCB (GUIDE-VALIDATE) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): 3D | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): BOM | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): DRC full view | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Library table | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Library grid | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Library detail page (74HC00) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Library New part wizard step 1 (opened, closed with Esc, nothing saved) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Docs | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Assistant space | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Settings General | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Settings Libraries | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Settings Assistant (list only, provider editor not opened) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Settings Privacy | tested | tested | 1100x720, 1440x900, 1920x1080 |
| DOM census + metrics + screenshot + palette-audit (canvas masked): Settings About | tested | tested | 1100x720, 1440x900, 1920x1080 |
| Tab walk ~40 stops with focus-visibility probe: home-list, home-grid, designer-empty, schematic, pcb, 3d, bom, drc, library-table(+deep 75), library-grid, library-detail, library-wizard, docs, assistant, settings-general | tested | tested (home-list, pcb walks + focus2-* crops for Home/Library/PCB/shell) | 1440x900 |
| Focus trap/return: Cmd+K palette | tested | tested | 1440x900 |
| Focus trap/return: power port picker | tested | tested | 1440x900 |
| Focus trap/return: PCB Design rules dialog (Cancel) | tested | tested | 1440x900 |
| Focus trap/return: PCB Export dialog (Esc/Cancel, no export) | tested | tested | 1440x900 |
| Focus trap/return: Home delete modal (Cancel only; GUIDE-VALIDATE intact) | tested (prior run census/q11/dlg-home-delete-dark.json) | tested | 1440x900 |
| Home/BOM rows keyboard reachability (K35) | tested | tested | 1440x900 |
| Arrow-key behaviour of view tabs, dock tabs, layer strip | n/a | tested | 1440x900 |
| Consistency: header bar heights | tested | tested | 1100x720, 1440x900, 1920x1080 |
| Consistency: section headers / panel title bars / row heights | tested | tested | 1440x900 |
| Consistency: control heights, buttons, search fields, segmented controls | tested | tested | 1440x900 |
| Consistency: menus/popovers (Home sort/more, design-tab ctx, PCB canvas ctx, schematic ctx, PCB Add/View, power port, Cmd+K) | tested (sort, tab ctx, Add) | tested | 1440x900 |
| Consistency: modal surfaces | tested | tested | 1440x900 |
| Consistency: empty states (Home Starred, Library no-match, Docs, Designer, Outline, Assistant Pinned) | tested | n/a | 1440x900 |
| Consistency: error/warning banners & status badges | tested | tested | 1440x900 |
| Icon sizes/stroke census | tested | tested | 1440x900 |
| Typography scale / sub-10px census (K36) | tested | tested | 1100x720, 1440x900, 1920x1080 |
| Radius census (2px flat) | tested | tested | 1440x900 |
| Shadows/blur/gradients census (K45) | tested | tested | 1440x900 |
| Horizontal page overflow at 1100x720 | tested | tested | 1100x720 |
| Console errors/warnings | tested | tested | 1440x900 |
| Native dialog spy (prompt/confirm/alert) during census | tested | tested | 1440x900 |

Known findings: K34 confirmed; K35 confirmed; K36 confirmed; K37 partial; K39 confirmed; K45 confirmed; K26 confirmed; K19 confirmed; K33 confirmed

Untested:
- Settings → Account tab — cloud.auth forced OFF on stack A — tab not rendered
- Settings provider editor — forbidden on stack A by protocol
- Tab walks at 1100x720 / 1920x1080 — focus behaviour is viewport-independent; walks done at 1440x900 only
- Light-theme tab walks for every screen — focus styles are theme-independent code; light covered by home-list + pcb walks and focus2 crops for Home/Library/PCB/shell
- Part wizard beyond step 1, Designer-empty 'Add net label' — charter: open step 1 only / read-only; no-design dead controls already reported by Q3-003/Q8-029
- R3F 'Cannot read properties of null (reading addEventListener)' console error seen after Library search — already reported (Q6-011, Q7-028); not duplicated

## q2

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Reach Settings via rail gear | tested | tested | 1440x900, 1100x720 |
| Reach Settings via Cmd+, and Ctrl+, (from Home and Designer) | tested | tested | 1440x900 |
| Reach Settings via app right-click menu (Home + Designer) | tested | tested | 1440x900 |
| Back returns to previous screen (Home, Designer) — Designer view resets (Q2-025) | tested | tested | 1440x900 |
| Esc returns to previous screen; Esc in search/form/context menu (Q2-012) | tested | tested | 1440x900 |
| Settings search + 'No matches' + Enter (Q2-013) | tested | n/a | 1440x900 |
| Header height/style vs Home/Library (K39, Q2-007) | tested | tested | 1440x900, 1100x720 |
| General: theme Light/Dark/System, System subtitle, persistence | tested | tested | 1440x900, 1100x720 |
| General: desktop-only notes (Updates, Files & logs) | tested | tested | 1440x900, 1100x720 |
| Libraries: core library card, Check for updates, error + mocked bundled-update state (Q2-016) | tested | tested | 1440x900, 1100x720 |
| Libraries: sources table, Remove -> native confirm dismissed (K06, Q2-004/005) | tested | n/a | 1440x900, 1100x720 |
| Libraries: Install from URL error paths (bogus host, 404, invalid, http) (Q2-015) | tested | tested | 1440x900 |
| Libraries: Install from file chooser (cancelled by uploading non-opclib sample.txt -> rejected, nothing installed) | tested | n/a | 1440x900 |
| Libraries: sources fetch 500 injection (Q2-014) | tested | n/a | 1440x900 |
| Account (cloud off): tab hidden by cloud.auth gate; forced openSettings('account') falls back to General | tested | tested | 1440x900 |
| Assistant: default provider / prompt preset / context size / tool policy / raw tool data save + reload persistence | tested | tested | 1440x900, 1100x720 |
| Assistant: MCP section toggles, writes disabled when server off, snippets text (K20, Q2-006, Q2-029) | tested | tested | 1440x900 |
| Assistant: add provider with dummy key, save, key badge (K11, Q2-001, Q2-019) | tested | n/a | 1440x900 |
| Assistant: Re-test error surfacing (unreachable, keyless) (Q2-002) | tested | tested | 1440x900 |
| Assistant: Models refresh error (Q2-010, Q2-018) | tested | n/a | 1440x900 |
| Assistant: edit/save, tool calling mode, draft loss (Q2-003) | tested | n/a | 1440x900 |
| Assistant: key show/replace/remove (Q2-027, Q2-028, Q2-017) | tested | n/a | 1440x900 |
| Assistant: delete provider (Q2-017) | tested | n/a | 1440x900 |
| Assistant: keyboard focus walk (Q2-011) | tested | n/a | 1440x900 |
| Privacy panel copy, checkbox, SECURITY.md link (Q2-020, Q2-021) | tested | tested | 1440x900, 1100x720 |
| About: modules list, release notes (opens GitHub releases tab), links, Privacy settings link | tested | tested | 1440x900, 1100x720 |
| Visual: control heights, kit vs hand-rolled, raw banners (K45) with pixel probes | tested | tested | 1440x900, 1100x720 |
| Layout at 1100x720 (all 5 visible tabs, no horizontal overflow) | tested | tested | 1100x720 |
| DOM census (General dark, Assistant dark/light, provider form dark, Libraries light, Privacy light) | tested | tested | 1440x900 |
| Console errors (only injected 4xx/5xx + favicon 404) | tested | tested | 1440x900 |

Known findings: K06 confirmed; K11 confirmed; K20 confirmed; K39 confirmed; K45 confirmed; K36 confirmed; K43 partial; K33 partial

Untested:
- Account tab contents (signed-out card, AiCloudTeaser, CloudValueCard) — cloud.auth forced off on stack B (tab hidden); stack C1 URL http://127.0.0.1:1720 is blocked by Chromium ERR_UNSAFE_PORT in playwright, so could not view read-only
- Updates / Files & logs / telemetry toggle functional paths — Electron-only APIs (window.updater, electronAPI) absent in browser stack
- MCP snippets content and Copy buttons — require Electron getMcpConfig
- Actual .opclib install / core library update download — charter: q6 owns library content; no remote release available
- Include completion in test / successful provider test — no reachable LLM server or real key on stack B

## q3

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Designer rail with no open tabs -> empty state (K19) | tested | tested | 1440x900 |
| Open designs from empty state 'Open existing' | tested | tested | 1440x900 |
| Design tabs: open several, switch | tested | tested | 1440x900, 1100x720 |
| Design tab dblclick rename (Enter / Esc / blur) | tested | n/a | 1440x900 |
| Design tab context menu Rename/Close/Close others/Close all (blocked: app menu hijacks right-click) | tested | n/a | 1440x900 |
| Design tab drag reorder (persisted in openpcb.designer.tabs.v1) | tested | n/a | 1440x900 |
| Design tab middle-click close | tested | n/a | 1440x900 |
| New design (+) button | tested | n/a | 1440x900 |
| Cmd+W closes active tab | tested | n/a | 1440x900 |
| View tabs Schem/PCB/3D/BOM/DRC switching + keyboard arrows | tested | tested | 1440x900 |
| Left sidebar resize (+ persistence) | tested | n/a | 1440x900 |
| Right dock tabs Properties/ERC/Assistant, dock width + tab persistence across reload | tested | n/a | 1440x900 |
| Cmd+I (Assistant dock) and Cmd+. (Toggle side panel), incl. while typing in inputs | tested | n/a | 1440x900 |
| Schematic toolbar buttons + tooltips (native title) | tested | tested | 1440x900 |
| Cmd+K palette: search, arrows, Enter places, Esc, focus return | tested | tested | 1440x900, 1100x720 |
| G GND port, P power picker, H net portal picker, L net label | tested | partial | 1440x900 |
| Wire pin->corner->pin, wire to wire T-junction | tested | n/a | 1440x900 |
| Drag a part (rubber-band wires) | tested | n/a | 1440x900 |
| Drag a wire segment (N1) | tested | n/a | 1440x900 |
| R / Shift+R direction vs labels (K28), incl. ports | tested | tested | 1440x900 |
| Delete / Backspace (canvas + outline row) | tested | n/a | 1440x900 |
| Cmd+A select all | tested | n/a | 1440x900 |
| Cmd+Z / Cmd+Shift+Z / Ctrl+Y vs toolbar Undo/Redo (K17) | tested | n/a | 1440x900 |
| Box select (containment) | tested | n/a | 1440x900 |
| Right-click menus: part, wire, label, port, empty canvas | tested | tested | 1440x900 |
| Outline Parts/Nets/Labels, filter, column sort, row click, dblclick frame | tested | partial | 1440x900 |
| Outline Actions menu Frame/Rename/Duplicate/Delete (+F/F2 shortcuts) | tested | n/a | 1440x900 |
| Empty-design outline state + Browse library (K21) | tested | tested | 1440x900, 1100x720 |
| Inspector: Value (Enter/Esc/blur), Tolerance, footprint variant, MPN/Manufacturer/Datasheet, DNP | tested | partial | 1440x900 |
| Inspector: Open in Library (K21), View on PCB, Replace component (K43) | tested | n/a | 1440x900 |
| Multi-select batch Value | tested | n/a | 1440x900 |
| Label inspector (Text edit) + wire inspector | tested | tested | 1440x900 |
| Typing in inspector inputs does not trigger canvas hotkeys | tested | n/a | 1440x900 |
| ERC dock: Run ERC, severity toggles, click violation selects+frames | tested | tested | 1440x900 |
| Comment mode C: add, open thread, reply, resolve, Esc | tested | tested | 1440x900 |
| Status bar: cursor X/Y, zoom, hint, ERC count click | tested | partial | 1440x900 |
| Zoom cluster, Fit schematic, Zoom to selection, wheel zoom, middle-drag/trackpad pan | tested | partial | 1440x900 |
| Grid drawn? parts land on grid? (K44) | tested | tested | 1440x900 |
| Load error: projection/schematic -> 500, open design (K09), then unroute | tested | n/a | 1440x900 |
| Light-theme schematic canvas background vs tokens (K38) + dark canvas probe | tested | tested | 1440x900 |
| 1100x720 layout check (designer shell, schematic, palette, inspector) | tested | tested | 1100x720 |
| DOM census (inspector 1440 dark, main 1100 dark/light) | tested | tested | 1440x900, 1100x720 |

Known findings: K19 confirmed; K17 confirmed; K28 confirmed; K21 confirmed; K43 confirmed; K44 confirmed; N1 confirmed; K09 confirmed; K38 confirmed; K34 partial; K45 partial; K10 untested

Untested:
- Native title tooltips visual rendering — headless Chromium does not render native title tooltips; verified title/aria attributes via DOM instead
- Designer toast (K10) — no schematic flow in charter triggered a toast; errors surfaced via the header error strip
- Drop from Library onto schematic (N2) — requires cross-module HTML5 DnD; not in q3 checklist
- Tab context-menu items themselves — blocked — menu never opens (Q3-001)

## q4

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Toolbar: every button, tooltip, disabled states (Undo/Redo/Fit/Flip/Route/Board/Add/Export/DRC/View) | tested | tested | 1440x900, 1100x720 |
| DRC count consistency toolbar vs dock tab vs status bar (spike) | tested | tested | 1440x900, 1100x720 |
| Route: R, click pad, corners, Enter/End finish, Esc cancel, Backspace | tested | tested | 1440x900, 1100x720 |
| Route: width W/Shift+W, width dropdown Custom… (K03 prompt) | tested | tested (chrome only) | 1440x900 |
| Route: via V / + / -, via preset/diameter/drill dropdowns + Custom (K03) | tested | tested (chrome only) | 1440x900 |
| Route: corner mode 45/90, posture /, layer switch T/B/1/2 while routing and idle (K16) | tested | tested (chrome only) | 1440x900 |
| Route hint text (K16) | tested | tested | 1440x900 |
| Board O: draw custom outline, typed length, Enter close | tested | tested (sketch HUD) | 1440x900 |
| Board outline edit: drag corner, Fillet/Chamfer/Set position/Delete vertex, Set length/Insert vertex, Enter/Esc in CornerOpModal/EdgeDimModal, undo/redo | tested | tested (fillet modal, context menu) | 1440x900 |
| Import DXF… with board-rect.dxf | tested | n/a | 1440x900 |
| Board panel: shape Rect/Rounded/Circle/Oval, size inputs + validation, presets, Apply, Done, Fit to parts, Reset to rectangle, Stackup, Edit rules…, Summary | tested | tested | 1440x900, 1100x720 |
| Add menu: Hole H, Pad P, Text T (K02), Zone Z, Keepout K, Comment C (K14) | tested | tested (menu, keepout) | 1440x900 |
| Shift+Z zone cutout | tested | n/a | 1440x900 |
| M measure | tested | n/a | 1440x900 |
| U tune (target length, amplitude, apply) | tested | n/a | 1440x900 |
| F flip selected / selection filter with nothing selected | tested | tested | 1440x900 |
| R rotate selected part, Flip part button, Delete (incl. footprint re-spawn) | tested | n/a | 1440x900 |
| Cmd+Z / Cmd+Shift+Z / Ctrl+Y | tested | tested | 1440x900 |
| Cmd+A (K18) | tested | n/a | 1440x900 |
| Context menus: empty canvas (K15), trace, via, placement, outline corner/edge | tested | tested (empty, corner) | 1440x900 |
| Overlap picker (Alt+click) | tested | n/a | 1440x900 |
| View menu: ratsnest / guides / DRC markers | tested | tested | 1440x900 |
| Layers panel: eye toggles, Alt+click solo (+ cross-design leak), opacity slider, preset select, copper fill toggle + selects, display mode Normal/Dim/Hide + Ctrl+H, group collapse | tested | tested (solo, eye, display mode) | 1440x900 |
| Layer tab strip clicks + flip view (Shift+F / Viewing Top) | tested | tested | 1440x900, 1100x720 |
| Components panel row click selects/centres; shift-click | tested | n/a | 1440x900 |
| Properties dock: nothing (Board panel) | tested | tested | 1440x900 |
| Properties dock: single footprint, multi-selection | tested | n/a | 1440x900 |
| Properties dock: free hole, free pad, text, zone, keepout, trace, via | tested | n/a | 1440x900 |
| Design rules dialog: edit, Cancel, Save & re-run, Esc, <select> + R/T/Delete (K12) | tested | tested (visual) | 1440x900 |
| Assistant dock composer typing 'rotate test' (K12) | tested | n/a | 1440x900 |
| Inspector <select> + R / Backspace (K12) | tested | n/a | 1440x900 |
| DRC dock: Run DRC, progress, violations list, click violation centres canvas, Waive/Un-waive, severity toggles, Edit rules, stale banner | tested | tested | 1440x900 |
| Full DRC view tab (empty + results) | tested | tested | 1440x900 |
| Export… dialog on 2-layer board (K30), DRC gate, Export anyway, Download, Esc, hotkeys behind modal | tested | tested | 1440x900, 1100x720 |
| Autolayout / Route board / Auto place buttons with cloud off | n/a | n/a | 1440x900 |
| Status bar: cursor, zoom, layer, hint, DRC chip, selection, view side, units | tested | tested | 1440x900, 1100x720 |
| Canvas clear colour probe vs --surface-canvas-well (K38) | tested | tested | 1440x900 |
| Light theme parity of PCB chrome (menus, route row, dock, dialogs, modals, HUDs, toasts, filter) | n/a | tested | 1440x900 |
| 1100x720 layout check (board panel, route row, DRC dock, export dialog, sidebar) | tested | tested | 1100x720 |
| DOM census PCB board state | tested | tested | 1440x900 |
| DRC Demo 3196d811: PCB, free holes/pads, Fit to parts, Run DRC, messages | tested | n/a | 1440x900 |

Known findings: spike confirmed; K02 confirmed; K03 confirmed; K12 confirmed; K13 confirmed; K14 confirmed; K15 confirmed; K16 partial; K18 confirmed; K30 confirmed; K37 confirmed; K38 confirmed

Untested:
- Autolayout / Route board / Auto place dialogs — Hidden on stack A: autoLayoutEnabled = cloudEnabled && flag; cloud auth forced off (Space.tsx:346). Belongs to C1 (Q10).
- Electron-specific behaviour of native prompts / title bar — Browser-only stack; window.prompt behaviour in Electron inferred, not observed
- Light-theme pass of Tune/Measure/overlap picker/copper-fill rows — Canvas-driven overlays share the same components as dark; chrome colours verified via probes on route row, menus, dock, dialogs only
- 4-layer board flows (layer pair chip, In1/In2, inner copper export) — No UI to change copper layer count (Stackup is read-only); no 4-layer design owned

## q5

| Item | Dark | Light | Viewports |
|---|---|---|---|
| 3D: load time (tab click → canvas/geometry mounted ~1.1 s incl. CLI latency) | tested | tested | 1440x900 |
| 3D: camera presets Iso/Persp/Top/Front/Side/Back | tested | tested | 1440x900 |
| 3D: display toggles Components/Silkscreen/Refdes/Floor grid | tested | tested | 1440x900 |
| 3D: Height heatmap / Export STEP / Measure stubs, FPS/Zoom readout | tested | tested | 1440x900 |
| 3D: board colour swatches, scene select, transparency slider | tested | tested | 1440x900 |
| 3D: mechanical panel collapse/expand + persistence | tested | n/a | 1440x900 |
| 3D: Snapshot (downloads <designId>-3d.png, 798x866) | tested | n/a | 1440x900 |
| 3D: orbit (left drag), wheel zoom, right-drag pan | tested | n/a | 1440x900 |
| 3D: overlay visuals + board thickness + imported board + error state | tested | tested | 1440x900, 1100x720 |
| BOM: filters All/Missing MPN/DNP, search, Esc clears search | tested | tested | 1440x900 |
| BOM: row click → inspector, edit MPN/Manufacturer/Supplier/price/notes, autosave indicator, reload persistence | tested | tested | 1440x900 |
| BOM: DNP bulk Mark/Clear, select all, sort, totals, order quantity | tested | tested | 1440x900 |
| BOM: Export CSV/Copy TSV/JLC/PnP/KiCad CSV + Cmd+E (and suppressed in search) | tested | n/a | 1440x900 |
| BOM: Show in schematic / PCB cross-probe | tested | n/a | 1440x900 |
| BOM: empty design (QA-q5-empty), error injection (GET 500, PATCH 500) | tested | tested | 1440x900 |
| BOM: keyboard-only navigation | tested | n/a | 1440x900 |
| BOM: layout at 1100x720 | tested | n/a | 1100x720 |
| BOM ↔ schematic inspector sync (MPN/DNP both directions) | tested | n/a | 1440x900 |
| KiCad import: open from Home, pick, review, name override, import, open result schematic/PCB/BOM/3D | tested | tested | 1440x900, 1100x720 |
| KiCad import: legacy KiCad 5 (geckonator), non-project zip, sample.txt error UX, Esc/Cancel/Close | tested | tested | 1440x900 |
| KiCad import: dialog focus/trap/labels/styling | tested | tested | 1440x900, 1100x720 |
| Comments: schematic C mode, composer, Cmd+Enter post | tested | n/a | 1440x900 |
| Comments: PCB Add → Comment, C key, composer typing | tested | n/a | 1440x900 |
| Comments: reply, resolve/reopen, status menu (mouse + keyboard), reactions, attachment (sample.md rejected, PNG accepted) | tested | n/a | 1440x900 |
| Comments: Esc handling (composer, popup, mode), draft loss | tested | n/a | 1440x900 |
| Comments: pin visuals both themes, offscreen edge chip + recenter | tested | tested | 1440x900 |

Known findings: K12 confirmed; K14 confirmed; K27 refuted; K31 confirmed; K33 confirmed; K35 confirmed; K36 partial; K40 partial; K43 partial; K45 confirmed; K02 confirmed

Untested:
- Comment pin drag-to-reposition — not in charter checklist; time spent on higher-severity keymap/status bugs
- PCB comment thread popup in light theme — schematic popup covered light theme; PCB popup uses the same component
- 3D transparency effect on a board with copper — only copper-bearing owned design is the imported board, which renders off-screen (Q5-020)
- BOM race when typing during an in-flight slow PATCH — no request-delay tool in playwright-cli; the deterministic redirect-to-other-line bug (Q5-001) already covers the data corruption path

## q6

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Library Table/Grid toggle + persistence across reload (openpcb.library.view) | tested | tested | 1440x900, 1100x720 |
| Header counts vs actual rows (K07 60-row cap) | tested | tested | 1440x900 |
| Facets: every bucket, filter box inside facet, checkbox labels, Show more, option ordering | tested | tested | 1440x900 |
| Active filter chips + Clear all | tested | tested | 1440x900 |
| Search incl '/' hint (K24), Esc, no-results state | tested | tested | 1440x900 |
| Table keyboard nav (arrows/Enter/Home/End/PgUp/Delete), focus style, focus restore after Back | tested | tested | 1440x900 |
| Row select → preview pane (symbol/footprint previews, Part/Footprints/Pins/Specs), Open, Component actions menu | tested | tested | 1440x900, 1100x720 |
| Preview 'Loading preview…' / 'No preview' / detail-500 states | tested | tested | 1440x900 |
| Detail page built-in: read-only banner, Duplicate to edit, footprint options switching | tested | tested | 1440x900, 1100x720 |
| Detail page custom: Edit/Save/Cancel, name/description, TagTokenInput add/remove/suggestions, empty-name validation, dirty guard | tested | tested | 1440x900 |
| Fullscreen symbol/footprint previews (Esc, focus) | tested | tested | 1440x900 |
| 3D card: STEP upload minimal.step, garbage.step, wrong extension, valid STEP; failed/pending/missing states; Retry conversion | tested | tested | 1440x900 |
| 3D model conversion errors incl. swallowed PATCH (K41) via routed 500 | n/a | tested | 1440x900 |
| 'Place in design' (K43) | tested | tested | 1440x900 |
| Import library…: LM324N.zip (new + re-import), OP07CD.zip, kicad-with-step.zip, non-KiCad zip, sample.txt; warnings display | tested | tested | 1440x900 |
| Single delete + bulk delete (K06 native confirm) | tested | tested | 1440x900 |
| Delete error → 500 (K08 list wipe) and ZIP import error | tested | tested | 1440x900 |
| Grid card visuals, selection checkboxes, click-to-open | tested | tested | 1440x900, 1100x720 |
| Empty states (no results, missing component id) | tested | tested | 1440x900 |
| 1100x720 layout (table squeeze by facet rail + preview pane; detail grid) | tested | tested | 1100x720 |
| Footprint handedness cross-check: library preview vs PCB vs 3D vs Gerber export (555 Timer on stack B) | tested | tested | 1440x900 |
| DOM census (table, grid, detail) + pixel-probe contrast | tested | tested | 1440x900, 1100x720 |

Known findings: K06 confirmed; K07 confirmed; K08 confirmed; K24 confirmed; K36 confirmed; K40 partial; K41 confirmed; K43 confirmed; K45 partial

Untested:
- Drag-and-drop from Library table onto schematic/PCB (N2) — owned by designer agents; only noted that D&D is the sole place path (Q6-016)
- Library with zero components (true empty state) — would require deleting all core + other agents' parts on shared stack B
- KiCad-imported footprint handedness for SOT-23/polarised caps in Gerber — verified on SOIC-8 (555 Timer U1) only; same root cause expected
- Import warnings list UI beyond first warning — no UI exists to open '+N more' (reported in Q6-021)

## q7

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Wizard open/close, progress bar clicks (disabled until symbol ready, jump to any step once ready), Back/Next | tested | tested | 1440x900, 1100x720 |
| Enter = Next (incl. after field commit), Esc = close (clean / dirty / from file input / mid-draw / with selection) | tested | n/a | 1440x900 |
| Symbol Import: simple_resistor, multi_unit_opamp, unsupported_construct, non-KiCad file (garbage.step) error UX | tested | tested | 1440x900 |
| Draw symbol tools V/L/R/C/A/P/T, previews, grid snapping | tested | tested | 1440x900 |
| Pin property panel edits (#, name, type, rotation, length, delete), Next pin defaults | tested | tested | 1440x900 |
| Rotate R / Shift+R + labels (K28) incl. schematic comparison on own design QA-q7-rotate | tested | tested | 1440x900 |
| Undo/redo (Cmd+Z, Ctrl+Z, Cmd+Shift+Z, Ctrl+Y), Cmd+A/C/V/D, Delete/Backspace | tested | n/a | 1440x900 |
| Alignment guides Shift+G toggle + drag guides | tested | n/a | 1440x900 |
| Grid toggle (symbol import/draw, footprint import/draw) | tested | tested | 1440x900 |
| Footprint Preset picker: Chip 0603 A/B/C, SOT-23/-5/223/323, QFN-16, density change staleness; node dump of generator | tested | tested | 1440x900 |
| Footprint Import single + sequential + multiple (DataTransfer) C_0603 + CP_Elec, variant selection | tested | n/a | 1440x900 |
| Footprint Draw: pad tool D, pad panel inputs/selects (invalid W, drill>pad), layer panel visibility + active layer, Show dimensions | tested | tested | 1440x900, 1100x720 |
| 3D Model: minimal.step, garbage.step, Remove, post-import status on detail page | tested | tested | 1440x900 |
| Metadata: name, description, tags (Enter/comma/Tab), warnings, pin/pad mismatch, commit errors | tested | tested | 1440x900, 1100x720 |
| Import component (drawn+drawn+STEP, KiCad sym+KiCad mod+STEP, drawn+preset QFN) → list → detail page | tested | tested | 1440x900 |
| Leave wizard with unsaved work via rail / back arrow / header Back (K06) | tested | n/a | 1440x900 |
| Visual: K36 tiny text, K37 input heights, K45 raw colours/native controls, toolbar vs designer kit toolbar, pixel probes | tested | tested | 1440x900 |
| 1100x720 layout (symbol draw, footprint draw/preset, metadata) | tested | tested | 1100x720 |
| Console errors/warnings during flows | tested | tested | 1440x900 |

Known findings: K06 confirmed; K29 confirmed; K28 confirmed; K36 confirmed; K37 confirmed; K45 confirmed

Untested:
- Grid rendering on a real GPU — GridShader produced zero pixels in headless Chromium WebGL2 for every wizard canvas; cannot rule out a headless-only artefact (flagged in Q7-002)
- Whether KiCad-imported footprints are also mirrored on the PCB / Gerber output — outside wizard charter; only library previews + stored coordinates verified (Q7-022) — needs PCB/import owner
- Committing the multi-unit LM358 import and placing it — time; preview-level issue recorded (Q7-003)
- Keyboard-only walk through the whole wizard (Tab order across canvas steps) — time; focus-loss spots recorded in Q7-032

## q8

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Assistant space: New chat | tested | tested | 1440x900, 1100x720 |
| Chat list filters All / Pinned (K23) / Linked / Archived | tested | tested | 1440x900 |
| Search chats (match + no-match copy) | tested | n/a | 1440x900 |
| Row actions Rename (K05) / Delete (K06), right-click menu | tested | tested | 1440x900 |
| Multi-select + Delete selected (incl. hidden selection across filters) | tested | n/a | 1440x900 |
| Header title inline rename (Enter commits, Esc cancels) | tested | tested | 1440x900 |
| Linked design chip (header + row chip) -> opens design | tested | tested | 1440x900 |
| Tools badge (read-only) | tested | tested | 1440x900 |
| Model pill popover (read-only look; model select used only to force the free model) | tested | tested | 1440x900 |
| Chat actions: Rename / Export markdown / Archive / Unarchive / Delete | tested | n/a | 1440x900 |
| Composer Enter / Shift+Enter / textarea growth | tested | tested | 1440x900 |
| @ mentions: design, component, page (+ clicking mention chips, K22) | tested | tested | 1440x900 |
| Slash quick actions + empty-state starter prompts | tested | tested | 1440x900 |
| Prompt 1: list components (read tools, tool cards) | tested | n/a | 1440x900 |
| Prompt 2: add R99 -> proposal; destructive proposal Reject + Apply; design verified via API | tested | tested | 1440x900 |
| Prompt 3: mermaid + markdown table; View source / Download SVG / Fullscreen | tested | tested | 1440x900 |
| Stop generating mid-stream + Retry | tested | tested | 1440x900 |
| Offline mid-run then online; offline send | tested | n/a | 1440x900 |
| 500 injection on message submit (unrouted after) | tested | n/a | 1440x900 |
| Streaming, auto-scroll, '↓ New messages' pill | tested | tested | 1440x900 |
| Message rendering quality (tables, headings, code, raw HTML, glued iterations) | tested | tested | 1440x900, 1100x720 |
| Dock (Cmd+I) on 3d5d1f7c: composer send, thread menu New/select/Rename (K04)/Delete (K06), model pill, Open in Assistant view, Close chat | tested | tested | 1440x900, 1100x720 |
| Dock on PCB view: typing fires PCB hotkeys (K12); also checked Schem and 3D (OK) | tested | n/a | 1440x900 |
| Run restore after reload (dock + Open in Assistant view) | tested | n/a | 1440x900 |
| Keyboard-only chat list (Tab, Space on checkbox, Enter on row menu) | n/a | tested | 1440x900 |
| Visual audit: raw colours / radii / shadows vs tokens (pixel probes), contrast | tested | tested | 1440x900, 1100x720 |
| Layout at 1100x720 (space + dock) | tested | tested | 1100x720 |

Known findings: K04 confirmed; K05 confirmed; K06 confirmed; K12 confirmed; K22 confirmed; K23 confirmed; K45 confirmed

Untested:
- 'Allow this tool this session' on a destructive proposal — would need another destructive proposal and permanent design mutation; skipped to keep owned designs intact
- Charter route pattern '**/api/modules/assistant/**/runs*' -> 500 — pattern only matches cloud-runs endpoints (routes.ts:249-286); local runs go through POST /chats/:id/messages + tasks SSE, so the equivalent injection was done on '**/api/modules/assistant/chats/*/messages*' (Q8-017) and unrouted
- Offline while a stream is already open — CDP offline emulation did not drop the already-open EventSource on loopback; run completed normally after online. Offline-before-send tested instead (Q8-017)
- Whether @page mention content reaches the LLM — model replied it had no access to page 5bec1891 although resolveMentionContext injects a system message; could be model quality — inconclusive, not filed
- 'Loading older messages' pagination (>50 messages) — no chat with >50 messages; not worth budget
- Copilot plan card / placement proposal card / BOM result card — cloud copilot off on stack A; specific tools not triggered within budget
- Configure providers on stack A — forbidden by charter; verified dead button on stack B instead (Q8-008)

## q9

| Item | Dark | Light | Viewports |
|---|---|---|---|
| Docs sidebar search (results, breadcrumb, <2 chars, no results) | tested | tested | 1440x900 |
| New page (sidebar +, empty-state card, editor header +) | tested | tested | 1440x900 |
| Title edit + save debounce + page switch | tested | tested | 1440x900 |
| Saving…/Saved/Error indicator (content + title) | tested | tested | 1440x900 |
| Reload persistence (content/title, selected page) | tested | tested | 1440x900 |
| Toolbar Undo/Redo | tested | tested | 1440x900 |
| Toolbar Bold/Italic/Strike/Inline code | tested | n/a | 1440x900 |
| Toolbar H1-H3, bullet/numbered/task list, quote, code block | tested | tested | 1440x900 |
| Link dialog (selection+Enter, Esc, collapsed selection, Remove, click on link) | tested | tested | 1440x900 |
| Markdown shortcuts (# ## ### - 1. [ ] > ``` --- ** ~~ ` * _) | tested | n/a | 1440x900 |
| Task checkbox toggle persistence | tested | n/a | 1440x900 |
| Page tree: Add subpage, expand/collapse | tested | tested | 1440x900 |
| Page tree: drag to move (before/after/inside) | tested | n/a | 1440x900 |
| Delete from tree + from editor (K06 native confirm) | tested | n/a | 1440x900 |
| Import sample.md / sample.txt / sample.pdf / invalid pdf | tested | n/a | 1440x900 |
| PDF viewer zoom in/out limits, scrolling, download link present | tested | tested | 1440x900, 1100x720 |
| Empty states (no pages, no page selected, no search results) | tested | tested | 1440x900 |
| Long titles (tree truncation, breadcrumb, 1100 wrap), empty title | tested | n/a | 1440x900, 1100x720 |
| Error states: tree 500, create 500, content save 500, offline, deleted page | tested | tested | 1440x900 |
| Keyboard: Tab order through tree/toolbar, focus visibility | tested | n/a | 1440x900 |
| Visual consistency vs Home/Library (K37 search, surfaces, metrics, raw colours K45) + pixel probes | tested | tested | 1440x900 |
| Cross-page undo, module switch persistence, context menu in editor | tested | tested | 1440x900 |
| 1100x720 layout Docs editor/PDF | tested | tested | 1100x720 |
| Tasks (K42): list, empty/loading/error states, scroll, styling | tested | tested | 1440x900, 1100x720 |
| DOM census Docs/Tasks | tested | tested | 1440x900, 1100x720 |
| Handoff page QA-q9-mention-target for Q8 | tested | n/a | 1440x900 |

Known findings: K01 confirmed; K06 confirmed; K37 confirmed; K45 confirmed; K42 confirmed; K40 confirmed; K34 confirmed; K33 confirmed; K22 partial

Untested:
- Tree/page loading skeleton visuals — route cannot add latency; loading states reviewed in code only (PageTree skeleton bg-slate-200 rounded-md, 'Loading page...')
- PDF Download link actual file save — headless download not verified; link href/download attrs present
- Large multi-hundred-page PDF performance — only 5-page fixture; viewer renders all pages at once (code)
- Drag-to-move visual drop indicators — HTML5 DnD indicator not captured mid-drag in headless; move results verified via API
- Project-scoped docs (designId) tree — Docs rail entry uses workspace scope; no UI path found to open project-scoped docs
