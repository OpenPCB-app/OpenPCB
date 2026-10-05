export const meta = {
  name: 'ui-qa-discovery',
  description: 'Manual QA via playwright-cli across all OpenPCB surfaces, adversarial verification, completeness critic, triage',
  phases: [
    { title: 'Discover', detail: '11 area QA agents (throttled to 7 browsers) each followed by an adversarial verifier' },
    { title: 'Critic', detail: 'coverage gap analysis -> follow-up charters (max 2 rounds)' },
    { title: 'Triage', detail: 'dedupe verified findings into TRIAGE.md + triage.json' },
  ],
}

const QA = '/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/f18aac79-e8af-4eed-b528-c505e87cbf8a/scratchpad/qa'

function limiter(n) {
  let active = 0
  const q = []
  const next = () => {
    if (active >= n || !q.length) return
    active++
    const { fn, res, rej } = q.shift()
    fn().then(res, rej).finally(() => { active--; next() })
  }
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next() })
}
const browser = limiter(7)

const QA_SCHEMA = {
  type: 'object',
  properties: {
    agent: { type: 'string' },
    findingsFile: { type: 'string' },
    coverageFile: { type: 'string' },
    counts: { type: 'object', properties: { S1: { type: 'number' }, S2: { type: 'number' }, S3: { type: 'number' }, S4: { type: 'number' } } },
    knownStatus: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, status: { type: 'string' } } } },
    blockers: { type: 'array', items: { type: 'string' } },
    topIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['agent', 'findingsFile', 'coverageFile', 'counts', 'topIssues'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    agent: { type: 'string' },
    verifiedFile: { type: 'string' },
    confirmed: { type: 'number' },
    rejected: { type: 'number' },
    duplicates: { type: 'number' },
    needsInfo: { type: 'number' },
    confirmedBySeverity: { type: 'object', properties: { S1: { type: 'number' }, S2: { type: 'number' }, S3: { type: 'number' }, S4: { type: 'number' } } },
    notes: { type: 'string' },
  },
  required: ['agent', 'verifiedFile', 'confirmed', 'rejected', 'confirmedBySeverity'],
}
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    stop: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'string' } },
    charters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, stack: { type: 'string' }, area: { type: 'string' },
          focus: { type: 'string' }, checklist: { type: 'array', items: { type: 'string' } },
          designs: { type: 'string' },
        },
        required: ['id', 'stack', 'area', 'focus', 'checklist'],
      },
    },
  },
  required: ['stop', 'gaps', 'charters'],
}
const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    triageMd: { type: 'string' }, triageJson: { type: 'string' },
    totals: { type: 'object', properties: { confirmed: { type: 'number' }, S1: { type: 'number' }, S2: { type: 'number' }, S3: { type: 'number' }, S4: { type: 'number' }, rejected: { type: 'number' } } },
    s1: { type: 'array', items: { type: 'string' } },
    decisionsNeeded: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['triageMd', 'triageJson', 'totals', 'summary'],
}

const COMMON = `First read ${QA}/QA_PROTOCOL.md (binding rules), ${QA}/known-findings.md, ${QA}/surface-inventory.md and ${QA}/inventory/assignments.json. Do NOT edit any file in the repository. Work in both dark and light themes and at 1440x900 plus a 1100x720 layout check. Record findings as JSONL per the protocol, write the coverage file, close your playwright sessions, and return the JSON summary.`

