# OpenPCB UI QA protocol (read fully before testing)

You are a senior QA engineer / UX reviewer doing **manual exploratory testing** of OpenPCB, a desktop
PCB/EDA app (React + R3F canvases), through `playwright-cli` against isolated dev stacks. The app just
went through a "neutral EDA" visual redesign; the goal is that it looks and behaves like a
professional EDA tool (KiCad / Altium / Flux quality bar) and is release-ready. Be picky, concrete,
evidence-driven. You DO NOT modify the repository. Reading repo code (grep/Read) to cite `codeRefs`
is encouraged.

Repo: `/Users/andrejvysny/workspace/openpcb/OpenPCB` (frontend `src/core/frontend/src`, modules
`src/modules/*/frontend`, shared kit `src/shared/frontend/ui`, tokens `src/core/frontend/src/index.css`,
redesign decisions `PLAN.md` §2 D1–D15).
QA root (`$QA`): `/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/f18aac79-e8af-4eed-b528-c505e87cbf8a/scratchpad/qa`

## Stacks (already running — never start/stop/restart servers, never run `npm run dev`)
| Stack | Frontend URL | Backend | Purpose |
|---|---|---|---|
| A | http://127.0.0.1:1520 | 3100 | main QA; cloud OFF; real LLM (OpenRouter free model) |
| B | http://127.0.0.1:1620 | 3200 | Library / part wizard / Settings mutations; no LLM keys |
| C1 | http://127.0.0.1:1720 | 3300 | cloud flags ON but all cloud URLs dead (offline) |
Each stack has its own copy of the DB. Design ownership: `$QA/inventory/assignments.json`. Only
mutate designs you own or create (name new ones `QA-<yourAgentId>-...`). Never delete others'.
Library / provider / settings mutations only on stack B. Never read, print, dump or screenshot API
keys; do not run `request-body`/`response-body` on `/providers` requests; on stack A do not open the
provider editor.

## playwright-cli conventions
- ALWAYS run from `$QA`: `cd $QA && playwright-cli -s=<session> <cmd>` (artifacts land in `$QA/.playwright-cli/`).
- Session names: `<agentId>-dark`, `<agentId>-light` (e.g. `q4-dark`). Use one theme session at a
  time where possible; close your sessions at the end (`playwright-cli -s=<s> close`).
- Setup per session: `open <url>` → `resize 1440 900` →
  `eval "() => { localStorage.setItem('theme','dark'); return 'ok' }"` → `reload`. (light: `'light'`.)
  Headless Chromium prefers light, so without the key the app boots light.
- Install the dialog spy after every load/reload: `eval "$(cat $QA/scripts/dialog-spy.js)"` — it
  counts `window.prompt/confirm/alert` calls (native dialogs will still appear; handle with
  `dialog-accept [text]` / `dialog-dismiss`). A native dialog in this app is itself a finding.
- Snapshot refs (`eNN`) are regenerated on every `snapshot`; never reuse a ref across snapshots.
  Prefer role selectors: `click "role=button[name='Library']"`, `click "role=tab[name='PCB']"`,
  `dblclick "text=Dual LED Blinker"` (Home list opens designs on double-click). `snapshot --boxes`
  gives element geometry for canvas-relative mouse work (`mousemove x y`, `mousedown`, `mouseup`,
  `mousewheel dx dy`, `press <key>`, `keydown Shift` … `keyup Shift`).
- `eval` must be SYNCHRONOUS (a promise-returning eval hangs the CLI). Fire-and-forget is fine:
  `eval "() => { import('/src/stores/navigation-store.ts').then(m => m.useNavigationStore.getState()...); return 'ok' }"`.
- A reload returns to Home (in-memory navigation) — re-navigate. Designer tabs persist.
- If `snapshot` returns empty YAML the React tree crashed — that is an S1 finding; grab console.
- Error-state injection (per session only; ALWAYS `unroute` after):
  `route "**/api/modules/designer/designs" --status 500 --content-type application/problem+json --body '{"type":"about:blank","title":"Internal error","status":500}'`
  and `network-state-set offline` / `online`. Never kill or restart backends.
- Screenshots: `screenshot --filename=$QA/shots/<area>/<theme>/<NNN>-<slug>.png` (element: add target).
- Console: after each flow `console warning` (and `console error`); record new errors/warnings.
  Known noise to ignore: React DevTools info, favicon.ico 404 (still note favicon once as S4),
  Vite HMR messages, `[secure-storage] … falling back to localStorage` (browser-only).
- DOM census: `eval "$(cat $QA/scripts/dom-census.js)" --filename=$QA/census/<area>-<screen>-<theme>-<vw>.json`
  → sub-10px text, control heights (kit standard 22px, sm 20px), nameless buttons/inputs,
  "coming soon" controls, top computed colours, native dialog call counts.
