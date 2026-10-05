# cross-cutting — QA findings

[← index](../README.md) · 23 triage entries · S1 1 · S2 2 · S3 15 · S4 5

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-001](#t-001) | S1 | Schematic/PCB/3D canvases render black offline (canvas fonts fetched from cdn.jsdelivr.net) | Q10-001 | decide (DEC-PKG) | F0b / F0b | shared-package | S |
| [T-002](#t-002) | S2 | No shared shortcut guard: global hotkeys fire while typing, behind modals and inside menus |  | fix-now | F0a / F0a | frontend | S |
| [T-003](#t-003) | S2 | No React ErrorBoundary / global error handlers — any render crash blanks the whole app |  | fix-now | F0b / F0b | frontend | S |
| [T-004](#t-004) | S3 | Kit primitive set missing (Input/NumberInput/Select/Switch/RadioGroup/Toast/Spinner/Kbd/ErrorBoundary) — root of hand-rolled controls |  | fix-now | F0a / F0a | frontend | M |
| [T-005](#t-005) | S3 | When the OS theme changes while the schematic is open (Appearance = System, the default), the canvas keeps the previous palette: parts go invisible on light, or a glaring white sheet appears in dark | F2C-005 | fix-now | F0b / F0b | frontend | XS |
| [T-006](#t-006) | S3 | Raw 'HTTP 500' / 'Internal error' / 'Failed to fetch' shown to users (42 sites) — no shared error-message mapper | Q10-004 | fix-now | F0a / F0a | frontend | S |
| [T-007](#t-007) | S3 | No visible keyboard focus on kit controls; non-kit controls show UA blue ring | Q11-001, Q11-002, Q11-003, Q1-012 | fix-now | F0a / F0a | frontend | M |
| [T-008](#t-008) | S3 | Hover-revealed row actions receive keyboard focus while fully transparent (opacity 0) — focus disappears | Q11-004 | fix-now | F0a / F0a | frontend | XS |
| [T-009](#t-009) | S3 | Top header bar height differs per screen: 34px on Home/Library/Designer vs 39 (Library detail), 49 (Docs), 52 (Settings), 56 (Assistant), 57 (part wizard) | Q11-007 | fix-now | W4 / W4 | frontend | M |
| [T-010](#t-010) | S3 | Inspector title bars, card headers and table rows use off-spec heights: 28 vs 34px panel titles, 39/31px Library detail card headers, 20px Pins rows, 15px 'Open existing' rows | Q11-008 | fix-now | W4 / W4 | frontend | S |
| [T-011](#t-011) | S3 | Search fields come in five variants: kit 22/20px vs Assistant 29px rounded-lg, Docs and Settings 32px hand-rolled inputs | Q11-009 | fix-now | W4 / W4 | frontend | S |
| [T-012](#t-012) | S3 | Segmented/toggle groups have 7 implementations with different heights, radii and active colours (primary black, surface-control, selection-soft cyan, white, pills) | Q11-010 | fix-now | W4 / W4 | frontend | S |
| [T-013](#t-013) | S3 | Button sizes/variants drift outside the kit: 22px kit buttons next to 23–41px hand-rolled ones, and mixed footer buttons (OK 22px vs text-link Cancel 15px) | Q11-011 | fix-now | W4 / W4 | frontend | M |
| [T-014](#t-014) | S3 | Modal surfaces use four recipes; no kit confirm/prompt helpers (enables native-dialog removal) | Q11-013 | fix-now | F0a / F0a | frontend | M |
| [T-015](#t-015) | S3 | Sub-10px text still ships on 4 top-level screens (9px 3D panel labels, 9.5px Library source badges, 9px Assistant/Settings chips) | Q11-014 | fix-now | W4 / W4 | frontend | XS |
| [T-016](#t-016) | S3 | Radius flattening leaks: bare `rounded` still renders 4px, Assistant bubbles 10px, and rounded-full pills are used for non-status labels that are square elsewhere | Q11-015 | fix-now | F0a / F0a | frontend | S |
| [T-017](#t-017) | S3 | Status badges and banners are inconsistent: info notes painted as amber warnings, cyan selection colour used as 'success', the same 'core' badge rendered three ways | Q11-019 | fix-now | F0a / F0a | frontend | S |
| [T-018](#t-018) | S3 | Tab widgets behave three different ways and PCB Layers costs ~40 Tab stops: dock tabs/layer strip lack arrow keys & roving tabindex, view tablist unnamed, design tab tabindex=-1 | Q11-022 | fix-now | F0a / F0a | frontend | M |
| [T-019](#t-019) | S4 | Shadow / backdrop-blur / gradient leftovers on docked surfaces: 3D overlay cards, Assistant composer and fade, part-wizard canvas bar, glowing status dots | Q11-016 | fix-now | W4 / W4 | frontend | S |
| [T-020](#t-020) | S4 | Icon stroke widths mix 1.5px (kit), 1.8px (Settings) and 2px (Lucide default) on the same screens | Q11-017 | fix-now | W4 / W4 | frontend | XS |
| [T-021](#t-021) | S4 | Typography scale drifts between screens: 11px body on kit screens vs 12–14px on Settings/Docs/Assistant; page/panel titles 13/500, 13/600, 15/600, 20/500, 20/600 | Q11-018 | fix-now | W4 / W4 | frontend | S |
| [T-022](#t-022) | S4 | Empty states use six different patterns (icon+text, text-only, bordered card+button, left-aligned stack, rounded box) with no shared component | Q11-020 | fix-now | F0a / F0a | frontend | S |
| [T-023](#t-023) | S4 | Console noise: THREE.Clock deprecation + 'WebGLRenderer: Context Lost' logged on every preview canvas mount/unmount; favicon 404 | Q7-033 | defer | followup / followup | shared-package | XS |

## T-001

**Schematic/PCB/3D canvases render black offline (canvas fonts fetched from cdn.jsdelivr.net)**

- Severity **S1** · category crash · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-PKG · owner F0b · wave F0b · scope shared-package · estimate S
- Findings: Q10-001

**Summary.** Schematic canvas is 100% #000000 (1 colour vs 853 online), PCB canvas black (zoom stuck at 20%, only the Auto Layout buttons float over it), 3D view black (FPS —). Turning 'Refdes labels' off does not recover. After connectivity returns the canvases stay black until a full app reload. Online baseline renders normally. Every canvas load online also makes 8 requests to cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@…

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/EDAText.js:9` — preloadFont({characters}) and drei <Text> are called with no `font` → troika falls back to unicode-font-resolver on cdn.jsdelivr.net

**Proposed fix.** Mitigation: bundle a font + configure troika text builder (unicodeFontsURL/font) in main.tsx so canvases render offline; real fix: r3f-eda-canvas EDAText passes a bundled font. — Detail: In the shared repo (@openpcb/r3f-eda-canvas): ship a font file (e.g. the bundled IBM Plex Sans woff from D2) as a package asset and pass `font={bundledFontUrl}` to drei <Text> in EDAText plus preloadFont({font: bundledFontUrl, …}); at app startup call troika's configureTextBuilder({ unicodeFontsURL: <app-local copy of unicode-font-resolver data> }) so fallback glyphs never go to jsdelivr. Wrap label layers in their own <Suspense fallback={null}> (and an error boundary) so a text failure drops labels instead of bla…

**Evidence.** [020-C1-designer-schem-signedout](../evidence/shots/q10/dark/020-C1-designer-schem-signedout.png), [002-schem-internet-offline-15s](../evidence/shots/vq10/light/002-schem-internet-offline-15s.png)

<details><summary>Q10-001 — Schematic, PCB and 3D canvases render fully black when the machine has no internet (canvas text fonts fetched from cdn.jsdelivr.net) (S1, confirmed)</summary>

- Area cross-cutting · stack C1 · design c2c58a19 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack C1 (any stack works), open Designer with 'Dual LED Blinker' open
  2. Simulate no internet while localhost works: run-code page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort('internetdisconnected'))
  3. Reload, go to Designer (Schem tab), wait 15 s
  4. Switch to PCB tab, then 3D tab
  5. Remove the route (internet back) and switch tabs again without reloading
  6. Also: with internet blocked, open Library and select any part → preview cards never load
- Expected: A desktop EDA app renders every editor canvas with no internet connection; canvas text uses bundled fonts.
- Actual: Schematic canvas is 100% #000000 (1 colour vs 853 online), PCB canvas black (zoom stuck at 20%, only the Auto Layout buttons float over it), 3D view black (FPS —). Turning 'Refdes labels' off does not recover. After connectivity returns the canvases stay black until a full app reload. Online baseline renders normally. Every canvas load online also makes 8 requests to cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1 (codepoint-index + latin/greek woff), i.e. the app phones a third-party CDN on every launch. Library preview pane (Symbol + Footprint cards) shows 'Loading preview…' spinners indefinitely (still spinning after 16 s) for any part when offline. Light theme identical (PCB canvas 99.6% #000000).
- Screenshots: [020-C1-designer-schem-signedout](../evidence/shots/q10/dark/020-C1-designer-schem-signedout.png), [032-C1-schem-internet-offline-after15s](../evidence/shots/q10/dark/032-C1-schem-internet-offline-after15s.png), [033-C1-pcb-internet-offline](../evidence/shots/q10/dark/033-C1-pcb-internet-offline.png), [034-C1-3d-internet-offline](../evidence/shots/q10/dark/034-C1-3d-internet-offline.png), [035-C1-3d-offline-refdes-off](../evidence/shots/q10/dark/035-C1-3d-offline-refdes-off.png), [036-C1-pcb-after-reconnect-no-reload](../evidence/shots/q10/dark/036-C1-pcb-after-reconnect-no-reload.png), [037-C1-after-reload-online](../evidence/shots/q10/dark/037-C1-after-reload-online.png), [038-C1-library-preview-internet-offline](../evidence/shots/q10/dark/038-C1-library-preview-internet-offline.png), [039-C1-library-preview-offline-after16s](../evidence/shots/q10/dark/039-C1-library-preview-offline-after16s.png), [033-C1-pcb-internet-offline](../evidence/shots/q10/light/033-C1-pcb-internet-offline.png)
- Console: `TypeError: Failed to fetch at t3.getFontsForString (troika unicode-font-resolver worker) -> resolveFallbacks -> calculateFontRuns -> typeset (x2)`
- Network: `GET https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/codepoint-index/plane0/0-ff.json → net::ERR_INTERNET_DISCONNECTED`; `GET .../codepoint-index/plane0/300-3ff.json → net::ERR_INTERNET_DISCONNECTED`; `(online, stack A PCB load) 8× GET cdn.jsdelivr.net/.../font-meta/{latin,greek}.json + font-files/{latin,greek}/sans-serif.normal.{100,400}.woff → 200`
- Pixel probes: {"file": "shots/q10/dark/032-C1-schem-internet-offline-after15s.png", "x": 740, "y": 470, "hex": "#000000", "nearestToken": "--surface-canvas-well", "deltaE": 2.5}
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/EDAText.js:9` — preloadFont({characters}) and drei <Text> are called with no `font` → troika falls back to unicode-font-resolver on cdn.jsdelivr.net
- Code: `src/shared/frontend/canvas/primitives/EDAText.tsx:1` — in-tree shim re-exporting the package EDAText
- Code: `src/modules/designer/frontend/pcb/layers/OverlayLayer.tsx:13` — PCB overlay text via EDAText
- Code: `node_modules/troika-three-text/dist/troika-three-text.esm.js:453` — default dataUrl https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data
- Code: `node_modules/@react-three/drei/core/Text.js:34` — suspend(() => new Promise(res => preloadFont({font, characters}, res))) never resolves when troika's font fetch fails → whole scene suspends; cached key keeps it suspended after reconnect
- Code: `node_modules/troika-three-text/dist/troika-three-text.esm.js:464` — configureTextBuilder supports `unicodeFontsURL` to point the resolver at app-local data
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:32` — Suspense fallback 'Loading preview...' is what Library previews show forever offline
- Suggested fix: In the shared repo (@openpcb/r3f-eda-canvas): ship a font file (e.g. the bundled IBM Plex Sans woff from D2) as a package asset and pass `font={bundledFontUrl}` to drei <Text> in EDAText plus preloadFont({font: bundledFontUrl, …}); at app startup call troika's configureTextBuilder({ unicodeFontsURL: <app-local copy of unicode-font-resolver data> }) so fallback glyphs never go to jsdelivr. Wrap label layers in their own <Suspense fallback={null}> (and an error boundary) so a text failure drops labels instead of blanking the scene. Add an e2e run with external network blocked (context.route abort) that asserts the schematic/PCB canvas is not uniform black. Re-pin the package here afterwards.
- Verification (vq10): **confirmed** — Reproduced in a fresh vq10-light session on C1 with page.context().route(non-localhost → abort('internetdisconnected')): Schem canvas 65% #000000 after 15 s, PCB 63% #000000 (zoom 20%, only the Auto Layout buttons float over it), 3D 62% #000000; console 'TypeError: Failed to fetch at getFontsForString'. After unrouteAll() and switching tabs WITHOUT reload both canvases stay black; after reload online the schematic renders normally (#d8d8d8/#f0f4f8). Root cause confirmed in code: @openpcb/r3f-eda-canvas EDAText renders drei <Text> with no `font`, so troika resolves glyphs through unicode-font-resolver on cdn.jsdelivr.net; drei Text calls suspend(() => new Promise(res => preloadFont({font, characters}, res))) and troika never calls `res` on a fetch failure, so the whole R3F scene suspends forever (no inner <Suspense>) and suspend-react keeps the pending promise cached under ['troika-text', undefined, characters], which is why reconnecting does not recover. Not an environment artefact: PLAN.md D2 says 'Electron runs offline', and the PLAN run log misfiled this as an in-container artefact. Mitigation that keeps S1 from being universal: jsdelivr serves these files with cache-control 'public, max-age=31536000, immutable', so an Electron install that loaded them once online will usually render offline from HTTP cache. Still S1 for first launch offline, cleared cache, air-gapped/corporate networks and regions where jsdelivr is blocked (whole editor unusable), plus a third-party request (~12 per canvas load) on every launch. · evidence: [002-schem-internet-offline-15s](../evidence/shots/vq10/light/002-schem-internet-offline-15s.png), [003-pcb-internet-offline](../evidence/shots/vq10/light/003-pcb-internet-offline.png), [004-3d-internet-offline](../evidence/shots/vq10/light/004-3d-internet-offline.png), [005-pcb-after-reconnect-no-reload](../evidence/shots/vq10/light/005-pcb-after-reconnect-no-reload.png), [006-schem-after-reconnect-no-reload](../evidence/shots/vq10/light/006-schem-after-reconnect-no-reload.png), [007-schem-online-after-reload](../evidence/shots/vq10/light/007-schem-online-after-reload.png), network: GET https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/codepoint-index/plane0/0-ff.json → ERR_INTERNET_DISCONNECTED; online → 200 cache-control public, max-age=31536000, immutable, palette-audit: schem offline #000000 65.3%, pcb 63.0%, 3d 62.1%; online after reload #d8d8d8 35%/#f0f4f8 25%

</details>


## T-002

**No shared shortcut guard: global hotkeys fire while typing, behind modals and inside menus**

- Severity **S2** · category keyboard · status derived · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate S
- Findings:  · known ref K12

**Summary.** Infra entry; adopters: K12 PCB keymap (D3), Home N (C1), Settings Esc (C2), wizard Esc (L2), schematic keymap (D2).

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — Keymaps check only <input>; no shared editable/modal/menu guard

**Proposed fix.** Add src/shared/frontend/keyboard/shortcut-guard.ts: isEditableTarget (input/textarea/select/contenteditable), isModalOpen (aria-modal/role=dialog/menu), modifier filtering; export useGlobalShortcut().

**Note.** Infra entry; adopters: K12 PCB keymap (D3), Home N (C1), Settings Esc (C2), wizard Esc (L2), schematic keymap (D2).

**Evidence.** [094-comment-typing](../evidence/shots/q4/dark/094-comment-typing.png)


## T-003

**No React ErrorBoundary / global error handlers — any render crash blanks the whole app**

- Severity **S2** · category crash · status derived · themes dark, light
- Recommendation **fix-now** · owner F0b · wave F0b · scope frontend · estimate S
- Findings:  · known ref K01

**Summary.** Containment for Q9-008/Q9-022 (root fixes in K1) and uncaught rejections seen in F1A-001/F1A-004.

**Root cause.** `src/core/frontend/src/main.tsx:36` — No ErrorBoundary in App.tsx/ModuleSpaceHost; no window error/unhandledrejection handlers

**Proposed fix.** Wrap AppShell/ModuleSpaceHost in kit ErrorBoundary (per-module fallback with Reload); window error + unhandledrejection handlers -> sentry + toast.

**Note.** Containment for Q9-008/Q9-022 (root fixes in K1) and uncaught rejections seen in F1A-001/F1A-004.

**Evidence.** [022-crash-pdf-to-text](../evidence/shots/q9/dark/022-crash-pdf-to-text.png)


## T-004

**Kit primitive set missing (Input/NumberInput/Select/Switch/RadioGroup/Toast/Spinner/Kbd/ErrorBoundary) — root of hand-rolled controls**

- Severity **S3** · category consistency · status derived · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate M
- Findings:  · known ref K37,K45

**Summary.** Infra entry derived from K37/K45 + user decision 'full consistency depth'; unblocks every area migration entry.

**Root cause.** `src/shared/frontend/ui/:None` — No Input/NumberInput/Select/Switch/RadioGroup/Toast/Spinner/Kbd/ErrorBoundary primitives; surfaces hand-roll controls

**Proposed fix.** Add kit primitives Input, NumberInput, Select, Switch, RadioGroup, Checkbox (22/20px), Toast, Spinner, Kbd, ErrorBoundary in src/shared/frontend/ui; document sizes in tokens doc.

**Note.** Infra entry derived from K37/K45 + user decision 'full consistency depth'; unblocks every area migration entry.

**Evidence.** [003b-theme-system-crop](../evidence/shots/q2/dark/003b-theme-system-crop.png), `census/settings-assistant-provider-dark-1440.json`


## T-005

**When the OS theme changes while the schematic is open (Appearance = System, the default), the canvas keeps the previous palette: parts go invisible on light, or a glaring white sheet appears in dark**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0b · wave F0b · scope frontend · estimate XS
- Findings: F2C-005

**Summary.** Dark → light (live): the background switches to #f0f4fb, but parts and wires keep the dark palette. Body is #030303 (black box), outlines #d9dbde (1.26:1 on the bg, so R1/C1/J1 are practically invisible), wire #a6b2c1 (1.95:1). Light → dark (live): the canvas turns into a bright #f5f5f0 sheet with light-palette parts inside the dark shell (17:1 against the surrounding chrome). The zoom cluster also stays in the old…

**Root cause.** `src/core/frontend/src/providers/ThemeProvider.tsx:49` — system-change path calls setMode(nextMode); applyThemeClass runs later in a useEffect, so during that render <html data-color-mode> still holds the old mode

**Proposed fix.** ThemeProvider: applyThemeClass before setMode on system theme change; D2/D3 pass themeMode to EdaCanvas. — Detail: ThemeProvider.tsx:48-51: inside the subscribeToSystemTheme callback call applyThemeClass(nextMode) before setMode(nextMode), so the <html data-color-mode> read by EdaCanvas (r3f-eda-canvas EdaCanvas.js:10-19) is current during the re-render. Additionally pass themeMode={mode} from useTheme() to <EdaCanvas> in SchematicCanvas.tsx:3264 (and PcbCanvas), as ComponentDetailPage.tsx:590 already does, so palette and background come from React state.

**Evidence.** [059-system-live-light-schem](../evidence/shots/f2c/light/059-system-live-light-schem.png), [226-system-dark-baseline-schem](../evidence/shots/vf2c/dark/226-system-dark-baseline-schem.png)

<details><summary>F2C-005 — When the OS theme changes while the schematic is open (Appearance = System, the default), the canvas keeps the previous palette: parts go invisible on light, or a glaring white sheet appears in dark (S3, confirmed)</summary>

- Area cross-cutting · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark, light · viewports 1440x900
- Repro:
  1. Settings › General › Appearance = System (the default when no preference is stored)
  2. Open QA-f2c-board › Schem (parts + one wire), Fit schematic
  3. Change the OS appearance (QA: page.emulateMedia({colorScheme:'light'}) then 'dark'), do not touch the canvas
  4. Pixel-probe canvas bg, wire, part body and outline. Compare with a fresh reload in the same theme
- Expected: The whole schematic re-themes with the shell, identical to a fresh load in that theme (light: bg #f0f4fb, wire #3e506b, body #dbdbd9, outline #020616).
- Actual: Dark → light (live): the background switches to #f0f4fb, but parts and wires keep the dark palette. Body is #030303 (black box), outlines #d9dbde (1.26:1 on the bg, so R1/C1/J1 are practically invisible), wire #a6b2c1 (1.95:1). Light → dark (live): the canvas turns into a bright #f5f5f0 sheet with light-palette parts inside the dark shell (17:1 against the surrounding chrome). The zoom cluster also stays in the old style. The stale palette stays until something re-renders the scene; any click on the canvas fixes it. Switching through Settings › Light/Dark is fine, because the designer unmounts while Settings is open. Library list/detail, portalled menus and Docs re-theme correctly on the same live switch. The PCB canvas is identical in both themes anyway (Q4-038).
- Screenshots: [059-system-live-light-schem](../evidence/shots/f2c/light/059-system-live-light-schem.png), [051-fresh-light-schem](../evidence/shots/f2c/light/051-fresh-light-schem.png), [061-system-live-dark-schem](../evidence/shots/f2c/dark/061-system-live-dark-schem.png), [030-theme-base-dark-schem](../evidence/shots/f2c/dark/030-theme-base-dark-schem.png), [060-system-live-light-schem-after-interact](../evidence/shots/f2c/light/060-system-live-light-schem-after-interact.png), [226-system-dark-baseline-schem](../evidence/shots/vf2c/dark/226-system-dark-baseline-schem.png), [227-system-live-light-schem](../evidence/shots/vf2c/light/227-system-live-light-schem.png), [228-fresh-light-schem](../evidence/shots/vf2c/light/228-fresh-light-schem.png), [229-system-live-dark-from-light](../evidence/shots/vf2c/dark/229-system-live-dark-from-light.png), [230-system-live-dark-after-fit](../evidence/shots/vf2c/dark/230-system-live-dark-after-fit.png), [231-system-live-dark-after-click](../evidence/shots/vf2c/dark/231-system-live-dark-after-click.png)
- Pixel probes: {"file": "shots/f2c/light/059-system-live-light-schem.png", "x": 510, "y": 480, "hex": "#030303", "nearestToken": "--surface-canvas-well", "deltaE": 1.7}; {"file": "shots/f2c/light/059-system-live-light-schem.png", "x": 433, "y": 480, "hex": "#d9dbde", "nearestToken": "--divider", "deltaE": 1.0}; {"file": "shots/f2c/light/059-system-live-light-schem.png", "x": 650, "y": 483, "hex": "#a6b2c1", "nearestToken": "--text-disabled", "deltaE": 7.1}; {"file": "shots/f2c/light/051-fresh-light-schem.png", "x": 433, "y": 480, "hex": "#020616", "nearestToken": "--text-strong", "deltaE": 7.3}; {"file": "shots/f2c/dark/061-system-live-dark-schem.png", "x": 700, "y": 700, "hex": "#f5f5f0", "nearestToken": "--text-strong", "deltaE": 2.6}
- Code: `src/core/frontend/src/providers/ThemeProvider.tsx:49` — system-change path calls setMode(nextMode); applyThemeClass runs later in a useEffect, so during that render <html data-color-mode> still holds the old mode
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/interaction/EdaCanvas.js:10` — themeMode='auto' reads document.documentElement.dataset.colorMode at render time → resolves the stale mode
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3264` — EdaCanvas gets backgroundColor from useTheme() but no themeMode prop, so bg and palette come from different sources
- Code: `src/core/frontend/src/lib/theme.ts:67` — updateThemePreference applies the class synchronously (why the Settings path works); subscribeToSystemTheme (:75) only calls back
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:941` — canvasBackground is undefined in dark, so EdaCanvas falls back to getDefaultCanvasBackground(staleMode) → the #f5f5f0 sheet
- Suggested fix: ThemeProvider.tsx:48-51: inside the subscribeToSystemTheme callback call applyThemeClass(nextMode) before setMode(nextMode), so the <html data-color-mode> read by EdaCanvas (r3f-eda-canvas EdaCanvas.js:10-19) is current during the re-render. Additionally pass themeMode={mode} from useTheme() to <EdaCanvas> in SchematicCanvas.tsx:3264 (and PcbCanvas), as ComponentDetailPage.tsx:590 already does, so palette and background come from React state.
- Verification (vf2c): **confirmed** — Reproduced on stack B in a fresh session with no stored theme (System), QA-f2c-board › Schem › Fit. Live emulateMedia dark→light (no canvas interaction): shell #f7f7f8, canvas bg #f0f4fb but U1 body #030303 (black box), outline #d9dbde, wire #a6b2c1; R1/C1/J1 washed out. Fresh light reload: outline #020616, body #dbdbd9, wire #3e506b. Live light→dark: shell #111113 but canvas stays a #f5f5f0 sheet with the light palette. Correction: Fit alone did NOT restore it in the light→dark case (camera move only); a canvas click did (bg #0e1116, outline #d9dbde). Root cause confirmed in code (ThemeProvider sets state before the <html> attribute; EdaCanvas resolves mode from the attribute at render; dark bg prop is undefined). Not excluded by PLAN §0 (palette values are out of scope, theme-switch correctness is not). Realistic in Electron: no nativeTheme override, so macOS Auto appearance reaches the renderer. Transient (any canvas click fixes it) → S3 kept. · evidence: [226-system-dark-baseline-schem](../evidence/shots/vf2c/dark/226-system-dark-baseline-schem.png), [227-system-live-light-schem](../evidence/shots/vf2c/light/227-system-live-light-schem.png), [228-fresh-light-schem](../evidence/shots/vf2c/light/228-fresh-light-schem.png), [229-system-live-dark-from-light](../evidence/shots/vf2c/dark/229-system-live-dark-from-light.png), [230-system-live-dark-after-fit](../evidence/shots/vf2c/dark/230-system-live-dark-after-fit.png), [231-system-live-dark-after-click](../evidence/shots/vf2c/dark/231-system-live-dark-after-click.png), probe 227 (light): 700,700 #f0f4fb; 433,480 #d9dbde; 540,540 #030303; 650,483 #a6b2c1, probe 229/230 (dark): 700,700 #f5f5f0; 433,480 #020616; 540,540 #dbdbd9; probe 231 after click: #0e1116 / #d9dbde

</details>


## T-006

**Raw 'HTTP 500' / 'Internal error' / 'Failed to fetch' shown to users (42 sites) — no shared error-message mapper**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate S
- Findings: Q10-004 · known ref K40
- Depends on: ['T-004']

**Summary.** Designer toast (3 s, red, covers the header's Open from Cloud / sync badge / Assistant / panel toggle): 'Cloud sync failed: Unable to connect. Is the computer able to access the url?'. Auto-route panel: 'Unable to connect. Is the computer able to access the url?' with only a 'Cancel' button (no retry). Auto-place panel: same text, no footer buttons at all (only ×). Open from Cloud: 'Failed to fetch'. Library: the Sy…

**Root cause.** `src/core/frontend/src (42 sites):None` — Each surface renders problem.title / `HTTP ${status}` / fetch error text directly

**Proposed fix.** Add src/shared/frontend/http/problem.ts: map RFC7807/HTTP/network (Failed to fetch, Bun 'Unable to connect') to user copy + retryable flag; kit Banner/inline error with Retry. — Detail: Add one backend helper (e.g. src/core/backend/http/cloud-fetch.ts) that wraps cloud fetches and converts network errors/timeouts into AppError 503 type https://openpcb.dev/problems/cloud-unreachable with a fixed friendly title; use it in designer autoroute/autoplace/cloud-sync, library cloud-sync, assistant cloud-context. Frontend: map that type to a shared 'Can't reach OpenPCB Cloud' string + Retry; CloudLibrarySyncButton must keep its label and show errors in a tooltip/notice; Auto-route error state should say C…

**Note.** Infra entry; adopters listed in area entries (Home, Library, Docs, Designer strip, DRC, BOM, Assistant, Settings).

**Evidence.** [042-C1-designer-cloudsync-failed-toast](../evidence/shots/q10/dark/042-C1-designer-cloudsync-failed-toast.png), [034-designer-cloudsync-toast](../evidence/shots/vq10/dark/034-designer-cloudsync-toast.png)

<details><summary>Q10-004 — Cloud connection failures surface Bun's raw 'Unable to connect. Is the computer able to access the url?' (and 'Failed to fetch' / 'HTTP 500') across every cloud feature (S3, confirmed)</summary>

- Area cloud · stack C1 · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1 (cloud URLs dead), signed in (simulated session)
  2. Designer: open 'Dual LED Blinker' → toast
  3. PCB → 'Route Board…'; then 'Auto Place…'
  4. Designer header → 'Open from Cloud'
  5. Library → 'Sync to Cloud', then the pull (cloud-download) button
  6. Assistant → New chat → provider 'OpenPCB Cloud' → send a message
- Expected: One consistent, friendly offline message (e.g. 'Can't reach OpenPCB Cloud — you're offline or the service is down. Your local work is unaffected.') with a Retry action; raw runtime strings only in logs.
- Actual: Designer toast (3 s, red, covers the header's Open from Cloud / sync badge / Assistant / panel toggle): 'Cloud sync failed: Unable to connect. Is the computer able to access the url?'. Auto-route panel: 'Unable to connect. Is the computer able to access the url?' with only a 'Cancel' button (no retry). Auto-place panel: same text, no footer buttons at all (only ×). Open from Cloud: 'Failed to fetch'. Library: the Sync button's own label turns into red 'HTTP 500' (its accessible name becomes 'HTTP 500'; the server's detail is discarded) and stays that way. Assistant (OpenPCB Cloud provider): 'Assistant paused before completing. OpenPCB Cloud workspace resolution failed (Unable to connect. Is the computer able to access the url?).' — 'paused' is wrong, it failed. Backend returns generic 500 internal-error problem documents for all of these.
- Screenshots: [042-C1-designer-cloudsync-failed-toast](../evidence/shots/q10/dark/042-C1-designer-cloudsync-failed-toast.png), [054-C1-routeboard-signedin-offline](../evidence/shots/q10/dark/054-C1-routeboard-signedin-offline.png), [055-C1-autoplace-signedin-offline](../evidence/shots/q10/dark/055-C1-autoplace-signedin-offline.png), [045-C1-open-from-cloud-error](../evidence/shots/q10/dark/045-C1-open-from-cloud-error.png), [072-C1-library-sync-failed](../evidence/shots/q10/dark/072-C1-library-sync-failed.png), [073-C1-library-sync-http500-button](../evidence/shots/q10/dark/073-C1-library-sync-http500-button.png), [094-C1-copilot-send-13s](../evidence/shots/q10/dark/094-C1-copilot-send-13s.png)
- Console: `500 @ /designs/c2c58a19…/cloud-link`; `500 @ /designs/c2c58a19…/autoroute`; `500 @ /designs/c2c58a19…/autoplace`; `500 @ /library/cloud/sync`; `500 @ /library/cloud/pull`
- Network: `POST /designer/designs/:id/cloud-link → 500 {"type":"…/internal-error","detail":"Unable to connect. Is the computer able to access the url?"}`; `POST /library/cloud/sync → 500 same detail`; `GET http://127.0.0.1:9/v1/workspaces/me/personal → FAILED`
- Code: `src/modules/designer/backend/autoroute/client.ts:34` — fetch() rejection propagates as generic 500
- Code: `src/modules/library/backend/cloud-sync.ts:66` — resolvePersonalWorkspace fetch error → 500
- Code: `src/modules/library/frontend/components/CloudLibrarySyncButton.tsx:58` — throw new Error(`HTTP ${res.status}`) then renders it as the button label
- Code: `src/modules/designer/frontend/components/CloudSyncBadge.tsx:83` — toast shows err.message verbatim
- Code: `src/modules/designer/frontend/pcb/PcbAutorouteDialog.tsx:137` — message = e.message; error phase only offers Cancel; error block at :304
- Code: `src/modules/designer/frontend/pcb/PcbAutoplaceDialog.tsx:193` — error phase has no footer / retry
- Code: `src/modules/assistant/backend/cloud/cloud-context.ts:50` — embeds raw err.message
- Code: `src/modules/assistant/frontend/Space.tsx:487` — 'Assistant paused before completing.' used for hard failures
- Code: `src/modules/designer/frontend/hooks/use-toast.tsx:77` — toast container fixed right-3 top-3 z-50, no role/aria-live (see K10)
- Suggested fix: Add one backend helper (e.g. src/core/backend/http/cloud-fetch.ts) that wraps cloud fetches and converts network errors/timeouts into AppError 503 type https://openpcb.dev/problems/cloud-unreachable with a fixed friendly title; use it in designer autoroute/autoplace/cloud-sync, library cloud-sync, assistant cloud-context. Frontend: map that type to a shared 'Can't reach OpenPCB Cloud' string + Retry; CloudLibrarySyncButton must keep its label and show errors in a tooltip/notice; Auto-route error state should say Close + Try again; Auto-place needs a footer with Close/Try again.
- Verification (vq10): **confirmed** — Reproduced every release-visible surface: designer toast 'Cloud sync failed: Unable to connect. Is the computer able to access the url?' (MutationObserver: appears 1.28 s after opening Designer, gone at 4.25 s, box x1108–1428 y12–60 over the header's Open from Cloud / sync badge / Assistant / dock toggle; no role/aria-live); Auto-route panel shows the raw string with only 'Cancel'; Auto-place panel shows it with only the × (no footer); the Assistant space shows 'Assistant paused before completing. OpenPCB Cloud workspace resolution failed (Unable to connect…)' with Retry. Library 'Sync to Cloud' turns its own label and accessible name into 'HTTP 500' (snapshot: button "HTTP 500"). Severity lowered S2→S3: the copy is raw but accurate and nothing is blocked beyond the cloud being unreachable. Two of the surfaces are dev-flagged and hidden in release builds: Library sync/pull (cloud.library 'dev') and Open from Cloud (cloud.designBrowser 'dev'). The toast (cloud.sync), auto-route/place (cloud.autolayout) and copilot (cloud.copilot) are all 'all'. Overlaps Q10-010 ('Failed to fetch' in Open from Cloud) and Q10-016 (paused wording). · evidence: [034-designer-cloudsync-toast](../evidence/shots/vq10/dark/034-designer-cloudsync-toast.png), [052-routeboard-signedin-offline](../evidence/shots/vq10/dark/052-routeboard-signedin-offline.png), [053-autoplace-signedin-offline](../evidence/shots/vq10/dark/053-autoplace-signedin-offline.png), [060-library-sync-http500](../evidence/shots/vq10/dark/060-library-sync-http500.png), [070-assistant-space](../evidence/shots/vq10/dark/070-assistant-space.png), network: POST /designer/designs/c2c58a19…/cloud-link → 500; POST …/autoroute → 500; POST …/autoplace → 500

</details>


## T-007

**No visible keyboard focus on kit controls; non-kit controls show UA blue ring**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate M
- Findings: Q11-001, Q11-002, Q11-003, Q1-012 · known ref K34

**Summary.** Computed style on focus-visible = 'outline: none 1px rgb(8,145,178)' (light) / 'none 1px rgb(51,209,255)' (dark): width and colour are applied but style is none. Generated CSS: `.outline-none{--tw-outline-style:none;outline-style:none}` and `.focus-visible\:outline:focus-visible{outline-style:var(--tw-outline-style);outline-width:1px}` → the variable is 'none'. Affects every schematic toolbar tool (Fit, Place compon… | Also covers: Q11-002: Kit tabs, dock tabs, segmented controls, section-header toggles, primary/ghost buttons, H…; Q11-003: Non-kit controls fall back to the browser's default blue focus ring (#005fcc light / #99c…; Q1-012: No visible keyboard focus on Home filter buttons, star toggles, '…' More-actions triggers…

**Root cause.** `src/shared/frontend/ui/toolbar.tsx:58` — '… transition-colors outline-none' + line 59 'focus-visible:outline focus-visible:outline-1 … outline-selection'

**Proposed fix.** Remove outline-none that cancels focus-visible in ToolbarButton/IconButton; add token focus ring to Tabs, DockTabs, SegmentedControl, Chip, StatusSegment, PanelSectionHeader, Button; global :focus-visible token rule in index.css replaces UA blue ring. — Detail: In src/shared/frontend/ui/toolbar.tsx:59, icon-button.tsx:40 and canvas-zoom-cluster.tsx:14 replace `focus-visible:outline` with `focus-visible:outline-solid` (keep outline-1 / -outline-offset-1 / outline-selection). Do NOT switch to `outline-hidden`: in the installed Tailwind 4.3.0 it also sets --tw-outline-style:none, so it would not fix this. Add a DOM test that asserts outlineStyle !== 'none' on :focus-visible for kit buttons.

**Evidence.** [focus2-montage-pcb-light](../evidence/shots/q11/light/focus2-montage-pcb-light.png), [002-pcb-route-focused-crop](../evidence/shots/vq11/dark/002-pcb-route-focused-crop.png), [focus2-montage-home-lib-light](../evidence/shots/q11/light/focus2-montage-home-lib-light.png)

<details><summary>Q11-001 — Focus ring on ToolbarButton / IconButton / canvas zoom buttons never renders: `outline-none` cancels `focus-visible:outline` under Tailwind v4 (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Open GUIDE-VALIDATE (b5a31f3e) → PCB tab
  2. Click the empty toolbar strip, then press Tab until 'Route (R)' (or any toolbar icon button, 'Zoom in', header 'Toggle side panel') is focused
  3. Observe no focus indicator; in DevTools getComputedStyle(document.activeElement).outlineStyle === 'none'
- Expected: Kit ToolbarButton/IconButton/CanvasZoomCluster were given a 1px --selection focus-visible outline (PLAN Run 2 commit 590aebb 'focus rings on ToolbarButton/IconButton'); it should be visible on keyboard focus.
- Actual: Computed style on focus-visible = 'outline: none 1px rgb(8,145,178)' (light) / 'none 1px rgb(51,209,255)' (dark): width and colour are applied but style is none. Generated CSS: `.outline-none{--tw-outline-style:none;outline-style:none}` and `.focus-visible\:outline:focus-visible{outline-style:var(--tw-outline-style);outline-width:1px}` → the variable is 'none'. Affects every schematic toolbar tool (Fit, Place component, GND, PWR, Portal, Comment, ERC), every PCB toolbar tool (Undo, Redo, Fit board, Flip part, Route, Board, Add, Export…, DRC, View), all kit IconButtons (header 'Toggle side panel', Home/Library 'More actions', 'Component actions') and the Zoom in/out/fit cluster on both canvases.
- Screenshots: [focus2-montage-pcb-light](../evidence/shots/q11/light/focus2-montage-pcb-light.png), [focus2-montage-dark](../evidence/shots/q11/dark/focus2-montage-dark.png), [focus2-pcb-toolbar-route](../evidence/shots/q11/light/focus2-pcb-toolbar-route.png), [focus2-pcb-zoom-in](../evidence/shots/q11/light/focus2-pcb-zoom-in.png)
- Census: `census/q11/tab-pcb-dark.json`
- Code: `src/shared/frontend/ui/toolbar.tsx:58` — '… transition-colors outline-none' + line 59 'focus-visible:outline focus-visible:outline-1 … outline-selection'
- Code: `src/shared/frontend/ui/icon-button.tsx:39` — same pattern (lines 39-40)
- Code: `src/shared/frontend/ui/canvas-zoom-cluster.tsx:14` — same pattern
- Suggested fix: In src/shared/frontend/ui/toolbar.tsx:59, icon-button.tsx:40 and canvas-zoom-cluster.tsx:14 replace `focus-visible:outline` with `focus-visible:outline-solid` (keep outline-1 / -outline-offset-1 / outline-selection). Do NOT switch to `outline-hidden`: in the installed Tailwind 4.3.0 it also sets --tw-outline-style:none, so it would not fix this. Add a DOM test that asserts outlineStyle !== 'none' on :focus-visible for kit buttons.
- Verification (vq11): **confirmed** — Reproduced on stack A (GUIDE-VALIDATE b5a31f3e, PCB) in both themes. Keyboard focus reaches Undo, Fit board, Route (R), Board (O), Add, Export…, DRC, View and Zoom in with :focus-visible true, but the computed outline is 'none 1px rgb(51,209,255)' in dark and 'none 1px rgb(8,145,178)' in light, and no ring pixels appear in the crops. The live stylesheet has `.outline-none{--tw-outline-style:none;outline-style:none}` and `.focus-visible\:outline:focus-visible{outline-style:var(--tw-outline-style);outline-width:1px}`, which confirms the root cause. The suggested fix needed a correction: node_modules/tailwindcss 4.3.0 defines outline-hidden as --tw-outline-style:none + outline-style:none, so it would not help. Experiment: injecting a `:focus-visible{--tw-outline-style:solid;outline-style:solid}` class onto 'Route (R)' made it render 'solid 1px rgb(8,145,178)' with offset -1px, so the outline-solid fix works. · evidence: [002-pcb-route-focused-crop](../evidence/shots/vq11/dark/002-pcb-route-focused-crop.png), [003-focus-route](../evidence/shots/vq11/dark/003-focus-route.png), [003-focus-zoomin](../evidence/shots/vq11/dark/003-focus-zoomin.png), [002-pcb-route-focused](../evidence/shots/vq11/light/002-pcb-route-focused.png), [070-route-fix-experiment](../evidence/shots/vq11/light/070-route-fix-experiment.png), tab walk: 'Route (R) | fv=true | none 1px rgb(87,197,230)' (dark), 'none 1px rgb(31,127,152)' (light)

</details>

<details><summary>Q11-002 — Kit tabs, dock tabs, segmented controls, section-header toggles, primary/ghost buttons, Home filter rows and Library cards show no keyboard focus indicator (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. On each main screen press Tab ~40 times from page start (tab walks recorded in census/q11/tab-*.json)
  2. Watch the focused element: e.g. Home 'Grid' view toggle, 'New design' (primary), 'Recent' filter; Designer view tab 'PCB'; dock tab 'DRC'; PCB 'Dim'; Library 'New part', facet header 'Family', a grid card
- Expected: Every focusable control shows a visible focus indicator (WCAG 2.4.7), consistently styled.
- Actual: No computed style difference between focused and unfocused state (tab-walk probe compares against an unfocused clone) for: view tabs Schem/PCB/3D/BOM/DRC; dock tabs Properties/ERC/DRC/Assistant; segmented controls Home List/Grid, Library Table/Grid, BOM All/Missing MPN/DNP, Outline Parts/Nets/Labels, PCB Normal/Dim/Hide; PanelSectionHeader toggles (Library facets Source/Family/Mount/Package/Other, PCB 'Layers'); primary buttons Home 'New design', Library 'New part', Outline 'Place component', DRC 'Run DRC', detail 'Duplicate to edit', Designer-empty 'New design'; ghost/text buttons Home filters All/Recent/Starred/Archived, ★ Star, 'More actions', Library 'Show 20 more…', Docs 'Import document'/'New page', BOM 'Export ▾', 'Show in schematic', 'PCB', column sort header; Library grid cards (268×222 buttons); selects 3D 'Lighting scene', BOM 'Order quantity'. Secondary buttons and inputs DO change (1px --selection border), so the gap is specific to these primitives.
- Screenshots: [focus2-montage-home-lib-light](../evidence/shots/q11/light/focus2-montage-home-lib-light.png), [focus2-montage-pcb-light](../evidence/shots/q11/light/focus2-montage-pcb-light.png), [focus2-montage-dark](../evidence/shots/q11/dark/focus2-montage-dark.png)
- Census: `census/q11/tab-home-list-dark.json`
- Code: `src/shared/frontend/ui/segmented-control.tsx:58` — outline-none, no focus-visible style
- Code: `src/shared/frontend/ui/tabs.tsx:30` — TabsTrigger (designer view tabs) outline-none only
- Code: `src/shared/frontend/ui/dock-tabs.tsx:54` — outline-none only
- Code: `src/shared/frontend/ui/panel-section-header.tsx:82` — toggle button outline-none
- Code: `src/shared/frontend/ui/chip.tsx:18` — outline-none
- Code: `src/shared/frontend/ui/status-bar.tsx:51` — outline-none
- Code: `src/shared/frontend/ui/button.tsx:55` — only focus-visible:border-selection — primary/ghost/danger variants have no border so nothing changes
- Suggested fix: Define one focus utility in index.css (e.g. `@utility focus-ring { &:focus-visible { outline: 1px solid var(--color-selection); outline-offset: -1px } }`) and apply it in Button (all variants), SegmentedControl options, TabsTrigger, DockTabs, PanelSectionHeader toggle, Chip, StatusSegment; use it in HomeSidebar filter rows, DesignCard star/menu, LibraryCard.
- Verification (vq11): **confirmed** — Reproduced by keyboard-focusing each control (focus, Tab, Shift+Tab) and diffing against an unfocused clone. View tab 'PCB', dock tabs 'Properties'/'DRC', segmented 'Dim', and the PanelSectionHeader toggles 'Layers'/'Components' all report fv=true, diff=null, outline none, in dark and light. The kit secondary button 'Edit rules…' does change (border becomes #33d1ff dark / #0891b2 light), matching the claim that only secondary buttons and inputs have a focus treatment. Code confirms: segmented-control.tsx:58, tabs.tsx:30, dock-tabs.tsx:54, panel-section-header.tsx:82, chip.tsx:18 and status-bar.tsx:51 set outline-none with no focus-visible style, and button.tsx:55 only has focus-visible:border-selection, which borderless primary/ghost/danger variants can't show. Overlaps cross-agent Q1-012 (Home), Q3-033 (designer tabs) and Q9-013 (Docs), all K34. · evidence: [003-focus-viewtab-PCB](../evidence/shots/vq11/dark/003-focus-viewtab-PCB.png), [003-focus-docktab-Properties](../evidence/shots/vq11/dark/003-focus-docktab-Properties.png), [003-focus-seg-Dim-btn](../evidence/shots/vq11/dark/003-focus-seg-Dim-btn.png), [003-focus-section-Layers](../evidence/shots/vq11/dark/003-focus-section-Layers.png), [003-focus-secondary-Edit-rules](../evidence/shots/vq11/dark/003-focus-secondary-Edit-rules.png), [004-focus-viewtab-PCB](../evidence/shots/vq11/light/004-focus-viewtab-PCB.png), [004-focus-seg-Dim-btn](../evidence/shots/vq11/light/004-focus-seg-Dim-btn.png)

</details>

<details><summary>Q11-003 — Non-kit controls fall back to the browser's default blue focus ring (#005fcc light / #99c8ff dark) — off-token and a fourth, inconsistent focus style (S3, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Press Tab from page start on any screen: the rail (Home…Assistant, bug link, Settings) is focused first
  2. Continue into PCB Layers rows, Settings nav rows, 3D panel buttons, DRC rows, Assistant chat rows
  3. Compare with kit secondary buttons (e.g. Home 'Import KiCad…') and search fields
- Expected: One app-wide focus treatment on tokens (e.g. 1px --selection outline) — the redesign bans blue casts.
- Actual: Four different focus treatments co-exist: (1) Chromium UA `outline: auto` rounded blue ring — pixel #005fcc in light (ΔE 30.4 from nearest token --status-info) and #99c8ff in dark (ΔE 12.2) on rail items, Settings Back/nav rows/theme buttons, PCB layer rows + opacity/eye buttons + 'Collapse group'/'Show all'/preset, 3D camera/display/colour buttons, DRC group headers/violation rows/severity toggles, Assistant chat rows/filters/New/collapse, design-tab close and '+' New design, header 'Open the assistant'; (2) 1px cyan --selection border on kit secondary buttons and SearchField wrappers; (3) background tint only (Outline rows, Library table rows rgb(38,38,43)→rgb(28,28,31)); (4) nothing (Q11-001/Q11-002).
- Screenshots: [focus2-shell-rail-library](../evidence/shots/q11/light/focus2-shell-rail-library.png), [focus2-pcb-layer-row](../evidence/shots/q11/light/focus2-pcb-layer-row.png), [focus2-pcb-layer-row](../evidence/shots/q11/dark/focus2-pcb-layer-row.png), [focus2-home-import-secondary](../evidence/shots/q11/light/focus2-home-import-secondary.png)
- Pixel probes: {"file": "shots/q11/light/focus2-shell-rail-library.png", "x": 3, "y": 39, "hex": "#005fcc", "nearestToken": "--status-info", "deltaE": 30.4}; {"file": "shots/q11/dark/focus2-pcb-layer-row.png", "x": 14, "y": 25, "hex": "#99c8ff", "nearestToken": "--status-info", "deltaE": 12.2}
- Census: `census/q11/tab-3d-dark.json`
- Code: `src/core/frontend/src/index.css:10` — token doc says the selection cyan is THE focus-ring colour, but there is no global :focus-visible rule, so the UA ring shows wherever a component doesn't set outline-none
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:95` — navButtonClass(): no focus style → UA ring
- Suggested fix: Add one app-wide token ring in src/core/frontend/src/index.css, e.g. `@layer base { :where(button,a,[role=button],[role=tab],[tabindex]):focus-visible { outline: 1px solid var(--selection); outline-offset: -1px } }`. Fix the kit primitives separately (Q11-001/Q11-002), because their utility-layer `outline-none` beats a base-layer rule. Keep the border treatment for inputs.
- Verification (vq11): **confirmed** — Reproduced. Keyboard focus on the rail 'Library' item, PCB layer row 'Metadata · Alt+click to solo' and the layer 'Hide layer' eye yields the Chromium UA ring `outline: auto 1px`. Pixel probes: light #005fcc (nearest --status-info, ΔE 30.4) and dark #99c8ff (ΔE 12.2), matching q11's values exactly. Meanwhile kit secondary buttons use a cyan --selection border and the kit tabs/toolbar show nothing, so at least three treatments co-exist. Code: LeftSidebar navButtonClass has no focus style and index.css has no global :focus-visible rule. · evidence: [004-uaring-rail-Library](../evidence/shots/vq11/dark/004-uaring-rail-Library.png), [004-uaring-layer-row-metadata](../evidence/shots/vq11/dark/004-uaring-layer-row-metadata.png), [004-focus-rail-Library](../evidence/shots/vq11/light/004-focus-rail-Library.png), [004-focus-layer-row-metadata](../evidence/shots/vq11/light/004-focus-layer-row-metadata.png), probe light 7,11 #005fcc --status-info dE=30.4; dark 7,11 #99c8ff dE=12.2

</details>

<details><summary>Q1-012 — No visible keyboard focus on Home filter buttons, star toggles, '…' More-actions triggers and the List/Grid segmented control (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home; Tab through the page
  2. Watch the focused element for each stop (filters, Star, More actions, List/Grid)
- Expected: Every focus stop shows a clear focus-visible indicator (e.g. 1px --selection ring/border like kit Button).
- Actual: Computed style at :focus-visible for Star, More actions, All/Recent/Starred/Archived filters, List and Grid: outline none, box-shadow none, no background change → focus is invisible (compare Import KiCad… which gets a cyan border, and rail items which fall back to the browser outline).
- Screenshots: [014-focus-on-recent-filter](../evidence/shots/vq1/dark/014-focus-on-recent-filter.png), [022-focus-on-filter-or-button](../evidence/shots/q1/dark/022-focus-on-filter-or-button.png), [054-focus-on-recent-filter](../evidence/shots/q1/light/054-focus-on-recent-filter.png), [053-focus-on-import-kicad](../evidence/shots/q1/light/053-focus-on-import-kicad.png)
- Pixel probes: {"file": "shots/vq1/dark/014-focus-on-recent-filter.png", "x": 150, "y": 74, "hex": "#111113", "nearestToken": "--surface-panel", "deltaE": 0.0}; {"file": "shots/vq1/dark/014-focus-on-recent-filter.png", "x": 150, "y": 98, "hex": "#111113", "nearestToken": "--surface-panel", "deltaE": 0.0}
- Code: `src/core/frontend/src/screens/home/HomeSidebar.tsx:91` — filter buttons outline-none, no focus-visible style
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:180` — StarButton outline-none
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:114` — More actions trigger outline-none
- Code: `src/shared/frontend/ui/segmented-control.tsx:58` — option buttons outline-none with no focus-visible replacement (K34)
- Suggested fix: Add the kit focus ring used by Button/IconButton (focus-visible:ring-1 ring-selection ring-inset) to HomeSidebar.tsx:91 filter buttons, DesignCard.tsx:180 StarButton, :113-114 ActionsMenu trigger and segmented-control.tsx:58 options; rail buttons (LeftSidebar.tsx:15) should use the same instead of the UA outline.
- Verification (vq1): **confirmed** — Reproduced by keyboard Tab from the search field: List, Grid, all four filter buttons and every Star report :focus-visible with outline none / box-shadow none; pixel probe of the focused 'Recent' row (#111113 at left/top/mid) is identical to the unfocused 'Starred' row → no visible indicator. Import KiCad…/Modified/New design do get a cyan ring (kit Button), so the gap is Home-local buttons + SegmentedControl. K34 confirmed (partial scope as q1 reported), S3. · evidence: [014-focus-on-recent-filter](../evidence/shots/vq1/dark/014-focus-on-recent-filter.png)

</details>


## T-008

**Hover-revealed row actions receive keyboard focus while fully transparent (opacity 0) — focus disappears**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate XS
- Findings: Q11-004

**Summary.** The focused element has effective opacity 0 — focus is invisible and the user can't tell what Enter will do (e.g. DRC waive, Docs delete). Measured op=0 for: Outline row 'Actions' (tab-schematic i27/29/31/33), Assistant 'Chat actions for QA-q8-main' (tab-assistant i17/20/23/26/29), DRC 'Waive (accept)' (tab-drc i18/21/23/25/27/29), Docs 'Add subpage'/'Delete' (tab-docs i12-22). Also the close X of inactive design ta…

**Root cause.** `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:159` — opacity-0 … group-hover:opacity-100

**Proposed fix.** Add .row-actions utility (opacity-0 group-hover/focus-within:opacity-100) in index.css; adopters OutlineRow (D2), Docs TreeItem (K1), Assistant chat rows (A1). — Detail: Add `group-focus-within:opacity-100 focus-visible:opacity-100` (and the same for the wrapper in TreeItem) to each hover-reveal class list.

**Evidence.** [focus-schem-outline-actions-invisible](../evidence/shots/q11/dark/focus-schem-outline-actions-invisible.png), [005-outline-actions-focused](../evidence/shots/vq11/dark/005-outline-actions-focused.png)

<details><summary>Q11-004 — Hover-revealed row actions receive keyboard focus while fully transparent (opacity 0) — focus disappears (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Open GUIDE-VALIDATE → Schem; Tab into the Outline list: after row 'C1 Capacitor' the next stop is its 'Actions' button
  2. Same on DRC view ('Waive (accept)' after each violation), Assistant chat list ('Chat actions for …'), Docs page tree ('Add subpage', 'Delete')
- Expected: Actions revealed on hover must also become visible on keyboard focus (focus-within/focus-visible).
- Actual: The focused element has effective opacity 0 — focus is invisible and the user can't tell what Enter will do (e.g. DRC waive, Docs delete). Measured op=0 for: Outline row 'Actions' (tab-schematic i27/29/31/33), Assistant 'Chat actions for QA-q8-main' (tab-assistant i17/20/23/26/29), DRC 'Waive (accept)' (tab-drc i18/21/23/25/27/29), Docs 'Add subpage'/'Delete' (tab-docs i12-22). Also the close X of inactive design tabs uses the same pattern.
- Screenshots: [focus-schem-outline-actions-invisible](../evidence/shots/q11/dark/focus-schem-outline-actions-invisible.png), [focus-drc-waive-invisible](../evidence/shots/q11/dark/focus-drc-waive-invisible.png)
- Census: `census/q11/tab-drc-dark.json`
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:159` — opacity-0 … group-hover:opacity-100
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:430` — Waive button opacity-0 group-hover:opacity-100
- Code: `src/modules/assistant/frontend/Space.tsx:1328` — chat row actions opacity-0 group-hover:opacity-100
- Code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:209` — row actions wrapper opacity-0 group-hover:opacity-100
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:267` — inactive tab close 'opacity-0 group-hover:opacity-80'
- Suggested fix: Add `group-focus-within:opacity-100 focus-visible:opacity-100` (and the same for the wrapper in TreeItem) to each hover-reveal class list.
- Verification (vq11): **confirmed** — Reproduced. On the schematic Outline the first row's 'Actions' button takes keyboard focus (fv=true) with effective opacity 0 at 319,139 16×16, and nothing is visible in the crop. In the DRC full view the 'Waive (accept)' button (21 instances) takes focus at opacity 0. Code confirms opacity-0 group-hover:opacity-100 with no focus-visible or group-focus-within variant at OutlineRow.tsx:159, DesignerDrcView.tsx:430, assistant Space.tsx:1328, TreeItem.tsx:209 (wrapper) and DesignTabs.tsx:267 (inactive tab close). Docs tree rows overlap cross-agent Q9-013. · evidence: [005-outline-actions-focused](../evidence/shots/vq11/dark/005-outline-actions-focused.png), [006-drc-view](../evidence/shots/vq11/dark/006-drc-view.png), probe: Outline Actions op=0 fv=true; DRC 'Waive (accept)' op=0 fv=true

</details>


## T-009

**Top header bar height differs per screen: 34px on Home/Library/Designer vs 39 (Library detail), 49 (Docs), 52 (Settings), 56 (Assistant), 57 (part wizard)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate M
- Findings: Q11-007 · known ref K39

**Summary.** Measured at 1440×900 (same at 1100/1920): Home 34, Library 34, Designer Schem/PCB/3D/BOM/DRC 34 (bg --surface-rail) | Library detail 39 (sticky header py-2) | Docs 49 and only over the 259px tree column (editor column has no header; border slate-200 remap) | Settings 52 (transparent bg, 32px search) | Assistant 56 (h-14, bg-white, only over the chat pane x≥400; the chat-list column has none) | New-part wizard 57 (bg…

**Root cause.** `src/core/frontend/src/screens/SettingsScreen.tsx:53` — h-[52px]

**Proposed fix.** Sweep: every top-level screen header 34px (Settings C2, Docs K1, Assistant A1, wizard L2, Library detail L1). — Detail: Extract the Home/Library header (h-[34px] border-b border-border bg-surface-rail px-3, title 13px/500 + count) into a shared ModuleHeader and use it in SettingsScreen, Assistant Space, Knowledge Space (spanning both columns), ComponentDetailPage and ImportWizardPage (step indicator can sit in the header's centre slot).

**Evidence.** [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [020-hdr-home](../evidence/shots/vq11/dark/020-hdr-home.png)

<details><summary>Q11-007 — Top header bar height differs per screen: 34px on Home/Library/Designer vs 39 (Library detail), 49 (Docs), 52 (Settings), 56 (Assistant), 57 (part wizard) (S3, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1100x720, 1440x900, 1920x1080
- Repro:
  1. Visit Home, Library, Designer (any view), Library → Open a part, Docs, Assistant, Settings, Library → New part
  2. Measure the top bar (element at y=0 with a bottom border) — census/q11/*-metrics.json 'bands' or live getBoundingClientRect
- Expected: One 34px module header (bg --surface-rail, 1px --border) on every top-level screen, matching Home/Library/Designer (D10 sets 34px for the designer header, D13 for Home). Note: PLAN §0 scoped Settings/Assistant/Docs/import wizard as token re-skin only, so this is a known deferred gap (K39), not a regression.
- Actual: Measured at 1440×900 (same at 1100/1920): Home 34, Library 34, Designer Schem/PCB/3D/BOM/DRC 34 (bg --surface-rail) | Library detail 39 (sticky header py-2) | Docs 49 and only over the 259px tree column (editor column has no header; border slate-200 remap) | Settings 52 (transparent bg, 32px search) | Assistant 56 (h-14, bg-white, only over the chat pane x≥400; the chat-list column has none) | New-part wizard 57 (bg-white, border slate-200). Background differs too: #ececee (kit) vs #ffffff (Assistant, wizard) vs transparent (Settings, Docs) in light; border #d4d4d8 vs #dcdce0. Switching between rail modules makes the content jump vertically.
- Screenshots: [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png), [014-docs-1440](../evidence/shots/q11/light/014-docs-1440.png), [012-library-detail-1440](../evidence/shots/q11/dark/012-library-detail-1440.png), [013-library-wizard-step1-1440](../evidence/shots/q11/light/013-library-wizard-step1-1440.png), [001-home-list-1440](../evidence/shots/q11/light/001-home-list-1440.png)
- Census: `census/q11/settings-general-dark-1440.metrics.json`
- Code: `src/core/frontend/src/screens/SettingsScreen.tsx:53` — h-[52px]
- Code: `src/modules/assistant/frontend/Space.tsx:1373` — h-14 bg-white border-slate-200
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:147` — p-2 bar, tree column only
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:659` — wizard header bg-white
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:335` — py-2 instead of h-[34px]
- Suggested fix: Extract the Home/Library header (h-[34px] border-b border-border bg-surface-rail px-3, title 13px/500 + count) into a shared ModuleHeader and use it in SettingsScreen, Assistant Space, Knowledge Space (spanning both columns), ComponentDetailPage and ImportWizardPage (step indicator can sit in the header's centre slot).
- Verification (vq11): **confirmed** — Re-measured live in dark at 1440×900. Home, Library and Designer headers are 34px, bg rgb(15,15,16). Docs is 49px over the 259px tree column only, transparent. Assistant is 56px starting at x=400 (chat pane only), bg 95% alpha. Settings is 52px, transparent. Library detail is 39px. New-part wizard is 57px (opened, measured, closed with Esc, nothing saved). Code refs match: SettingsScreen.tsx:53 h-[52px], ComponentDetailPage sticky header py-2, ImportWizardPage.tsx:659. Refinement: the 'Expected' cited D10/D13 as mandating 34px on every screen, but they only cover Designer and Home, and PLAN §0 excluded these screens from structural changes. Still a valid release-quality inconsistency, and K39 lists it. Cross-agent overlap: Q2-007 (Settings), Q8-026 (Assistant 56px). · evidence: [020-hdr-home](../evidence/shots/vq11/dark/020-hdr-home.png), [020-hdr-docs](../evidence/shots/vq11/dark/020-hdr-docs.png), [020-hdr-assistant](../evidence/shots/vq11/dark/020-hdr-assistant.png), [020-hdr-settings](../evidence/shots/vq11/dark/020-hdr-settings.png), [021-library-detail](../evidence/shots/vq11/dark/021-library-detail.png), [022-library-wizard](../evidence/shots/vq11/dark/022-library-wizard.png)

</details>


## T-010

**Inspector title bars, card headers and table rows use off-spec heights: 28 vs 34px panel titles, 39/31px Library detail card headers, 20px Pins rows, 15px 'Open existing' rows**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate S
- Findings: Q11-008

**Summary.** Right-panel title bars: 28px (PcbPropertiesPanel, SelectionInspector, BOM rail) vs 34px (Home DesignDetailPanel, Library preview) for the same role. Library detail: 'DETAILS' is the kit 22px uppercase section header (surface-section fill, sans) while 'SYMBOL'/'FOOTPRINT' headers are 39px and '3D MODEL' 31px, hand-rolled px-3 py-2, no fill, mono caps — three header styles on one page. Library preview Pins table heade…

**Root cause.** `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:88` — h-[28px] title bar

**Proposed fix.** Sweep: panel titles 34/24px, card headers, table rows 22px (PCB props D3, Library detail L1). — Detail: Pick one inspector title-bar height and apply it everywhere: 28px (PcbPropertiesPanel.tsx:88, SelectionInspector.tsx:46, DesignerBomView.tsx:637) vs 34px (DesignDetailPanel.tsx:40, LibraryPreviewPane.tsx:90). In ComponentDetailPage.tsx:536/595/670 replace the hand-rolled `px-3 py-2` card headers with PanelSectionHeader variant=uppercase. In LibraryPreviewPane.tsx:235/243 use 22px Pins rows. In DesignerEmptyState.tsx:63 add `shrink-0` to the h-[22px] Open-existing buttons: they sit in a `flex max-h-64 flex-col over…

**Evidence.** [012-library-detail-1440](../evidence/shots/q11/dark/012-library-detail-1440.png), [021-library-detail](../evidence/shots/vq11/dark/021-library-detail.png)

<details><summary>Q11-008 — Inspector title bars, card headers and table rows use off-spec heights: 28 vs 34px panel titles, 39/31px Library detail card headers, 20px Pins rows, 15px 'Open existing' rows (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Compare the title bar of the right-hand panels: Designer dock Properties ('Board · Nothing selected'), BOM rail ('C1 · 1 part'), Home detail panel, Library preview pane
  2. Library → Open 74HC00: compare the 'DETAILS' header with 'SYMBOL', 'FOOTPRINT', '3D MODEL'
  3. Library table → preview pane → Pins table; Designer with no design → 'Open existing' list
- Expected: D10: section headers 24/22px (PanelSectionHeader variants), list/property rows 22px, one panel-title-bar height.
- Actual: Right-panel title bars: 28px (PcbPropertiesPanel, SelectionInspector, BOM rail) vs 34px (Home DesignDetailPanel, Library preview) for the same role. Library detail: 'DETAILS' is the kit 22px uppercase section header (surface-section fill, sans) while 'SYMBOL'/'FOOTPRINT' headers are 39px and '3D MODEL' 31px, hand-rolled px-3 py-2, no fill, mono caps — three header styles on one page. Library preview Pins table header and rows are 20px (kit tables 22px). Designer 'Open existing' rows are 398×15px buttons (tiny targets; duplicate names 'DRC Demo', 'Untitled Design', 'S3 LLM Smoke …' only differ by revision). Secondary bars vary: Library '27 of 27 · Select All' 26px, Outline segmented row 26px, toolbars 30px.
- Screenshots: [012-library-detail-1440](../evidence/shots/q11/dark/012-library-detail-1440.png), [010-library-table-1440](../evidence/shots/q11/dark/010-library-table-1440.png), [005-pcb-1440](../evidence/shots/q11/dark/005-pcb-1440.png), [008-bom-1440](../evidence/shots/q11/dark/008-bom-1440.png), [020-designer-empty-live](../evidence/shots/q11/dark/020-designer-empty-live.png)
- Census: `census/q11/library-table-dark-1440.metrics.json`
- Code: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:88` — h-[28px] title bar
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:637` — h-[28px] rail title bar
- Code: `src/core/frontend/src/screens/home/DesignDetailPanel.tsx:40` — h-[34px] title bar
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:235` — Pins header/rows h-[20px] (and :243)
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:536` — card headers px-3 py-2 (also :595, :670)
- Suggested fix: Pick one inspector title-bar height and apply it everywhere: 28px (PcbPropertiesPanel.tsx:88, SelectionInspector.tsx:46, DesignerBomView.tsx:637) vs 34px (DesignDetailPanel.tsx:40, LibraryPreviewPane.tsx:90). In ComponentDetailPage.tsx:536/595/670 replace the hand-rolled `px-3 py-2` card headers with PanelSectionHeader variant=uppercase. In LibraryPreviewPane.tsx:235/243 use 22px Pins rows. In DesignerEmptyState.tsx:63 add `shrink-0` to the h-[22px] Open-existing buttons: they sit in a `flex max-h-64 flex-col overflow-y-auto` list and flex-shrink squeezes them to 15px. Show the modified date to tell the duplicate names apart.
- Verification (vq11): **confirmed** — Verified live and in code. Library detail (74HC00) headers: DETAILS 22px with fill rgb(21,21,23); SYMBOL 39px, FOOTPRINT 39px and 3D MODEL 31px with transparent bg. The Designer empty state 'Open existing' has 20 buttons at 15×398. Root-cause refinement: DesignerEmptyState.tsx:63 declares h-[22px], but the rows are flex items in a max-h-64 flex-col list without shrink-0, so they shrink to their 15px content height. That is a real bug beyond the design drift. Title bars: h-[28px] at PcbPropertiesPanel.tsx:88, SelectionInspector.tsx:46 and DesignerBomView.tsx:637 vs h-[34px] at DesignDetailPanel.tsx:40 and LibraryPreviewPane.tsx:90. Pins rows are h-[20px] at LibraryPreviewPane.tsx:235/243. · evidence: [021-library-detail](../evidence/shots/vq11/dark/021-library-detail.png), [023-designer-empty](../evidence/shots/vq11/dark/023-designer-empty.png), live: 'Open existing' rows 20× 15x398; detail headers DETAILS h=22, SYMBOL h=39, FOOTPRINT h=39, 3D MODEL h=31

</details>


## T-011

**Search fields come in five variants: kit 22/20px vs Assistant 29px rounded-lg, Docs and Settings 32px hand-rolled inputs**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate S
- Findings: Q11-009 · known ref K37
- Depends on: ['T-004']

**Summary.** Kit SearchField 22px/11px: Home 'Search designs…', Library 'Search name, MPN, package…', facet 'Filter family…'/'Filter other…', BOM 'Filter ref, value, MPN…'; sm 20px: Outline 'Filter ref, value, net…'. Off-kit: Assistant 'Search chats' 29px, rounded-lg, border slate-300/bg-white; Docs 'Search...' 32px/12px (ASCII '...' not '…', radius on the input not the wrapper); Settings 'Search settings' 32px/12px in a 52px he…

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1174` — rounded-lg border-slate-300 bg-white search

**Proposed fix.** Sweep: all search fields = kit SearchField. — Detail: Replace the three hand-rolled inputs with SearchField (size default in headers, sm in side panels); use '…' in placeholders.

**Evidence.** [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png), [020-hdr-docs](../evidence/shots/vq11/dark/020-hdr-docs.png)

<details><summary>Q11-009 — Search fields come in five variants: kit 22/20px vs Assistant 29px rounded-lg, Docs and Settings 32px hand-rolled inputs (S3, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Compare the search inputs on Home, Library (header + facet filters), BOM, Schematic Outline, Assistant chat list, Docs tree, Settings header, Cmd+K palette
- Expected: One SearchField (22px, 11px text, 2px radius, --border-control, '/' hint where a hotkey exists) everywhere a list is filtered.
- Actual: Kit SearchField 22px/11px: Home 'Search designs…', Library 'Search name, MPN, package…', facet 'Filter family…'/'Filter other…', BOM 'Filter ref, value, MPN…'; sm 20px: Outline 'Filter ref, value, net…'. Off-kit: Assistant 'Search chats' 29px, rounded-lg, border slate-300/bg-white; Docs 'Search...' 32px/12px (ASCII '...' not '…', radius on the input not the wrapper); Settings 'Search settings' 32px/12px in a 52px header; Cmd+K palette 34px/12px row. Placeholder style also differs ('…' vs '...' vs none) and the '/' hint appears only on Home and Library.
- Screenshots: [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png), [014-docs-1440](../evidence/shots/q11/light/014-docs-1440.png), [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [001-home-list-1440](../evidence/shots/q11/light/001-home-list-1440.png), [dlg2-cmdk-search](../evidence/shots/q11/dark/dlg2-cmdk-search.png)
- Census: `census/q11/assistant-dark-1440.metrics.json`
- Code: `src/modules/assistant/frontend/Space.tsx:1174` — rounded-lg border-slate-300 bg-white search
- Code: `src/modules/knowledge/frontend/components/Sidebar/Sidebar.tsx:152` — placeholder 'Search...' 32px input
- Code: `src/core/frontend/src/screens/SettingsScreen.tsx:74` — hand-rolled 32px search
- Code: `src/shared/frontend/ui/search-field.tsx:19` — kit SearchField to reuse
- Suggested fix: Replace the three hand-rolled inputs with SearchField (size default in headers, sm in side panels); use '…' in placeholders.
- Verification (vq11): **confirmed** — Measured live in dark. Kit SearchField wrappers are 22px/11px with a 2px radius: Home 'Search designs…', Library 'Search name, MPN, package…' plus the 'Filter family…'/'Filter other…' facets. Docs 'Search...' is a 32px/12px input with the radius on the input. Settings 'Search settings' is a 32px/12px input. Assistant 'Search chats' is a 29px wrapper; rounded-lg renders 2px via the D1 remap, so the radius part of the claim is moot, but the height/border/bg drift stands. Code: assistant Space.tsx:1174, knowledge Sidebar.tsx:152 (focus:border-violet-500 remapped), SettingsScreen.tsx:74. Partial K37 (inputs only). Cross-agent overlap: Q9-015 (Docs), Q2-007 (Settings). · evidence: [020-hdr-docs](../evidence/shots/vq11/dark/020-hdr-docs.png), [020-hdr-assistant](../evidence/shots/vq11/dark/020-hdr-assistant.png), [020-hdr-settings](../evidence/shots/vq11/dark/020-hdr-settings.png), [020-hdr-home](../evidence/shots/vq11/dark/020-hdr-home.png)

</details>


## T-012

**Segmented/toggle groups have 7 implementations with different heights, radii and active colours (primary black, surface-control, selection-soft cyan, white, pills)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate S
- Findings: Q11-010

**Summary.** Kit SegmentedControl: 22px (opts 20px, 10px text) Home/Library/BOM; 20px (opts 18px) Outline, PCB display mode; active #d6d6da (--surface-control, light). Off-kit: DRC severity 18px, radius 0, custom buttons; Settings theme 25px buttons in a 34px bordered box, active = --primary #1c1c1f (black) in light; 3D camera 76×23px buttons radius 4px, active #dfedf1 (selection-soft cyan tint), inactive filled #747476 (dark gr…

**Root cause.** `src/modules/designer/frontend/components/DesignerDrcView.tsx:237` — severity toggles

**Proposed fix.** Sweep: all segmented/toggle groups = kit SegmentedControl. — Detail: Use the kit SegmentedControl for the mutually exclusive groups: ThemeToggle.tsx:29-47 (also gives the selected state to assistive tech), Board3DOverlay.tsx:161 camera presets (two groups), SymbolStep.tsx:66-86 Import file/Draw symbol, and assistant Space.tsx:1212 All/Pinned/Linked/Archived filters. Leave the DRC/ERC severity filters as toggle buttons (multi-select), but give them the kit Chip/ToolbarButton look instead of opacity-40 dimming.

**Evidence.** [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png)

<details><summary>Q11-010 — Segmented/toggle groups have 7 implementations with different heights, radii and active colours (primary black, surface-control, selection-soft cyan, white, pills) (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Compare: Home List|Grid, Library Table|Grid, BOM All|Missing MPN|DNP, Outline Parts|Nets|Labels, PCB Normal|Dim|Hide (kit)
  2. vs DRC severity toggles, Settings → General theme Light|Dark|System, 3D Camera Iso…Back, part wizard Import file|Draw symbol, Assistant All|Pinned|Linked|Archived
- Expected: All mutually-exclusive option groups use SegmentedControl (22px / sm 20px, active --surface-control).
- Actual: Kit SegmentedControl: 22px (opts 20px, 10px text) Home/Library/BOM; 20px (opts 18px) Outline, PCB display mode; active #d6d6da (--surface-control, light). Off-kit: DRC severity 18px, radius 0, custom buttons; Settings theme 25px buttons in a 34px bordered box, active = --primary #1c1c1f (black) in light; 3D camera 76×23px buttons radius 4px, active #dfedf1 (selection-soft cyan tint), inactive filled #747476 (dark grey slabs in light theme); wizard Import file|Draw symbol 117×27 in a 33px track, rounded-md + shadow, active #ffffff; Assistant filters 19px rounded-full pills. [vq11 correction] The DRC severity toggles are independent multi-select filters (aria-pressed per severity), not a mutually exclusive group, so SegmentedControl is the wrong target for them; their radius is rounded-control (2px), not 0. Also, the Settings theme buttons expose no aria-pressed/aria-checked, so the selected theme is not announced.
- Screenshots: [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [013-library-wizard-step1-1440](../evidence/shots/q11/light/013-library-wizard-step1-1440.png), [001-home-list-1440](../evidence/shots/q11/light/001-home-list-1440.png), [009-drc-1440](../evidence/shots/q11/dark/009-drc-1440.png), [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png)
- Pixel probes: {"file": "shots/q11/light/016-settings-general-1440.png", "x": 600, "y": 200, "hex": "#1c1c1f", "nearestToken": "--primary", "deltaE": 0.0}; {"file": "shots/q11/light/001-home-list-1440.png", "x": 990, "y": 12, "hex": "#d6d6da", "nearestToken": "--surface-control", "deltaE": 0.0}; {"file": "shots/q11/light/007-3d-1440.png", "x": 110, "y": 66, "hex": "#dfedf1", "nearestToken": "--selection-soft@app", "deltaE": 1.8}; {"file": "shots/q11/light/007-3d-1440.png", "x": 190, "y": 66, "hex": "#747476", "nearestToken": "--text-caps", "deltaE": 3.5}; {"file": "shots/q11/light/013-library-wizard-step1-1440.png", "x": 120, "y": 80, "hex": "#ffffff", "nearestToken": "--surface-input", "deltaE": 0.0}
- Census: `census/q11/agg-controls.txt`
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:237` — severity toggles
- Code: `src/core/frontend/src/components/ThemeToggle.tsx:9` — theme options
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:161` — camera buttons 'rounded px-1 py-1 text-[10px]'
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:86` — Import file / Draw symbol toggle
- Code: `src/shared/frontend/ui/segmented-control.tsx:58` — kit reference
- Suggested fix: Use the kit SegmentedControl for the mutually exclusive groups: ThemeToggle.tsx:29-47 (also gives the selected state to assistive tech), Board3DOverlay.tsx:161 camera presets (two groups), SymbolStep.tsx:66-86 Import file/Draw symbol, and assistant Space.tsx:1212 All/Pinned/Linked/Archived filters. Leave the DRC/ERC severity filters as toggle buttons (multi-select), but give them the kit Chip/ToolbarButton look instead of opacity-40 dimming.
- Verification (vq11): **confirmed** — Verified in light with pixel probes. Settings theme 'Light' active is 56×25 with bg #1c1c1f (--primary, ΔE 0). 3D 'Iso' active #dfedf1 (--selection-soft, ΔE 1.8). Inactive 'Persp' #747476 slab, 76×23 at radius 4px. Kit segmented active #d6d6da (--surface-control). Wizard toggle: SymbolStep.tsx:66-86 uses rounded-md + bg-white + shadow-sm. Refuted sub-claim: the DRC severity toggles (DesignerDrcView.tsx:232-240) are multi-select aria-pressed filters, not a segmented group, and use rounded-control (2px, not radius 0). The 3D, Settings and wizard surfaces are PLAN §0 token-reskin-only (deferred). The contrast of the 3D light-theme slabs is covered by cross-agent Q5-028. · evidence: [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png), [062-3d](../evidence/shots/vq11/light/062-3d.png), probe light 060 600,200 #1c1c1f --primary dE=0.0; 062 105,68 #dfedf1 --selection-soft dE=1.8; 062 190,68 #747476 --text-caps dE=3.5

</details>


## T-013

**Button sizes/variants drift outside the kit: 22px kit buttons next to 23–41px hand-rolled ones, and mixed footer buttons (OK 22px vs text-link Cancel 15px)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate M
- Findings: Q11-011

**Summary.** Kit: Home 'Import KiCad…'/'New design'/'Open' 22, Library 'Import library…'/'New part'/'Open' 22, PCB 'Edit'/'Fit to parts'/'Edit rules…' 22, DRC 'Run DRC'/'Edit rules' 20. Off-kit: Settings nav rows 36, action buttons 33/35/41, Back 32×32; Assistant 'New' 27, 'Collapse sidebar' 28, row actions 24; 3D 'Snapshot'/'Measure' 25, camera 23; wizard 'Next' 32px, font-semibold, violet-remapped fill + shadow-sm, back arrow…

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:700` — Next: h-8 border-violet-600 bg-violet-600 shadow-sm

**Proposed fix.** Sweep: kit Button/IconButton sizes everywhere; dialog footers secondary Cancel + primary OK. — Detail: Swap hand-rolled buttons for kit Button/IconButton (Settings panels, Assistant sidebar, 3D overlay, wizard footer/header, LabelPicker footer → secondary 'Cancel' + primary 'OK').

**Evidence.** [016-settings-libraries-1440](../evidence/shots/q11/light/016-settings-libraries-1440.png), [012-dlg-powerport](../evidence/shots/vq11/dark/012-dlg-powerport.png)

<details><summary>Q11-011 — Button sizes/variants drift outside the kit: 22px kit buttons next to 23–41px hand-rolled ones, and mixed footer buttons (OK 22px vs text-link Cancel 15px) (S3, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Measure text buttons on Home/Library/Designer (kit) vs Settings, Assistant, 3D view, part wizard, power-port picker
- Expected: Kit Button: 22px default / 20px sm, 11px text, 2px radius; primary = --primary fill.
- Actual: Kit: Home 'Import KiCad…'/'New design'/'Open' 22, Library 'Import library…'/'New part'/'Open' 22, PCB 'Edit'/'Fit to parts'/'Edit rules…' 22, DRC 'Run DRC'/'Edit rules' 20. Off-kit: Settings nav rows 36, action buttons 33/35/41, Back 32×32; Assistant 'New' 27, 'Collapse sidebar' 28, row actions 24; 3D 'Snapshot'/'Measure' 25, camera 23; wizard 'Next' 32px, font-semibold, violet-remapped fill + shadow-sm, back arrow 24px unnamed; power-port picker footer: 'OK' 22px button beside 'Cancel' as a 15px text link; Docs 'Import document'/'New page' 32×20 icon buttons.
- Screenshots: [016-settings-libraries-1440](../evidence/shots/q11/light/016-settings-libraries-1440.png), [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png), [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [013-library-wizard-step1-1440](../evidence/shots/q11/light/013-library-wizard-step1-1440.png), [dlg2-powerport-open](../evidence/shots/q11/light/dlg2-powerport-open.png)
- Census: `census/q11/agg-controls.txt`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:700` — Next: h-8 border-violet-600 bg-violet-600 shadow-sm
- Code: `src/modules/designer/frontend/components/LabelPicker.tsx:80` — picker footer
- Code: `src/shared/frontend/ui/button.tsx:34` — kit sizes
- Suggested fix: Swap hand-rolled buttons for kit Button/IconButton (Settings panels, Assistant sidebar, 3D overlay, wizard footer/header, LabelPicker footer → secondary 'Cancel' + primary 'OK').
- Verification (vq11): **confirmed** — Code and live confirmed. ImportWizardPage.tsx:699 'Next' is h-8 rounded-md border-violet-600 bg-violet-600 font-semibold shadow-sm (violet remapped to neutral). The LabelPicker footer (LabelPicker.tsx:88-107) pairs a 22px primary 'OK' with a text-link 'Cancel' (text-xs text-text-tertiary, no button chrome), visible in the power-port picker screenshot. The Settings theme buttons are 25px (measured). The 3D Snapshot/Measure and camera buttons are 23-25px. Kit Button sizes are 22/20px (button.tsx:34-37). · evidence: [012-dlg-powerport](../evidence/shots/vq11/dark/012-dlg-powerport.png), [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png), [062-3d](../evidence/shots/vq11/light/062-3d.png), [022-library-wizard](../evidence/shots/vq11/dark/022-library-wizard.png)

</details>


## T-014

**Modal surfaces use four recipes; no kit confirm/prompt helpers (enables native-dialog removal)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate M
- Findings: Q11-013 · known ref K06
- Depends on: ['T-014']

**Summary.** Kit Dialog: overlay black/50, panel --surface-panel, shadow-xl. PCB Design rules & Export: overlay black/40, panel --surface-raised (#e2e2e5 light / rgb(28,28,31) dark), shadow-2xl '0 25px 50px -12px rgba(0,0,0,.25)', title 'Design rules' 12px/600. Power-port picker: overlay black/50, --surface-raised, shadow-lg, p-3. Cmd+K: --surface-raised, shadow-lg. Home delete: overlay black/50, --surface-raised, shadow-lg, tit…

**Root cause.** `src/core/frontend/src/components/ui/dialog.tsx:47` — kit: bg-surface-panel shadow-xl, overlay :27 bg-black/50

**Proposed fix.** One kit Dialog recipe (overlay 50%, surface-panel, no heavy shadow, 12/600 title) with focus trap + restore; add confirmDialog()/promptDialog() helpers for K02–K06 migrations. — Detail: Port these to the kit Dialog (also fixes Q11-005) and standardise titles to sentence case 12px/500.

**Evidence.** [dlg2-pcb-rules-open](../evidence/shots/q11/light/dlg2-pcb-rules-open.png), [010-dlg-pcb-rules](../evidence/shots/vq11/dark/010-dlg-pcb-rules.png)

<details><summary>Q11-013 — Modal surfaces use four recipes: overlay 40% vs 50%, panel --surface-panel vs --surface-raised, shadow-xl/2xl/lg, title 12px/600 vs 12px/500 (S4, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Open (and cancel) PCB 'Edit rules…', PCB 'Export…', Schem 'Place power port', Cmd+K palette, Home '…' → Delete
- Expected: One dialog recipe (kit Dialog: bg-black/50 overlay, --surface-panel, border, rounded-float, one shadow level, 12–13px/500 title, sentence case).
- Actual: Kit Dialog: overlay black/50, panel --surface-panel, shadow-xl. PCB Design rules & Export: overlay black/40, panel --surface-raised (#e2e2e5 light / rgb(28,28,31) dark), shadow-2xl '0 25px 50px -12px rgba(0,0,0,.25)', title 'Design rules' 12px/600. Power-port picker: overlay black/50, --surface-raised, shadow-lg, p-3. Cmd+K: --surface-raised, shadow-lg. Home delete: overlay black/50, --surface-raised, shadow-lg, title 'Delete Design' 12px/500 in Title Case (others sentence case).
- Screenshots: [dlg2-pcb-rules-open](../evidence/shots/q11/light/dlg2-pcb-rules-open.png), [dlg2-pcb-export-open](../evidence/shots/q11/light/dlg2-pcb-export-open.png), [dlg2-powerport-open](../evidence/shots/q11/light/dlg2-powerport-open.png), [dlg2-home-delete-open](../evidence/shots/q11/light/dlg2-home-delete-open.png), [dlg2-cmdk-open](../evidence/shots/q11/dark/dlg2-cmdk-open.png)
- Census: `census/q11/dlg2-pcb-export-light.json`
- Code: `src/core/frontend/src/components/ui/dialog.tsx:47` — kit: bg-surface-panel shadow-xl, overlay :27 bg-black/50
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:286` — bg-black/40, :291 bg-surface-raised shadow-2xl
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:178` — bg-surface-raised shadow-2xl
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:58` — shadow-lg, 'Delete Design'
- Suggested fix: Port these to the kit Dialog (also fixes Q11-005) and standardise titles to sentence case 12px/500.
- Verification (vq11): **confirmed** — Verified by code reading, which is acceptable for S4, plus the dialog screenshots. Kit dialog.tsx:27 overlay bg-black/50, :47 bg-surface-panel shadow-xl. PcbDesignRulesDialog.tsx:286/291 and PcbExportDialog.tsx:173/178 use bg-black/40 + bg-surface-raised + shadow-2xl. LabelPicker.tsx:40/47 uses bg-black/50 + bg-surface-raised + shadow-lg. ComponentCommandPalette.tsx:290/292 uses bg-surface-raised + shadow-lg. HomeScreen.tsx:58-62 uses bg-surface-raised + shadow-lg and the Title Case 'Delete Design'. Same five hand-rolled dialogs as Q11-005, and porting to the kit Dialog fixes both. Kept separate because Q11-005 is behavioural (S2) and this one is visual (S4). · evidence: [010-dlg-pcb-rules](../evidence/shots/vq11/dark/010-dlg-pcb-rules.png), [011-dlg-pcb-export](../evidence/shots/vq11/dark/011-dlg-pcb-export.png), [012-dlg-powerport](../evidence/shots/vq11/dark/012-dlg-powerport.png), [013-dlg-cmdk](../evidence/shots/vq11/dark/013-dlg-cmdk.png), [014-home-delete-mouse](../evidence/shots/vq11/dark/014-home-delete-mouse.png)

</details>


## T-015

**Sub-10px text still ships on 4 top-level screens (9px 3D panel labels, 9.5px Library source badges, 9px Assistant/Settings chips)**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate XS
- Findings: Q11-014 · known ref K36

**Summary.** 3D view: 7 labels at 9px — CAMERA, DISPLAY, BOARD COLOR, SCENE, TRANSPARENCY, TALLEST PARTS and the dock model pill 'STRICT'. Library table: 28 source badges 'core'/'user' at 9.5px (every row). Assistant space: design-link chips on chat rows ('S3 LLM Edge — additive v2', 'probe', …) and 'STRICT'/'BEST' at 9px (5–7 per view). Settings → Assistant: 'Advanced', 'Caution', 'LOCAL' ×2, 'DEFAULT' at 9px. Same counts in bo…

**Root cause.** `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:89` — text-[9px] section labels (also :313)

**Proposed fix.** Sweep: census 0 sub-10px text (3D, Library badges, Assistant chips, Settings, wizard). — Detail: Replace text-[9px]/text-[9.5px] with text-2xs (10px) everywhere (grep 'text-\[9'); uppercase micro-labels can keep tracking.

**Evidence.** [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [030-3d](../evidence/shots/vq11/dark/030-3d.png)

<details><summary>Q11-014 — Sub-10px text still ships on 4 top-level screens (9px 3D panel labels, 9.5px Library source badges, 9px Assistant/Settings chips) (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1100x720, 1440x900, 1920x1080
- Repro:
  1. Run $QA/scripts/dom-census.js on each screen (census/q11/*.json → smallText)
- Expected: No text under 10px (kit minimum text-2xs = 10px).
- Actual: 3D view: 7 labels at 9px — CAMERA, DISPLAY, BOARD COLOR, SCENE, TRANSPARENCY, TALLEST PARTS and the dock model pill 'STRICT'. Library table: 28 source badges 'core'/'user' at 9.5px (every row). Assistant space: design-link chips on chat rows ('S3 LLM Edge — additive v2', 'probe', …) and 'STRICT'/'BEST' at 9px (5–7 per view). Settings → Assistant: 'Advanced', 'Caution', 'LOCAL' ×2, 'DEFAULT' at 9px. Same counts in both themes and all three viewports. Zero sub-10px text on Home, Designer Schem/PCB/BOM/DRC, Library grid/detail, Docs, other Settings tabs.
- Screenshots: [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [010-library-table-1440](../evidence/shots/q11/dark/010-library-table-1440.png), [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png), [016-settings-assistant-1440](../evidence/shots/q11/light/016-settings-assistant-1440.png)
- Census: `census/q11/library-table-dark-1440.json`
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:89` — text-[9px] section labels (also :313)
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:227` — text-[9.5px] source badge
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:124` — text-[9px] STRICT
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:425` — text-[9px] (also :586, :591)
- Code: `src/core/frontend/src/settings/panels/McpSection.tsx:141` — text-[9px] Caution
- Suggested fix: Replace text-[9px]/text-[9.5px] with text-2xs (10px) everywhere (grep 'text-\[9'); uppercase micro-labels can keep tracking.
- Verification (vq11): **confirmed** — Live DOM text scan. Library table: 18× 'core' and 10× 'user' at 9.5px. Assistant space: 5 design-link chips plus 'Strict'/'Best' at 9px. 3D: Camera, Display, Board color, Scene, Transparency, Tallest parts and 'Strict' at 9px. Home: none. `grep 'text-\[9' src` finds 27 uses in .tsx, matching K36 exactly (Board3DOverlay.tsx:89/313, LibraryTable.tsx:227, LibraryPreviewPane.tsx:95, ModelSelectorPill.tsx:124, AssistantPanel.tsx:425/586/591, McpSection.tsx:141, import-wizard Pin/PadPropertyPanel, BomResultCard, ComponentResultCard, MermaidDiagram). Cross-agent overlap: Q2-023, Q6-033, Q7-024 (all K36). · evidence: [030-3d](../evidence/shots/vq11/dark/030-3d.png), live scan library {'9.5px:core':18,'9.5px:user':10}; assistant 7× 9px; 3d 7× 9px

</details>


## T-016

**Radius flattening leaks: bare `rounded` still renders 4px, Assistant bubbles 10px, and rounded-full pills are used for non-status labels that are square elsewhere**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate S
- Findings: Q11-015

**Summary.** Generated CSS `.rounded{border-radius:.25rem}` is not covered by the --radius-sm…3xl overrides, so every bare `rounded` renders 4px: 3D camera buttons (22 elements), Assistant chips/badges (11 dark / 16 light), Settings 'Advanced'/'Caution', model pill 'STRICT'; 24 .tsx files use bare `rounded`. Assistant message bubbles use rounded-[10px]. rounded-full pills: Settings 'LOCAL', 'DEFAULT', 'Up to date', 'user', 'core…

**Root cause.** `src/core/frontend/src/index.css:35` — --radius-sm…3xl flattened, but bare `rounded` (0.25rem) is not

**Proposed fix.** Override --radius (bare `rounded`) to 2px in index.css @theme; A1/A2 drop 10px bubble radii; restrict rounded-full to status dots. — Detail: In src/core/frontend/src/index.css @theme add `--radius: 2px;`. Tailwind 4.3's bare `rounded` utility reads the `--radius` theme key (themeKeys:['--radius']) and today falls back to 0.25rem, so this one line flattens all 26 files using bare `rounded`. Replace MessageCard.tsx:383 `rounded-[10px_10px_2px_10px]` with rounded-control, and move non-status rounded-full badges (Settings 'Up to date'/'user'/'core'/'read-only'/'LOCAL'/'DEFAULT', assistant filter pills, GenericProposalCard) onto the kit Chip.

**Evidence.** [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [062-3d](../evidence/shots/vq11/light/062-3d.png)

<details><summary>Q11-015 — Radius flattening leaks: bare `rounded` still renders 4px, Assistant bubbles 10px, and rounded-full pills are used for non-status labels that are square elsewhere (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Inspect 3D camera buttons, Assistant chat chips/bubbles, Settings → Assistant/Libraries badges; compare Library 'core'/'user' badges
- Expected: D1: controls 2px, floats 3px, pills only for status pills.
- Actual: Generated CSS `.rounded{border-radius:.25rem}` is not covered by the --radius-sm…3xl overrides, so every bare `rounded` renders 4px: 3D camera buttons (22 elements), Assistant chips/badges (11 dark / 16 light), Settings 'Advanced'/'Caution', model pill 'STRICT'; 24 .tsx files use bare `rounded`. Assistant message bubbles use rounded-[10px]. rounded-full pills: Settings 'LOCAL', 'DEFAULT', 'Up to date', 'user', 'core', 'read-only', Assistant filters 'All 12' etc., 'BEST' — while Library shows the same 'core'/'user' source as square badges and the Library detail 'CORE' badge is 2px.
- Screenshots: [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [015-assistant-1440](../evidence/shots/q11/dark/015-assistant-1440.png), [016-settings-libraries-1440](../evidence/shots/q11/dark/016-settings-libraries-1440.png), [010-library-table-1440](../evidence/shots/q11/dark/010-library-table-1440.png)
- Census: `census/q11/3d-dark-1440.metrics.json`
- Code: `src/core/frontend/src/index.css:35` — --radius-sm…3xl flattened, but bare `rounded` (0.25rem) is not
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:161` — 'rounded px-1 py-1'
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:475` — rounded-full 'Up to date'
- Suggested fix: In src/core/frontend/src/index.css @theme add `--radius: 2px;`. Tailwind 4.3's bare `rounded` utility reads the `--radius` theme key (themeKeys:['--radius']) and today falls back to 0.25rem, so this one line flattens all 26 files using bare `rounded`. Replace MessageCard.tsx:383 `rounded-[10px_10px_2px_10px]` with rounded-control, and move non-status rounded-full badges (Settings 'Up to date'/'user'/'core'/'read-only'/'LOCAL'/'DEFAULT', assistant filter pills, GenericProposalCard) onto the kit Chip.
- Verification (vq11): **confirmed** — The live stylesheet has `.rounded { border-radius: 0.25rem }` while .rounded-lg/-md/-xl resolve to var(--radius-*)=2px. The 3D camera buttons measure radius 4px in both themes. 26 .tsx files use bare `rounded`. The assistant user bubble is rounded-[10px_10px_2px_10px] (MessageCard.tsx:383). Settings → Libraries 'Up to date', 'user', 'core' and 'read-only' are rounded-full pills (measured radius 3.3e7px), while the Library table renders core/user as square 9.5px text. The Tailwind source check (lib.mjs) shows the `rounded` family uses themeKeys ['--radius'], so a `--radius` theme token is the minimal fix. · evidence: [062-3d](../evidence/shots/vq11/light/062-3d.png), [061-settings-libraries](../evidence/shots/vq11/light/061-settings-libraries.png), css: '.rounded { border-radius: 0.25rem; }'

</details>


## T-017

**Status badges and banners are inconsistent: info notes painted as amber warnings, cyan selection colour used as 'success', the same 'core' badge rendered three ways**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate S
- Findings: Q11-019

**Summary.** 'Up to date' (Settings → Libraries) uses --selection cyan text (rgb 8,145,178) in a rounded-full pill instead of a success/status token. 'read-only' is a raw amber pill (oklch amber-100/700). MCP 'Caution' is raw amber-100/amber-700 at 9px with bare `rounded` (4px). The 'core' source badge renders three ways: Library table 9.5px caps text, detail header 2px 'CORE' badge with a lock, Settings 18px rounded-full pill.…

**Root cause.** `src/core/frontend/src/settings/panels/GeneralPanel.tsx:19` — DesktopOnlyNote bg-amber-50 text-amber-900

**Proposed fix.** Kit Banner (info/warning/danger/success via status tokens) + Badge; info notes neutral, success never cyan --selection. — Detail: Introduce one Badge/Notice on status tokens. LibrariesPanel.tsx:475 'Up to date' → --status-success-soft/-fg Chip (square, 2px). LibrariesPanel 'read-only' and McpSection.tsx:141 'Caution' → --status-warning-soft token Chip at text-2xs. Unify the core/user source badge (LibraryTable.tsx:227, ComponentDetailPage header, LibrariesPanel). Low priority: move GeneralPanel.tsx:17 DesktopOnlyNote to a neutral info tone (browser/dev only).

**Evidence.** [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png)

<details><summary>Q11-019 — Status badges and banners are inconsistent: info notes painted as amber warnings, cyan selection colour used as 'success', the same 'core' badge rendered three ways (S3, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings → General / Privacy (desktop-only notes); Settings → Libraries ('Up to date', 'core'); Settings → Assistant MCP ('Caution')
  2. Designer BOM → select C1 (missing MPN banner); Library table 'core'/'user'; Library detail header 'CORE'; Home DRC pills
- Expected: Status tokens only (--status-*-soft/-fg), one Chip/Pill component, info≠warning.
- Actual: 'Up to date' (Settings → Libraries) uses --selection cyan text (rgb 8,145,178) in a rounded-full pill instead of a success/status token. 'read-only' is a raw amber pill (oklch amber-100/700). MCP 'Caution' is raw amber-100/amber-700 at 9px with bare `rounded` (4px). The 'core' source badge renders three ways: Library table 9.5px caps text, detail header 2px 'CORE' badge with a lock, Settings 18px rounded-full pill. BOM 'C1: missing MPN…' uses the correct --status-warning-soft token but at 10px, radius 0, no icon. [vq11] The amber 'Updates are managed by the OpenPCB desktop app.' / 'Local file locations…' notes are browser-only: GeneralPanel renders DesktopOnlyNote only when the Electron bridge is absent, so desktop users never see them.
- Screenshots: [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [016-settings-libraries-1440](../evidence/shots/q11/dark/016-settings-libraries-1440.png), [banner-bom-missing-mpn](../evidence/shots/q11/light/banner-bom-missing-mpn.png), [banner-settings-mcp-caution](../evidence/shots/q11/light/banner-settings-mcp-caution.png), [012-library-detail-1440](../evidence/shots/q11/dark/012-library-detail-1440.png)
- Pixel probes: {"file": "shots/q11/light/016-settings-general-1440.png", "x": 1100, "y": 333, "hex": "#fffbeb", "nearestToken": "--surface-input", "deltaE": 8.4}; {"file": "shots/q11/dark/016-settings-general-1440.png", "x": 1100, "y": 333, "hex": "#311b0f", "nearestToken": "--status-warning-soft@app", "deltaE": 8.8}
- Census: `census/q11/banners-light.json`
- Code: `src/core/frontend/src/settings/panels/GeneralPanel.tsx:19` — DesktopOnlyNote bg-amber-50 text-amber-900
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:475` — rounded-full … text-selection
- Code: `src/core/frontend/src/settings/panels/McpSection.tsx:141` — raw amber Caution
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:227` — 9.5px source badge
- Suggested fix: Introduce one Badge/Notice on status tokens. LibrariesPanel.tsx:475 'Up to date' → --status-success-soft/-fg Chip (square, 2px). LibrariesPanel 'read-only' and McpSection.tsx:141 'Caution' → --status-warning-soft token Chip at text-2xs. Unify the core/user source badge (LibraryTable.tsx:227, ComponentDetailPage header, LibrariesPanel). Low priority: move GeneralPanel.tsx:17 DesktopOnlyNote to a neutral info tone (browser/dev only).
- Verification (vq11): **confirmed** — Partially refuted, rest confirmed. The headline sub-claim (information notes painted as amber warnings, probe #fffbeb) is a browser-vs-Electron artefact. GeneralPanel.tsx:60-67 and :164-171 render DesktopOnlyNote only when `updater` / `api.getDiagnosticsPaths` are missing, i.e. outside Electron, so shipped desktop users never see those banners. Confirmed live in light: 'Up to date' fg rgb(8,145,178) = --selection in a rounded-full pill, 'read-only' amber oklch pill, 'core'/'user' rounded-full 18px pills vs the square 9.5px table badges. MCP 'Caution' is code-confirmed at McpSection.tsx:141 (raw amber, 9px, bare rounded). Severity stays S3 (off-token status colours). Cross-agent overlap: Q2-008 (K45 Settings banners). · evidence: [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png), [061-settings-libraries](../evidence/shots/vq11/light/061-settings-libraries.png), live: 'Up to date' fs=11px rad=pill fg=rgb(8,145,178); 'read-only' fg=oklch(0.555 0.163 49) bg=oklch(0.962 0.059 95.6)

</details>


## T-018

**Tab widgets behave three different ways and PCB Layers costs ~40 Tab stops: dock tabs/layer strip lack arrow keys & roving tabindex, view tablist unnamed, design tab tabindex=-1**

- Severity **S3** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate M
- Findings: Q11-022

**Summary.** View tabs (Radix): roving tabindex + arrows + aria-controls, but the tablist has no aria-label. DockTabs 'Side panel' (Properties/ERC/DRC/Assistant) and PCB layer strip (7 tabs): every tab in the Tab order, no arrow-key support, no aria-controls. Design tab strip: tabs are <div role=tab> without tabIndex (property -1), so open designs are unreachable by keyboard. PCB: stops 21–60 of the tab walk are all inside the L…

**Root cause.** `src/shared/frontend/ui/dock-tabs.tsx:49` — plain buttons role=tab, no roving tabindex/keydown handling/aria-controls

**Proposed fix.** Roving tabindex + arrow keys in kit Tabs/DockTabs; name the view tablist; D3 collapses PCB Layers panel to one tab stop with arrow navigation. — Detail: Implement roving tabindex + ArrowLeft/Right in DockTabs (or build it on Radix Tabs), name the view tablist ('Designer views'), give the active design tab tabIndex 0, and make the Layers list a single roving-focus listbox (opacity/eye reachable via arrow/shortcut).

**Evidence.** [tab-pcb-40](../evidence/shots/q11/dark/tab-pcb-40.png)

<details><summary>Q11-022 — Tab widgets behave three different ways and PCB Layers costs ~40 Tab stops: dock tabs/layer strip lack arrow keys & roving tabindex, view tablist unnamed, design tab tabindex=-1 (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Designer: focus view tab 'Schem', press ArrowRight → moves to PCB (Radix)
  2. Focus dock tab 'Properties', press ArrowRight → nothing happens
  3. Tab through the PCB view from the header
- Expected: All role=tab widgets follow one pattern (roving tabindex, Arrow keys, aria-controls, named tablist); long lists use roving focus so the canvas/dock are reachable quickly.
- Actual: View tabs (Radix): roving tabindex + arrows + aria-controls, but the tablist has no aria-label. DockTabs 'Side panel' (Properties/ERC/DRC/Assistant) and PCB layer strip (7 tabs): every tab in the Tab order, no arrow-key support, no aria-controls. Design tab strip: tabs are <div role=tab> without tabIndex (property -1), so open designs are unreachable by keyboard. PCB: stops 21–60 of the tab walk are all inside the Layers panel (row + opacity + eye per layer, group toggles) before the Components list, zoom cluster or dock.
- Screenshots: [tab-pcb-40](../evidence/shots/q11/dark/tab-pcb-40.png), [005-pcb-1440](../evidence/shots/q11/dark/005-pcb-1440.png)
- Census: `census/q11/tab-pcb-dark.json`
- Code: `src/shared/frontend/ui/dock-tabs.tsx:49` — plain buttons role=tab, no roving tabindex/keydown handling/aria-controls
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:195` — design tab is a <div role=tab> without tabIndex → not focusable
- Suggested fix: Implement roving tabindex + ArrowLeft/Right in DockTabs (or build it on Radix Tabs), name the view tablist ('Designer views'), give the active design tab tabIndex 0, and make the Layers list a single roving-focus listbox (opacity/eye reachable via arrow/shortcut).
- Verification (vq11): **confirmed** — Reproduced in dark. Dock tab 'Properties' + ArrowRight does nothing. View tab 'PCB' + ArrowRight moves to 3D (Radix) and ArrowLeft moves back. Tablists: 'Open designs' has 1 tab with 0 tabbable (the design tab is a DIV with tabIndex -1), the view tablist is unnamed with roving (1 tabbable of 5), 'PCB layers' has 7 of 7 tabbable, 'Side panel' has 3 of 3 tabbable. There is no keyboard shortcut to switch design tabs (no Ctrl+Tab or similar in Space.tsx/DesignTabs.tsx), so open designs can't be reached without a mouse. Raised S4→S3 on that basis (keyboard operability gap, same class as Q11-021). Cross-agent overlap: Q3-033. · evidence: live: tablists ['Open designs:1:tabbable=0','(none):5:tabbable=1','PCB layers:7:tabbable=7','Side panel:3:tabbable=3']; design tab DIV tabIndex=-1

</details>


## T-019

**Shadow / backdrop-blur / gradient leftovers on docked surfaces: 3D overlay cards, Assistant composer and fade, part-wizard canvas bar, glowing status dots**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate S
- Findings: Q11-016 · known ref K45

**Summary.** 3D: Mechanical card 192×265 'rounded-lg shadow-xl backdrop-blur(8px) bg-slate-900/90'; Snapshot/Measure bar 187×35 same; 3D and Assistant model pill status dot has a glow shadow-[0_0_6px_currentColor]. Assistant space: composer 1008×98 'rounded-xl shadow-xl shadow-slate-900/5'; 80px linear-gradient fade above it. Part wizard: canvas 'Grid · Zoom: scroll wheel' pill with shadow-sm + backdrop-blur(8px); 'Next' button…

**Root cause.** `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:272` — rounded-lg … shadow-xl backdrop-blur (also :338, :345, :365)

**Proposed fix.** Sweep: remove shadow/blur/gradient on docked surfaces (3D, composer, wizard, status glow). — Detail: Replace with flat token surfaces: bg-surface-panel border border-border rounded-float, no shadow/blur; drop the gradient fade and the dot glow.

**Evidence.** [007-3d-1440](../evidence/shots/q11/dark/007-3d-1440.png), [030-3d](../evidence/shots/vq11/dark/030-3d.png)

<details><summary>Q11-016 — Shadow / backdrop-blur / gradient leftovers on docked surfaces: 3D overlay cards, Assistant composer and fade, part-wizard canvas bar, glowing status dots (S4, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Open GUIDE-VALIDATE → 3D; Assistant space; Library → New part (then close); measure box-shadow/backdrop-filter/background-image (census/q11/*-metrics.json shadows/blurs/grads)
- Expected: Flat docked UI: no drop shadows, blur or gradients on panels/HUDs (floating menus/dialogs only).
- Actual: 3D: Mechanical card 192×265 'rounded-lg shadow-xl backdrop-blur(8px) bg-slate-900/90'; Snapshot/Measure bar 187×35 same; 3D and Assistant model pill status dot has a glow shadow-[0_0_6px_currentColor]. Assistant space: composer 1008×98 'rounded-xl shadow-xl shadow-slate-900/5'; 80px linear-gradient fade above it. Part wizard: canvas 'Grid · Zoom: scroll wheel' pill with shadow-sm + backdrop-blur(8px); 'Next' button shadow-sm; Import/Draw toggle shadow. Zero shadows/blur/gradients on Home, Library, Designer Schem/PCB/BOM/DRC, Docs, Settings (clean). Both themes identical.
- Screenshots: [007-3d-1440](../evidence/shots/q11/dark/007-3d-1440.png), [007-3d-1440](../evidence/shots/q11/light/007-3d-1440.png), [015-assistant-1440](../evidence/shots/q11/dark/015-assistant-1440.png), [013-library-wizard-step1-1440](../evidence/shots/q11/light/013-library-wizard-step1-1440.png)
- Census: `census/q11/3d-dark-1440.metrics.json`
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:272` — rounded-lg … shadow-xl backdrop-blur (also :338, :345, :365)
- Code: `src/modules/assistant/frontend/Space.tsx:1747` — rounded-xl shadow-xl composer
- Code: `src/modules/assistant/frontend/Space.tsx:1730` — bg-gradient-to-t fade
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:119` — shadow-[0_0_6px_currentColor] dot
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:156` — shadow-sm backdrop-blur canvas bar (also FootprintStep.tsx:101, FootprintEditorToolbar.tsx:96)
- Suggested fix: Replace with flat token surfaces: bg-surface-panel border border-border rounded-float, no shadow/blur; drop the gradient fade and the dot glow.
- Verification (vq11): **confirmed** — Measured live. 3D Mechanical card (192×265) and Snapshot/Measure bar (187×35): shadow-xl at 10% alpha + backdrop-blur(8px) + bg-slate-900/90. The model-pill dot has a 6px currentColor glow. Assistant composer (1008×98) has shadow-xl at 5% alpha, with an 80px linear-gradient fade above it. Code refs match. Downgraded S3→S4: the effects are nearly invisible (a 10%-alpha shadow and an 8px blur over the near-black 3D canvas, a 5%-alpha composer shadow), and all of them sit on surfaces PLAN §0 scoped as token re-skin only, with §9 tracking the follow-up (K45 bucket). Visibility problems on these surfaces are covered by cross-agent Q5-028 (3D light theme) and Q8-026 (Assistant). · evidence: [030-3d](../evidence/shots/vq11/dark/030-3d.png), [062-3d](../evidence/shots/vq11/light/062-3d.png), [063-assistant](../evidence/shots/vq11/light/063-assistant.png), computed: 3D card 'rgba(0,0,0,0.1) 0 20px 25px -5px, …' backdrop blur(8px); composer 'oklab(…/0.05) 0 20px 25px -5px'

</details>


## T-020

**Icon stroke widths mix 1.5px (kit), 1.8px (Settings) and 2px (Lucide default) on the same screens**

- Severity **S4** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate XS
- Findings: Q11-017

**Summary.** Per screen (dark 1440): Home 2px×41 vs 1.5×8; Library table 1.5×35 vs 2×13; Schematic 1.5×21 vs 2×13; PCB 2×44 vs 1.5×22; 3D 2×22 vs 1.5×8; Docs 2×31 vs 1.5×8; Settings About 1.5×15 + 1.8×5; Settings Assistant 1.5×15 + 2×14. Icon sizes in use: 10, 11, 12, 13, 14, 16, 18, 20px. Header action icons (Import KiCad…, New design) are 2px next to 1.5px rail icons.

**Root cause.** `src/core/frontend/src/settings/panels/AboutPanel.tsx:88` — strokeWidth={1.8}

**Proposed fix.** Sweep: Lucide strokeWidth 1.5 everywhere (global default). — Detail: Set a global default (e.g. `.lucide{stroke-width:1.5}` in index.css or a LucideProvider-like wrapper) and remove ad-hoc strokeWidth props.

**Evidence.** [001-home-list-1440](../evidence/shots/q11/dark/001-home-list-1440.png)

<details><summary>Q11-017 — Icon stroke widths mix 1.5px (kit), 1.8px (Settings) and 2px (Lucide default) on the same screens (S4, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Count computed stroke-width of lucide SVGs per screen (census/q11/*-metrics.json iconStroke)
- Expected: One stroke weight for UI icons (rail/toolbar use 1.5 per design-D2 §2).
- Actual: Per screen (dark 1440): Home 2px×41 vs 1.5×8; Library table 1.5×35 vs 2×13; Schematic 1.5×21 vs 2×13; PCB 2×44 vs 1.5×22; 3D 2×22 vs 1.5×8; Docs 2×31 vs 1.5×8; Settings About 1.5×15 + 1.8×5; Settings Assistant 1.5×15 + 2×14. Icon sizes in use: 10, 11, 12, 13, 14, 16, 18, 20px. Header action icons (Import KiCad…, New design) are 2px next to 1.5px rail icons.
- Screenshots: [001-home-list-1440](../evidence/shots/q11/dark/001-home-list-1440.png), [005-pcb-1440](../evidence/shots/q11/dark/005-pcb-1440.png), [016-settings-about-1440](../evidence/shots/q11/dark/016-settings-about-1440.png)
- Census: `census/q11/home-list-dark-1440.metrics.json`
- Code: `src/core/frontend/src/settings/panels/AboutPanel.tsx:88` — strokeWidth={1.8}
- Code: `src/shared/frontend/ui/toolbar.tsx:61` — toolbar forces [stroke-width:1.5]
- Suggested fix: Set a global default (e.g. `.lucide{stroke-width:1.5}` in index.css or a LucideProvider-like wrapper) and remove ad-hoc strokeWidth props.
- Verification (vq11): **confirmed** — Live Home in light: 59 Lucide icons at 2px vs 8 at 1.5px; the header 'Import KiCad…' and 'New design' icons are 2px next to 1.5px rail icons. Code: 10× strokeWidth={1.8} and 17× {1.5} ad-hoc props; toolbar.tsx forces 1.5 only inside toolbars; index.css sets no global stroke width. Counts differ from q11's dark run (41) because of list content, but the claim stands. · evidence: live: {'1.5px':8,'2px':59}; hdr Import KiCad…:2px, New design:2px

</details>


## T-021

**Typography scale drifts between screens: 11px body on kit screens vs 12–14px on Settings/Docs/Assistant; page/panel titles 13/500, 13/600, 15/600, 20/500, 20/600**

- Severity **S4** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner W4 · wave W4 · scope frontend · estimate S
- Findings: Q11-018

**Summary.** Dominant body size 11px on Home/Library/Designer (plus 10px captions) but 12px on Settings (General 10×12px), Docs tree (9×12px), Assistant (17×12px, 10×14px message text). Titles: module header 'Designs'/'Library'/'Settings' 13px/500; Settings panel titles 'General'/'Privacy' 13px/600 but 'Libraries'/'Assistant' 15px/600; About 'OpenPCB' 20px/600; Library detail H1 20px/500; wizard 'New component' 15px/600; dialog…

**Root cause.** `src/core/frontend/src/index.css:19` — text scale tokens 10/11/12/13

**Proposed fix.** Sweep: 11px body type scale on Settings/Docs/Assistant; one title scale. — Detail: Normalise Settings/Docs/Assistant body to text-xs, panel titles to one size (e.g. 13px/600), and page H1 to one size; drop arbitrary sizes.

**Evidence.** [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png)

<details><summary>Q11-018 — Typography scale drifts between screens: 11px body on kit screens vs 12–14px on Settings/Docs/Assistant; page/panel titles 13/500, 13/600, 15/600, 20/500, 20/600 (S4, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Compare computed font sizes (census/q11/*-metrics.json fontSizes, headings)
- Expected: Token scale text-2xs 10 / xs 11 / sm 12 / base 13 applied consistently: body 11px, panel titles one size.
- Actual: Dominant body size 11px on Home/Library/Designer (plus 10px captions) but 12px on Settings (General 10×12px), Docs tree (9×12px), Assistant (17×12px, 10×14px message text). Titles: module header 'Designs'/'Library'/'Settings' 13px/500; Settings panel titles 'General'/'Privacy' 13px/600 but 'Libraries'/'Assistant' 15px/600; About 'OpenPCB' 20px/600; Library detail H1 20px/500; wizard 'New component' 15px/600; dialog titles 'Design rules' 12px/600 vs 'Delete Design' 12px/500. Off-scale sizes 9, 9.5 (Q11-014) and 10.5px (BOM designators).
- Screenshots: [016-settings-general-1440](../evidence/shots/q11/light/016-settings-general-1440.png), [016-settings-libraries-1440](../evidence/shots/q11/light/016-settings-libraries-1440.png), [012-library-detail-1440](../evidence/shots/q11/dark/012-library-detail-1440.png), [015-assistant-1440](../evidence/shots/q11/light/015-assistant-1440.png)
- Census: `census/q11/settings-libraries-dark-1440.metrics.json`
- Code: `src/core/frontend/src/index.css:19` — text scale tokens 10/11/12/13
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:520` — text-[10.5px]
- Suggested fix: Normalise Settings/Docs/Assistant body to text-xs, panel titles to one size (e.g. 13px/600), and page H1 to one size; drop arbitrary sizes.
- Verification (vq11): **confirmed** — Code check. Settings panel titles: General/Privacy `text-base font-semibold`, Libraries/Assistant `text-lg font-semibold`, Account `text-lg font-medium`, About `text-xl font-semibold`. BOM designators `text-[10.5px]` at DesignerBomView.tsx:520. Dialog titles differ in weight (see Q11-013). The Settings/Docs/Assistant body-size drift sits on PLAN §0 token-reskin-only surfaces. · evidence: src/core/frontend/src/settings/panels/*.tsx h2 classes, [060-settings-general](../evidence/shots/vq11/light/060-settings-general.png), [061-settings-libraries](../evidence/shots/vq11/light/061-settings-libraries.png)

</details>


## T-022

**Empty states use six different patterns (icon+text, text-only, bordered card+button, left-aligned stack, rounded box) with no shared component**

- Severity **S4** · category consistency · status confirmed · themes dark
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate S
- Findings: Q11-020

**Summary.** Home: centred 16px icon + 'No matching designs' + hint, no action (no 'Clear filter'). Library: centred text only ('No components match the current filters.' + 'Import a component to get started' — wrong hint for a search miss). Docs: bordered card, 40px icon, 'No page selected', 'New page' button. Designer: bordered 448px card, 13px/500 title, full-width primary button + 15px-row list. Outline: left-aligned title +…

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:322` — Home empty

**Proposed fix.** Kit EmptyState (icon, title, body, optional action); area owners adopt in W2/W3; W4 verifies. — Detail: Add src/shared/frontend/ui/empty-state.tsx and use it in these six places; make filter-empty copy say what to clear ('No pinned chats', 'No parts match “…” — Clear search').

**Evidence.** [021-empty-states-montage](../evidence/shots/q11/dark/021-empty-states-montage.png), [050-empty-home](../evidence/shots/vq11/dark/050-empty-home.png)

<details><summary>Q11-020 — Empty states use six different patterns (icon+text, text-only, bordered card+button, left-aligned stack, rounded box) with no shared component (S4, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Home → Starred (0)
  2. Library → search 'zzqq-nomatch'
  3. Docs with no page selected
  4. Designer with no design open (fresh session)
  5. Schem Outline of an empty design
  6. Assistant → Pinned (0)
- Expected: One EmptyState (icon, 12px title, 11px hint, optional primary action) used everywhere.
- Actual: Home: centred 16px icon + 'No matching designs' + hint, no action (no 'Clear filter'). Library: centred text only ('No components match the current filters.' + 'Import a component to get started' — wrong hint for a search miss). Docs: bordered card, 40px icon, 'No page selected', 'New page' button. Designer: bordered 448px card, 13px/500 title, full-width primary button + 15px-row list. Outline: left-aligned title + 3 stacked full-width buttons. Assistant Pinned: rounded bordered box 'No chats yet.' although 12 chats exist (filter-empty copy is wrong).
- Screenshots: [021-empty-states-montage](../evidence/shots/q11/dark/021-empty-states-montage.png), [021-empty-home-starred](../evidence/shots/q11/dark/021-empty-home-starred.png), [021-empty-library-nomatch](../evidence/shots/q11/dark/021-empty-library-nomatch.png), [021-empty-assistant-pinned](../evidence/shots/q11/dark/021-empty-assistant-pinned.png), [020-designer-empty-live](../evidence/shots/q11/dark/020-designer-empty-live.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:322` — Home empty
- Code: `src/modules/library/frontend/Space.tsx:738` — Library empty
- Code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:215` — Docs empty
- Code: `src/modules/designer/frontend/components/DesignerEmptyState.tsx:26` — Designer empty
- Code: `src/modules/assistant/frontend/Space.tsx:1351` — 'No chats yet.' for any empty filter
- Suggested fix: Add src/shared/frontend/ui/empty-state.tsx and use it in these six places; make filter-empty copy say what to clear ('No pinned chats', 'No parts match “…” — Clear search').
- Verification (vq11): **confirmed** — Reproduced in dark. Home 'Starred 0': centred 'No matching designs / Try a different filter or search term' with no clear action. Library search 'zzqq-nomatch': 'No components match the current filters.' + 'Import a component to get started.' (wrong hint for a search miss; the header also drops to '0 parts · 0 sources'). Assistant 'Pinned 0': 'No chats yet.' while 'All 14' exists (misleading copy). Designer no-tabs: bordered card + 15px list (see Q11-008). Kept at S4 as a consistency finding. The misleading Pinned copy is also covered by cross-agent Q8-005 (S3). · evidence: [050-empty-home](../evidence/shots/vq11/dark/050-empty-home.png), [051-empty-library](../evidence/shots/vq11/dark/051-empty-library.png), [052-empty-assistant-pinned](../evidence/shots/vq11/dark/052-empty-assistant-pinned.png), [023-designer-empty](../evidence/shots/vq11/dark/023-designer-empty.png)

</details>


## T-023

**Console noise: THREE.Clock deprecation + 'WebGLRenderer: Context Lost' logged on every preview canvas mount/unmount; favicon 404**

- Severity **S4** · category console · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate XS
- Findings: Q7-033

**Summary.** Each canvas mount logs '[WARNING] THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' (×2) and unmount logs 'THREE.WebGLRenderer: Context Lost.' (×2) — 42 warnings in one wizard session; '/favicon.ico 404'.

**Root cause.** `None:None` — 

**Proposed fix.** THREE.Clock deprecation + Context Lost logs on preview mount/unmount (r3f/three upgrade). — Detail: Upgrade @react-three/fiber (uses THREE.Timer) or silence via THREE.Clock shim; ship a favicon in src/core/frontend/public.

**Evidence.** `console: [WARNING] THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`

<details><summary>Q7-033 — Console noise: THREE.Clock deprecation + 'WebGLRenderer: Context Lost' logged on every preview canvas mount/unmount; favicon 404 (S4, confirmed)</summary>

- Area cross-cutting · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open Library, open/close the wizard, switch wizard steps
- Expected: Clean console.
- Actual: Each canvas mount logs '[WARNING] THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' (×2) and unmount logs 'THREE.WebGLRenderer: Context Lost.' (×2) — 42 warnings in one wizard session; '/favicon.ico 404'.
- Console: `[WARNING] THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`; `[LOG] THREE.WebGLRenderer: Context Lost.`; `[ERROR] Failed to load resource: 404 … /favicon.ico`
- Suggested fix: Upgrade @react-three/fiber (uses THREE.Timer) or silence via THREE.Clock shim; ship a favicon in src/core/frontend/public.
- Verification (vq7): **confirmed** — This vq7-light session alone logged 15 'THREE.THREE.Clock: This module has been deprecated' warnings and 13 'THREE.WebGLRenderer: Context Lost.' logs across wizard/library canvas mounts; favicon.ico 404 on load (also recorded as Q1-025 by another agent). S4. · evidence: console: [WARNING] THREE.THREE.Clock … x15; [LOG] THREE.WebGLRenderer: Context Lost. x13; [ERROR] 404 /favicon.ico

</details>