const CHARTERS = [
  { id: 'q3', stack: 'A', title: 'Designer shell + schematic editor', text: `Designs you own on stack A: 1198c943 'S3 LLM Edge — 12V params', 37099ba4 'S3 LLM Edge — additive v2', plus new QA-q3-* designs.
Checklist: Designer rail entry with no open tabs -> empty state (K19); open designs from it; design tabs: open several, switch, dblclick rename + context menu Rename/Close/Close others/Close all, drag reorder, middle-click close, New design button, Cmd+W; view tabs Schem/PCB/3D/BOM/DRC; left sidebar resize; right dock tabs Properties/ERC/Assistant, dock width + tab persistence across reload, Cmd+I, Cmd+. ("Toggle side panel").
Schematic: every toolbar button + tooltip; Cmd+K palette (search, arrows, Enter places, Esc); G, P (power picker), H (net portal picker), L (net label); draw wires pin->corners->pin, wire to wire T-junction; drag a part; drag a wire segment (N1: note snapping); R and Shift+R — verify actual rotation direction vs menu/tooltip labels (K28); Delete/Backspace; Cmd+A; Cmd+Z / Cmd+Shift+Z (K17) vs toolbar Undo/Redo; box select; right-click menus on part, wire, label, port, empty canvas; outline panel Parts/Nets/Labels, filter, column sort, row click selects on canvas, dblclick frames, Actions menu Frame/Rename/Duplicate/Delete, empty-design outline state incl "Browse library" (K21); Properties inspector: edit Value (Enter/Esc/blur), Tolerance, footprint variant, fields MPN/Manufacturer/Datasheet, DNP, "Open in Library" (K21), "View on PCB" cross-probe, "Replace component" (K43), multi-select batch Value, label + wire inspectors; typing in inspector inputs must not trigger canvas hotkeys; ERC dock: Run ERC, severity toggles, click violation selects+frames; comment mode C: add comment, open thread, reply, resolve, Esc; status bar (cursor X/Y, zoom, hint, ERC count click); zoom cluster, Fit schematic, Zoom to selection, wheel zoom/pan; grid (K44: is a grid drawn? do parts land on grid?); load error: route "**/projection/schematic*" to 500 then open a design (K09) — then unroute; check light-theme schematic canvas background colour vs tokens (K38, probe).` },
  { id: 'q4', stack: 'A', title: 'PCB editor', text: `Designs you own on stack A: c2c58a19 'Dual LED Blinker', 3196d811 'DRC Demo' (rev 11), plus new QA-q4-* designs.
Checklist: toolbar every button + tooltip + disabled states; DRC count consistency between toolbar DRC button, dock DRC tab badge and status bar (spike saw 13 vs 19); Route: R, click pad, corners, Enter/End finish, Esc cancel, Backspace, width W/Shift+W, trace width dropdown "Custom…" (K03 native prompt), via V / + / - while routing, via preset/diameter/drill dropdowns and their Custom (K03), corner mode 45/90, posture /, layer switch T/B/1/2 while routing; route hint text (K16); Board O: draw outline, edit vertices, fillet/chamfer/set position/set length via context menus (CornerOpModal/EdgeDimModal: Enter/Esc); Import DXF… with ${QA}/fixtures/board-rect.dxf; Add menu: Hole H, Pad P, Text T (K02 native prompt), Zone Z (draw polygon, typed dims, Enter), Keepout K, Comment C (K14: does C key work?); Shift+Z zone cutout; M measure; U tune; F flip selected / selection filter with nothing selected; R rotate selected part; Flip part button; Delete; Cmd+Z/Cmd+Shift+Z/Ctrl+Y; Cmd+A (K18); context menus on empty canvas (K15 label for route mode), trace, via, placement; overlap picker; View menu ratsnest/guides/DRC markers; Layers panel: eye toggles, Alt+click solo, opacity slider, preset select, copper fill toggle + net/pad connection selects, display mode Normal/Dim/Hide + Ctrl+H, group collapse; layer tab strip clicks + flip view; Components panel row click selects/centres; Properties dock for: nothing (Board panel: shape Rect/Rounded/Circle/Oval, size inputs, presets, Apply, Fit to parts, Stackup, Edit rules…, Summary), single footprint, multi, free hole, pad, text, zone, keepout, trace/via; Design rules dialog: edit, Cancel, Save, focus a <select> inside it and press R / T / Delete (K12); open dock Assistant tab and type 'rotate test' in the composer (K12: do PCB hotkeys fire?); DRC dock Run DRC, progress, violations list, click violation centres canvas, Waive/Un-waive, severity toggles, Edit rules; full DRC view tab; Export… dialog on a 2-layer board (K30 inner copper checkbox), DRC gate, Download (note result); autolayout/route board/auto place buttons with cloud off; status bar (cursor, zoom, layer, hint, selection, view side); canvas clear colour probe vs --surface-canvas-well (K38); light theme parity of all chrome.` },
  { id: 'q5', stack: 'A', title: '3D view, BOM, KiCad project import, comments', text: `Designs you own on stack A: 370447e2 'LED Indicators 5V', 3f9e4e24 '555 Timer LED Blinker', plus new QA-q5-* designs (incl. KiCad imports).
Checklist: 3D view: load time, camera presets Iso/Persp/Top/Front/Side/Back, display toggles (Components, Silkscreen, Refdes, Floor grid), Height heatmap / STEP-STL / Measure stubs (K43), board colour swatches, scene select, transparency slider, mechanical panel collapse/expand, Snapshot button (K27 label; does it download?), zoom readout, orbit/zoom with mouse, overlay visuals (shadows/blur/raw colours K45) both themes. BOM: filters All/Missing MPN/DNP, search, row click -> inspector, edit MPN/Manufacturer/Supplier/price (autosave indicator, reload persistence), DNP toggle and bulk Mark/Clear DNP, select all, sort, totals row, Order quantity, Export menu (CSV, Copy TSV, JLC BOM, PnP, KiCad CSV) + Cmd+E, Show in schematic/PCB cross-probe, empty design BOM (create QA-q5-empty; K31), keyboard-only row navigation (K35). KiCad project import (Home -> Import KiCad…): ${QA}/fixtures/KiCad_Example_Project_USBtoUART.zip (review step, name override, import, open result: check schematic + PCB + BOM of imported design), ${QA}/fixtures/geckonator-kicad.zip (legacy KiCad 5), ${QA}/fixtures/sample.txt (invalid) -> error UX; Esc/Cancel; dialog styling (K45). Comments: schematic C mode and PCB Add -> Comment: create comment, Cmd+Enter post, thread popup (reply, resolve/reopen, status, reactions, attachment with ${QA}/fixtures/sample.md), Esc handling, pin visuals both themes, offscreen markers.` },
  { id: 'q7', stack: 'B', title: 'Library part wizard + symbol/footprint editors', text: `Stack B. Create parts named QA-q7-*.
Checklist: Library -> New part wizard: progress bar clicks, Back/Next, Enter=next, Esc (closes? confirm if dirty? K06/K29); Symbol step: Import file ${QA}/fixtures/parsers/simple_resistor.kicad_sym, multi_unit_opamp.kicad_sym, unsupported_construct.kicad_sym (error UX); Draw symbol: tools Select V, Line L, Rect R, Circle C, Arc A, Pin P, Text T; pin property panel edits; rotate R/Shift+R and their labels (K28); undo/redo; Cmd+A/C/V/D; alignment guides Shift+G; Esc while mid-draw (K29 — does it close the wizard?); grid; Footprint step: Preset picker (IPC density A/B/C), Import ${QA}/fixtures/parsers/C_0603_1608Metric.kicad_mod and CP_Elec_6.3x5.4_Nichicon.kicad_mod (multiple), Draw mode tools (pad D), pad property panel inputs/selects, layer panel, "Show dimensions + distances"; 3D Model step: ${QA}/fixtures/minimal.step then ${QA}/fixtures/garbage.step (error UX), Remove; Metadata: reference prefix, description, tags; Import component -> part appears in Library -> detail page correct; leave wizard with unsaved work via rail/Back (K06 confirm). Visual: tiny text (K36), input heights (K37), raw colours / hand-rolled controls (K45), toolbar consistency with the designer toolbars, both themes, 1100x720 (does the editor fit?).` },
  { id: 'q9', stack: 'A', title: 'Docs (knowledge) + Tasks', text: `Stack A. Create pages named QA-q9-*. EARLY in your run, create a page 'QA-q9-mention-target' and write its page id + title to ${QA}/inventory/handoff.json as {"pageId":"...","pageTitle":"..."} (Q8 uses it for @page mention tests; get the id from the network request list or the API GET /api/modules/knowledge/...).
Checklist: Docs sidebar search (+ no results), New page, title edit, Saving…/Saved indicator, reload persistence, editor toolbar every button (Undo, Redo, Bold, Italic, Strikethrough, Inline code, H1-H3, bullet/numbered/task list, quote, code block, link dialog Enter/Esc), markdown shortcuts, page tree: Add subpage, drag to move, Delete (K06 confirm) from tree and from editor; Import document: ${QA}/fixtures/sample.md, sample.txt, sample.pdf; PDF viewer zoom in/out, scrolling; empty states; long titles; visual consistency with Library/Home (search field height K37, raw colours K45) both themes. Tasks (K42): navigate via eval "() => { import('/src/stores/navigation-store.ts').then(m => m.useNavigationStore.getState().navigateToModule('tasks')); return 'ok' }" and review list/empty/loading states and styling.` },
  { id: 'q1', stack: 'A', title: 'App shell + Home', text: `Stack A. Read-only on existing designs; create/rename/delete only designs you create (QA-q1-*).
Checklist: boot, rail items + active state + tooltips; right-click on empty area and inside the Home search input (K33); theme switching via Settings -> General (Light/Dark/System) and persistence; Home: List/Grid toggle + persistence across reload; filters All/Recent/Starred/Archived with accurate counts; star/unstar + persistence; archive/unarchive via grid card "More actions" + Archived filter; search via "/" and Cmd+K, filtering, no-results state; sort Modified/Created/Name and whether the list header indicator follows (K25); row click -> detail panel; dblclick opens; Enter opens selected; N creates a design (rename it QA-q1-..., then delete it); Import KiCad… opens wizard (open/close only); delete flow on your QA design via More actions -> Delete (K26: role, Esc, focus trap, labelled close, N/Enter behind modal); grid card menu stubs (K43); detail panel actions menu; status bar; sync footer text with cloud off; keyboard-only list operation (K35: Tab to rows?); load error: route "**/api/modules/designer/designs" 500 then reload (K32), then route it to return {"ok":true,"data":{"designs":[]}} for empty state; create a design with a very long name (120 chars) to check truncation everywhere (list, grid, detail, designer tab), then delete it; 1100x720 layout; census both themes.` },
  { id: 'q2', stack: 'B', title: 'Settings', text: `Stack B (no real keys; you may add a provider with dummy key "sk-qa-dummy-000"). Do NOT install .opclib packages (q6 owns library content) — only test the install-from-URL error path with a bogus URL and open/cancel the file chooser.
Checklist: reach Settings via rail gear, Cmd/Ctrl+, and right-click menu; Back and Esc return to the previous screen (from Home and from Designer); settings search + "No matches"; header height/style vs other screens (K39); General: theme Light/Dark/System, desktop-only notes; Libraries: core library card (Check / Update), sources table, Remove -> confirm (K06; dismiss it), Install from URL error UX; Account (cloud off): what is shown, is it coherent; Assistant: default provider select, prompt preset, context size, tool policy, raw tool data, MCP section (K20; toggles; snippets desktop-only text), providers list: add provider (dummy key), Re-test -> error surfacing, Models refresh error, edit/save, key show/replace/remove, delete provider; key storage wording (K11); Privacy; About (links, modules list, release notes). Visual: control heights, switches/checkboxes/selects consistency (hand-rolled vs kit), raw red/amber/emerald banners (K45), spacing, both themes, 1100x720.` },
  { id: 'q6', stack: 'B', title: 'Library browse, detail, import', text: `Stack B (library mutations allowed).
Checklist: Library table/grid toggle + persistence; counts header vs actual rows (K07: only 60 shown?); facets (every bucket, filter box inside facet, checkbox labels), active filter chips, Clear all; search incl "/" hint (K24), no-results state; table keyboard nav (arrows/Enter), row select -> preview pane (symbol/footprint previews, Part/Footprints/Pins/Specs), Open, Component actions menu; dblclick -> detail page: built-in part "Duplicate to edit"; custom part Edit/Save/Cancel, name/description/tags (TagTokenInput add/remove), footprint options, fullscreen symbol/footprint previews (Esc), 3D card: STEP upload ${QA}/fixtures/minimal.step then ${QA}/fixtures/garbage.step (error UX), "Place in design" (K43); Import library… with ${QA}/fixtures/LM324N.zip, OP07CD.zip, kicad-with-step.zip, and invalid ${QA}/fixtures/sample.txt (warnings display — only first shown? error UX K08); single delete + bulk delete of custom parts (K06 confirm); delete error: route "**/api/modules/library/components/*" DELETE to 500 (K08 — does the list vanish?); 3D model conversion errors (K41); grid cards visuals; preview "Loading preview…" states; empty states; both themes; 1100x720 (does preview pane squeeze table?).` },
  { id: 'q8', stack: 'A', title: 'Assistant space + dock (real LLM)', text: `Stack A. Designs you own: a557d3b5 'S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)', 3d5d1f7c 'S3 Smoke — 5 LED indicators (v2)', plus QA-q8-* chats/designs. Real OpenRouter free model is configured (nvidia/nemotron-3.5-lightning:free). BUDGET: run python3 ${QA}/scripts/llm-budget.py before and after; max 25 LLM turns total; stop LLM use if usage >= 1.5. NEVER open the provider editor / Configure providers on stack A, never dump provider request bodies. For @page tests read ${QA}/inventory/handoff.json (written by q9); if missing, create your own page QA-q8-page in Docs.
Checklist: Assistant space: New chat, chat list filters All/Pinned (K23)/Linked/Archived, search chats, row actions Rename (K05 native prompt?) / Delete (K06), multi-select delete, header title rename, linked design chip, tools badge, model pill popover (read-only look), Chat actions (Rename/Export markdown/Archive/Delete); composer Enter/Shift+Enter, @ mentions (component, design, page — clicking the page mention in a message, K22), quick actions; prompts: (1) link to a557d3b5 and ask "List the components in this design" (read tools, tool cards), (2) "Add a 10k resistor R99 to the schematic" -> proposal approve / reject flow, check the design changed, (3) "Show the power path as a mermaid diagram and a markdown table" (render, View source, Download SVG, Fullscreen), (4) Stop generating mid-stream, (5) network-state-set offline mid-run then online -> error UI + recovery, (6) route "**/api/modules/assistant/**/runs*" to 500 for error UI (unroute after); message rendering quality, streaming, scroll behaviour, empty states; dock in Designer (Cmd+I) on 3d5d1f7c: composer, thread menu New/select/Rename (K04)/Delete (K06), model pill, Open in Assistant view, Close chat, dock on PCB view: type in composer and check whether PCB hotkeys fire (K12). Visual: raw colours/rounded/shadows (K45) vs redesigned screens, both themes, 1100x720.` },
  { id: 'q10', stack: 'C1', title: 'Cloud flag-off / offline states', text: `Stack A = cloud feature flag forced OFF (release-like when cloud disabled). Stack C1 = cloud flags ON but all cloud URLs dead (offline).
Checklist on A (read-only): confirm no cloud UI leaks (Settings Account tab? Home sync footer? Designer "Open from Cloud", sync badge, presence; Library cloud sync button; PCB Auto Layout / Route Board / Auto Place buttons; Assistant cloud copilot mode) and zero cloud console noise per page. On C1 (own DB copy, mutate freely): Settings -> Account sign-in attempt with dead auth URL (error message? hang?), Home "Sign in to sync" footer, designer Local chip / sync badge states, Open from Cloud dialog, PCB Auto Layout / Route Board / Auto Place gates and messages (open dialogs, press Run if possible), Library cloud sync button, comments with cloud.comments flag, assistant cloud provider/copilot entries; count console errors per page load (network ERR_CONNECTION_REFUSED spam?); nothing should spin forever; copy should explain offline state. Both themes.` },
  { id: 'q11', stack: 'A', title: 'Cross-cutting consistency, a11y, keyboard', text: `Stack A, STRICTLY read-only (open the wizard/dialogs only to look, then cancel). Designs: b5a31f3e 'GUIDE-VALIDATE', f22dfde2 'Untitled Design' (zone).
For each top-level screen — Home list, Home grid, Designer empty state, Schematic, PCB, 3D, BOM, DRC full view, Library table, Library grid, Library detail page, Library New part wizard (step 1 only, then close), Docs, Assistant, Settings (each tab) — at 1100x720, 1440x900 and 1920x1080 in dark and light: run the DOM census (save JSON), take a screenshot, run palette-audit (mask the canvas). Keyboard: from page start press Tab ~40 times per main screen and record where focus goes and whether it is VISIBLE (K34); check focus trap + focus return in the Cmd+K palette, PCB Design rules dialog, PCB Export dialog, power port picker, Home delete modal (open only, cancel); Home/BOM rows keyboard reachability (K35). Consistency matrix (measure with snapshot --boxes): header bar heights (target 34px), section header heights (24px), list/table row heights (22px, Home 64px), control heights (22px/20px), button variants and sizes, search fields, segmented controls, empty-state styles, error/warning banner styles, menus/popovers styles, icon sizes/stroke, typography scale (<10px text K36), border radius (2px flat), shadows/blur/gradients leftovers (K45). Report each inconsistency as a finding with measured numbers and the screens involved.` },
]