- Colour/theme claims MUST come from pixel probes, not from looking at the image (the image viewer
  misrenders light screenshots as dark):
  `python3 $QA/scripts/probe.py <png> --theme dark|light x,y:label ...` → hex + nearest token + ΔE.
  `python3 $QA/scripts/palette-audit.py <png> --theme dark|light --mask x0,y0,x1,y1` (mask canvases).
  Token values: `$QA/scripts/tokens.json`. Use the Read tool on PNGs for layout/structure only.
- Viewports: primary 1440×900; also check layout at 1100×720 (Electron minimum window) for every
  screen you own (`resize 1100 720`); Q11 also 1920×1080.
- Fixtures (copies, OK to upload): `$QA/fixtures/` — `KiCad_Example_Project_USBtoUART.zip` (full
  KiCad project), `geckonator-kicad.zip` (KiCad 5 legacy .sch project), `LM324N.zip`, `OP07CD.zip`,
  `kicad-with-step.zip`, `minimal.step`, `garbage.step`, `board-rect.dxf`, `*.kicad_mod`,
  `parsers/*.kicad_sym|*.kicad_mod`, `openpcb-core-library-0.1.0-beta.{1,2}.opclib`, `sample.pdf`,
  `sample.md`, `sample.txt`. File inputs: click the control that opens the chooser, then
  `upload <abs path>`.

## What to look for (both themes, every screen/state you touch)
Functional: does every control do what its label says; errors surfaced and recoverable; no dead
ends; state persists as expected (reload); keyboard shortcuts work and don't fire while typing;
Esc/Enter behave; undo/redo; no console errors. UX: discoverability, feedback (loading/saving/
success/failure), sensible empty states, confirmation for destructive actions, copy clarity, focus
management (dialogs trap + return focus), keyboard-only operability. Visual (pro EDA bar): flat
neutral design per tokens (2px radii, no stray shadows/blur/gradients, no violet/blue/slate casts,
status colours only via tokens), consistent heights (header 34px, section headers 24px, rows 22px,
controls 22px), alignment, truncation, overflow, text ≥10px, icon consistency, light/dark parity,
contrast. Compare sibling screens for consistency. Note anything that looks amateur.

## Findings — append one JSON object per line to `$QA/findings/raw/<agentId>.jsonl`
```json
{"id":"<AGENT>-<NNN>","knownRef":"K12|N1|null","area":"home|shell|settings|designer.shell|designer.schematic|designer.pcb|designer.3d|designer.bom|designer.drc|designer.import|designer.comments|library.browse|library.detail|library.import|library.wizard|library.symbol-editor|library.footprint-editor|assistant.space|assistant.dock|docs|tasks|cloud|cross-cutting",
 "title":"short imperative problem statement","category":"crash|bug|data|visual|consistency|a11y|keyboard|copy|stub|error-handling|perf|console",
 "severity":"S1|S2|S3|S4","themes":["dark","light"],"viewports":["1440x900"],"stack":"A|B|C1","designId":null,
 "repro":["step 1","step 2"],"expected":"...","actual":"...",
 "evidence":{"screenshots":["shots/…png"],"console":["…"],"pixelProbes":[{"file":"…","x":0,"y":0,"hex":"#…","nearestToken":"…","deltaE":0}],"census":"census/…json","network":["GET /api/… → 500"]},
 "codeRefs":[{"path":"src/…","line":123,"note":"…"}],"suggestedFix":"...","fixScope":"frontend|backend-needed|shared-package|design-decision",
 "estimate":"XS|S|M|L","dedupeKey":"area:component:symptom-slug","status":"new"}
```
Severity: **S1** crash/white screen, data loss, core flow blocked (create, place, wire, route, DRC,
export, save), secret exposed. **S2** feature broken w/ workaround, wrong data shown, one theme
unreadable, keyboard trap, misleading claim, native prompt/confirm (breaks in Electron). **S3**
visible inconsistency, missing label/focus style, confusing copy, off-token colour, sub-10px text.
**S4** polish. Write S1/S2 findings immediately when found. One finding per root problem; list all
affected places inside it. Include a screenshot for every visual finding.
`suggestedFix` should be concrete (file + what to change). `fixScope=shared-package` when the
cause is inside `node_modules/@openpcb/*` (e.g. canvas palette in `@openpcb/r3f-eda-canvas`).

## Known findings (from code recon) — CONFIRM or REFUTE the ones in your charter
Record each as a finding with `knownRef` set (status confirmed by your evidence) or, if refuted,
list it in coverage `known[]` with status `refuted` + evidence. Catalog: `$QA/known-findings.md`.

## Coverage — write `$QA/findings/coverage/<agentId>.json` at the end
`{"agent":"q4","checklist":[{"item":"...","dark":"tested|blocked|n/a","light":"...","viewports":["1440x900"]}],"known":[{"ref":"K12","status":"confirmed|refuted|partial","evidence":"..."}],"untested":[{"item":"...","reason":"..."}]}`

## Your final answer
Return ONLY the JSON: `{"agent":"<id>","findingsFile":"...","coverageFile":"...","counts":{"S1":0,"S2":0,"S3":0,"S4":0},"knownStatus":[{"ref":"K..","status":".."}],"blockers":["..."],"topIssues":["one line each, max 8"]}`