function qaPrompt(c) {
  return `You are QA agent ${c.id} — ${c.title}. Stack ${c.stack}. Your findings file: ${QA}/findings/raw/${c.id}.jsonl ; coverage: ${QA}/findings/coverage/${c.id}.json ; screenshots under ${QA}/shots/${c.id}/<theme>/ ; playwright sessions ${c.id}-dark / ${c.id}-light.
${COMMON}

CHARTER:
${c.text}

Be exhaustive within your charter; also report anything else broken or unprofessional you notice on the way. Every finding needs repro steps and evidence.`
}

function verifyPrompt(c, qa) {
  return `You are an ADVERSARIAL VERIFIER for QA agent ${c.id} (${c.title}, stack ${c.stack}). Read ${QA}/QA_PROTOCOL.md, ${QA}/known-findings.md and the repo PLAN.md §2 (redesign decisions D1–D15, what was intentionally omitted). Then read every finding in ${QA}/findings/raw/${c.id}.jsonl (and the coverage file ${QA}/findings/coverage/${c.id}.json).
QA agent summary: ${JSON.stringify(qa || {}).slice(0, 1500)}

For EACH finding:
1. Reproduce it yourself in fresh playwright-cli sessions v${c.id}-dark / v${c.id}-light on the same stack (cwd ${QA}), same designs (respect ownership in assignments.json; you inherit ${c.id}'s ownership). For visual/colour claims re-take the screenshot and re-run probe.py / palette-audit.py. S4 cosmetic items may be verified by screenshot + code reading without full repro.
2. Try hard to REFUTE it: is the behaviour intentional per PLAN.md decisions? an environment artefact (offline cloud, dev-only flag, headless GL, browser-vs-Electron, CoreLibrary cap, our isolated stack/ports)? a duplicate of another finding in this file (same root cause)? a misread of the UI?
3. Read the cited code (and find the right file:line if missing) to confirm root cause and make suggestedFix concrete.
4. Recalibrate severity using the protocol rubric.
Write ${QA}/findings/verified/${c.id}.json — a JSON array of ALL findings from the raw file (merged duplicates collapsed into one with "mergedIds"), each with updated fields plus "status": "confirmed"|"rejected"|"duplicate"|"needs-info" and "verification": {"verdict":"...","by":"v${c.id}","reason":"...","evidence":["shots/...png", "..."]}. Rejections MUST have a reason. Do not edit the repo. Close your sessions. Return the JSON summary.`
}

phase('Discover')
log(`Launching ${CHARTERS.length} QA charters (browser concurrency 7), each followed by an adversarial verifier`)
const round1 = await pipeline(
  CHARTERS,
  (c) => browser(() => agent(qaPrompt(c), { label: `qa:${c.id}`, phase: 'Discover', schema: QA_SCHEMA })),
  (qa, c) => browser(() => agent(verifyPrompt(c, qa), { label: `verify:${c.id}`, phase: 'Discover', schema: VERIFY_SCHEMA })).then(v => ({ charter: c.id, qa, verify: v })),
)
const done1 = round1.filter(Boolean)
log(`Round 1: ${done1.length}/${CHARTERS.length} charters verified. Confirmed: ${done1.reduce((s, r) => s + (r.verify?.confirmed || 0), 0)}`)

phase('Critic')
let allResults = [...done1]
let followRound = 0
while (followRound < 2) {
  const critic = await agent(`You are the COMPLETENESS CRITIC for a manual UI QA pass of OpenPCB. Read ${QA}/QA_PROTOCOL.md, ${QA}/surface-inventory.md, ${QA}/known-findings.md, every coverage file in ${QA}/findings/coverage/ and every verified findings file in ${QA}/findings/verified/.
Build a coverage matrix per area x {empty, loading, error, many-items, long-text, narrow-window 1100x720} x {mouse, keyboard, typing-in-fields} x {dark, light} and list real GAPS: surfaces/states/interactions from surface-inventory.md that no agent tested or that were marked blocked/untested, known findings (K01–K45, N1, N2) still unconfirmed and unrefuted, and areas with suspiciously few findings. This is follow-up round ${followRound + 1} of max 2 (${followRound === 0 ? 'first' : 'second — only real gaps that matter for release quality'}).
Emit at most 4 targeted follow-up charters (id f${followRound + 1}a..f${followRound + 1}d; stack A for read-mostly/designer work — new designs named QA-<id>-*, stack B for library/settings mutation, C1 for cloud) each with a concrete checklist. Set stop=true (and charters=[]) if remaining gaps are minor. Do not edit any files. Return JSON.`, { label: `critic:${followRound + 1}`, phase: 'Critic', schema: CRITIC_SCHEMA })
  if (!critic || critic.stop || !critic.charters?.length) { log(`Critic round ${followRound + 1}: stop (${critic?.gaps?.length || 0} minor gaps)`); break }
  log(`Critic round ${followRound + 1}: ${critic.charters.length} follow-up charters: ${critic.charters.map(c => c.id + ' ' + c.area).join('; ')}`)
  const follow = critic.charters.slice(0, 4).map(c => ({ id: c.id, stack: c.stack, title: c.area + ' (follow-up)', text: `${c.focus}\nDesigns: ${c.designs || 'create your own QA-' + c.id + '-* designs; do not mutate others'}\nChecklist:\n- ${c.checklist.join('\n- ')}` }))
  const res = await pipeline(
    follow,
    (c) => browser(() => agent(qaPrompt(c), { label: `qa:${c.id}`, phase: 'Critic', schema: QA_SCHEMA })),
    (qa, c) => browser(() => agent(verifyPrompt(c, qa), { label: `verify:${c.id}`, phase: 'Critic', schema: VERIFY_SCHEMA })).then(v => ({ charter: c.id, qa, verify: v })),
  )
  const got = res.filter(Boolean)
  allResults.push(...got)
  const newS12 = got.reduce((s, r) => s + ((r.verify?.confirmedBySeverity?.S1 || 0) + (r.verify?.confirmedBySeverity?.S2 || 0)), 0)
  const newS34 = got.reduce((s, r) => s + ((r.verify?.confirmedBySeverity?.S3 || 0) + (r.verify?.confirmedBySeverity?.S4 || 0)), 0)
  log(`Follow-up round ${followRound + 1}: new confirmed S1/S2=${newS12}, S3/S4=${newS34}`)
  followRound++
  if (newS12 === 0 && newS34 <= 3) break
}

phase('Triage')
const triage = await agent(`You are the TRIAGE LEAD. Read ${QA}/QA_PROTOCOL.md, ${QA}/known-findings.md and ALL files in ${QA}/findings/verified/ (confirmed + rejected findings from ${allResults.length} QA charters). Also skim the repo PLAN.md §2 and the user decisions below.
USER DECISIONS (binding): fix UI/UX + frontend bugs; backend only where it breaks a UI flow (approved backend work: schematic grid 1.27 mm in autoplace/assistant/routing defaults; Library list paging offset+total). DRC/geometry engine correctness (src/shared/drc, docs/pcb-hardening) is OUT of scope. Cloud features out of scope except graceful offline/flag-off states. Polish + targeted structural fixes allowed; LARGE layout changes are proposals only. Issues inside node_modules/@openpcb/* packages -> follow-up list only (no edits). Themes dark+light parity. Full consistency depth: kit primitives (Input, NumberInput, Select, Switch, RadioGroup, Dialog, confirmDialog/promptDialog, Toast, ErrorBoundary, Banner, EmptyState, Spinner, Kbd) + migrate all in-scope surfaces to tokens/primitives. Grid snap: real toggle default ON (schematic 1.27 mm; PCB 0.25 mm default + presets; Shift+S toggle, N/Shift+N PCB presets; status-bar grid dropdown). Stubs: wire Home Rename + Library "Place in design", build Tasks in rail + PCB C comment hotkey; remove other "Coming soon" stubs; Bundle tool: remove dead leftovers, keep flag.
FIX OWNERS (strict file ownership for parallel implementers): F0a kit+tokens (src/shared/frontend/ui/**, index.css, new shared http/problem.ts + keyboard/shortcut-guard.ts); F0b app wiring (App.tsx, main.tsx, AppShell.tsx, AppContextMenu.tsx, ModuleSpaceHost.tsx, sentry.ts, designer hooks/use-toast.tsx); G grid snap (designer grid files + backend grid constants); C1 Home/Shell (HomeScreen, screens/home/*, LeftSidebar, TitleBar, ThemeToggle, ModuleScreen); C2 Settings (SettingsScreen, settings/**, AcceptInvitePage); D1 designer shell (designer Space.tsx, header/tabs/sidebar/status/empty/dock/cloud components, designer hooks/stores/lib/api.ts); D2 schematic (SchematicCanvas, toolbar, OutlinePanel, SelectionInspector, LabelPicker, palette, ERC view, comments/*); D3 PCB (pcb/**, PcbDesignRulesDialog, DesignerDrcView); D4 3D/BOM/import (three-d/**, DesignerBomView, KicadProjectImportWizard, CloudDesignBrowser); L1 Library browse (library Space, LibraryCard, ComponentDetailPage, PreviewModal, components/**, hooks/**, three-d/**, backend list paging); K1 Docs+Tasks (knowledge/frontend/**, tasks/frontend/** + manifest); L2 wizard shell; L3 symbol editor; L4a FootprintStep+preset picker; L4b footprint editor; A1 assistant Space.tsx; A2 dock+composer+pills; A3 assistant cards + shared/frontend/markdown/** + shared/frontend/assistant/**; W4 sweep/e2e.
TASK: dedupe across agents (same root cause -> one entry with all ids), then write:
1) ${QA}/triage/triage.json: array of entries {tid:"T-###", ids:[...], knownRef, area, title, severity, category, themes, summary, evidence:[paths], rootCause:{path,line,note}, proposedFix, scope:"frontend|backend|shared-package|decision|proposal", estimate, owner, wave:"F0a|F0b|G|W2|W3|W4|followup|proposal", recommendation:"fix-now|defer|wont-fix|decide", approved:null}. Also include every known finding K01–K45/N1/N2 with its status (confirmed/refuted/partial/untested).
2) ${QA}/triage/TRIAGE.md for the product owner: (a) summary counts by severity x area, confirmed vs rejected, list of all S1; (b) known-findings status table; (c) per-area tables "TID | Sev | Title | Evidence (1 screenshot path) | Proposed fix | Scope | Est | Owner | Wave | Rec"; (d) DECISIONS NEEDED (backend-touching items beyond the approved ones, structural proposals, ambiguous product behaviour) — each as a crisp question with a recommended default; (e) structural/layout PROPOSALS (not to be built without approval) with screenshot paths; (f) rejected findings + reasons; (g) shared-package follow-ups (@openpcb/*). Keep it scannable (tables, one line per item).
Do not edit the repo. Return the JSON summary.`, { label: 'triage', phase: 'Triage', schema: TRIAGE_SCHEMA })

return { charters: allResults.map(r => ({ charter: r.charter, counts: r.qa?.counts, confirmed: r.verify?.confirmed, rejected: r.verify?.rejected, top: r.qa?.topIssues })), triage }
