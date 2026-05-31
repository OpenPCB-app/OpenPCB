export const meta = {
  name: 'drc-phase1-research',
  description: 'Phase-1 DRC research+exploration: KiCad/Flux/standards/algorithms + OpenPCB codebase, synthesize check catalog',
  phases: [
    { title: 'Research' },
    { title: 'Synthesize' },
  ],
}

const WEB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topic: { type: 'string' },
    keyFindings: { type: 'array', items: { type: 'string' } },
    concreteValuesAndFormulas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { name: { type: 'string' }, value: { type: 'string' }, source: { type: 'string' } },
        required: ['name', 'value'],
      },
    },
    architectureOrDataStructures: { type: 'array', items: { type: 'string' } },
    checksIdentified: { type: 'array', items: { type: 'string' } },
    recommendationsForOurImpl: { type: 'array', items: { type: 'string' } },
    citations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, note: { type: 'string' } }, required: ['url'] },
    },
  },
  required: ['topic', 'keyFindings', 'recommendationsForOurImpl'],
}

const CODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    relevantFiles: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, purpose: { type: 'string' } }, required: ['path', 'purpose'] },
    },
    dataModel: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { entity: { type: 'string' }, fields: { type: 'string' }, units: { type: 'string' } }, required: ['entity'] },
    },
    reusableUtilities: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, path: { type: 'string' }, signature: { type: 'string' }, computes: { type: 'string' } }, required: ['name', 'path', 'computes'] },
    },
    patternsToMirror: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'relevantFiles', 'patternsToMirror'],
}

const CATALOG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          compares: { type: 'string' },
          formulaOrThreshold: { type: 'string' },
          defaultSeverity: { type: 'string' },
          inputsNeeded: { type: 'string' },
          standardsBasis: { type: 'string' },
          phase: { type: 'string' },
        },
        required: ['id', 'name', 'category', 'compares', 'formulaOrThreshold', 'phase'],
      },
    },
    severityModel: { type: 'string' },
    exclusionModel: { type: 'string' },
    recommendedPhasing: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['checks', 'recommendedPhasing'],
}

const REPO = '/Users/andrejvysny/workspace/openpcb/OpenPCB'

phase('Research')

const webThunks = [
  () => agent(`You are a PCB EDA expert. Research KiCad's DRC (Design Rule Check) ENGINE ARCHITECTURE and RULE SYSTEM in depth. Use WebSearch + WebFetch. Authoritative sources: KiCad source on gitlab.com/kicad/code/kicad (pcbnew/drc/ — drc_engine.cpp/.h, drc_rule.h, drc_rule_condition, drc_test_provider*.cpp, drc_item.h), and docs.kicad.org "Custom Design Rules" (.kicad_dru) reference.
Cover: (1) the list of DRC_TEST_PROVIDERs (clearance, hole clearance, hole-to-hole, edge clearance, courtyard, silk clearance, track width, via diameter, annular width, disallow, connectivity/unconnected, copper-graph shorts, zone-fill, text dims, library parity, diff-pair, length, etc.); (2) the constraint model (constraint types, min/opt/max, severity per rule); (3) the rule-matching/condition expression system (selectors, conditions, layer/net-class scoping, rule priority/override order); (4) how the engine evaluates "actual vs constraint" and emits DRC_ITEM markers (with two endpoints/items); (5) spatial acceleration (R-tree / rtree, why), incremental vs full DRC, on-demand vs batch; (6) the exclusion/waiver model and severities (error/warning/ignore/exclusion). Be concrete and technical.`, { label: 'web:kicad-engine', phase: 'Research', agentType: 'Explore', schema: WEB_SCHEMA }),

  () => agent(`You are a PCB fabrication/standards expert. Research the CONCRETE NUMERIC VALUES and FORMULAS behind PCB design rules, with sources. Use WebSearch + WebFetch.
Cover with actual numbers: (1) IPC-2221B conductor spacing vs voltage (internal/external, coated/uncoated) — the clearance table; (2) IPC-2152 trace width vs current vs temp-rise (external/internal copper, 1oz/2oz) — the width formula and typical lookup; (3) minimum annular ring (IPC-A-600 / class 2/3) and pad-drill relationship; (4) drill-to-copper, hole-to-hole spacing; (5) board edge clearance (copper-to-edge), and clearance to board cutouts; (6) solder mask: min web/sliver, mask expansion/dam between pads; (7) silkscreen: silk-to-pad, silk-to-edge, min text height/stroke; (8) IPC-7351B courtyard excess and courtyard-to-courtyard; (9) min trace width / min spacing typical for 2-layer FR4. THEN fetch JLCPCB "PCB Capabilities" and PCBWay capability pages and extract their concrete DRC limits (min track/space, min via/drill, min annular ring, min hole, board-edge clearance, silk width, mask dam). Present every value with units and source.`, { label: 'web:standards-values', phase: 'Research', agentType: 'Explore', schema: WEB_SCHEMA }),

  () => agent(`You are an EDA UX + algorithms researcher. Research how WEB-BASED and REAL-TIME EDA tools implement DRC, focusing on Flux.ai, plus EasyEDA, Altium (real-time DRC), Cadence Allegro, Autodesk Fusion Electronics/Eagle. Use WebSearch + WebFetch.
Cover: (1) Flux.ai — what DRC/rule checks it runs, whether real-time/continuous, how violations are surfaced (markers, panel, inline), rule configuration UX, any published docs/blog; (2) real-time vs batch DRC tradeoffs and how each tool presents them (live during routing vs on-demand full check); (3) violation UX patterns: marker rendering on canvas, a dockable violations/issues list, click-to-navigate/zoom-to-violation, severity grouping, "exclude/waive" actions, re-run/clear; (4) how design-rule profiles/manufacturer presets are exposed to users; (5) any notable performance approaches for browser/JS DRC. Give concrete UX and architectural takeaways for a React/R3F desktop EDA app.`, { label: 'web:flux-realtime-ux', phase: 'Research', agentType: 'Explore', schema: WEB_SCHEMA }),

  () => agent(`You are a computational-geometry + EDA algorithms expert. Research the ALGORITHMS and DATA STRUCTURES for implementing PCB DRC correctly and efficiently in TypeScript/JS. Use WebSearch + WebFetch.
Cover: (1) clearance computation between primitives — segment-to-segment min distance (thick traces = capsules/rounded rectangles), point/segment to polygon, circle (via/hole) to segment, polygon-to-polygon clearance, and using outset/Minkowski to convert "edge clearance >= c" into intersection tests; (2) spatial indexing for broad-phase (R-tree e.g. rbush, grid/quadtree, AABB bbox prefilter) to avoid O(n^2); (3) connectivity & UNROUTED-net detection (ratsnest as MST over same-net pads/traces/vias; what counts as connected — overlap graph / union-find), and SHORT detection (different nets whose copper touches); (4) annular ring = (pad_diameter - drill)/2 check; via/pad geometry; (5) incremental DRC (recheck only changed region's neighbors) vs full-board; (6) how to model thick polylines and pads as clearance geometry; (7) numeric robustness with integer nanometer coordinates. Recommend specific npm libraries (rbush, polygon-clipping/martinez, clipper, flatten-js) with tradeoffs, and concrete TS approaches. Cite sources.`, { label: 'web:algorithms', phase: 'Research', agentType: 'Explore', schema: WEB_SCHEMA }),
]

const codeThunks = [
  () => agent(`Explore the OpenPCB PCB DATA MODEL. Repo root ${REPO}. Read: src/modules/designer/backend/pcb/pcb-store.ts, pcb-projection.ts, pcb-defaults.ts; the designer SDK types in src/sdks/designer/ (types.ts, pcb-helpers.ts, index.ts) — especially PcbTrace, PcbVia, PcbPad/footprint pads, PcbPlacedPart, PcbZone/copper pour, PcbBoard/outline, PcbNetClass, PcbDesignRules, PcbCopperLayerId; the ECS world usage in src/shared/domain/ as it pertains to PCB entities; backend/migrations/*.sql for PCB tables. 
Report: every PCB entity relevant to DRC with its geometry fields and UNITS (nanometers in store vs mm in SDK projection — be precise about where each conversion happens), how pads resolve geometry (footprint.preview.pads — shapes beyond rect? holes? layers?), how nets/net-ids attach to traces/vias/pads (net-pad-correlation), how vias store drill/diameter/layers, how zones/copper pours are represented, and the exact shape of PcbDesignRules and PcbNetClass. This grounds what inputs a DRC engine can read.`, { label: 'code:data-model', phase: 'Research', agentType: 'Explore', schema: CODE_SCHEMA }),

  () => agent(`Explore OpenPCB's EXISTING DESIGN-RULE CONFIG + LIVE DRC. Repo root ${REPO}. Read fully: src/modules/designer/frontend/pcb/drc/live-drc.ts, src/modules/designer/frontend/pcb/tools/route-tool-state.ts (how/where runLiveDrc is called, what it does with violations), src/modules/designer/backend/pcb/fab-presets.ts, pcb-defaults.ts, via-presets.ts, net-class-resolver.ts. Also grep for usages of PcbDesignRules, clearanceMm, traceToTraceMm, traceToPadMm, netClass across src/modules/designer and src/sdks.
Report: the exact current DRC clearance model + its v1 LIMITATIONS (what it checks/skips: layers, vias, board edge, annular, width, shorts, unconnected), what manufacturer/fab presets exist and their values, how net classes resolve clearance/width, where design rules are stored/defaulted/edited (any UI?), and how live DRC violations are currently surfaced during routing. List every gap vs a full DRC.`, { label: 'code:existing-rules', phase: 'Research', agentType: 'Explore', schema: CODE_SCHEMA }),

  () => agent(`Explore OpenPCB REUSABLE GEOMETRY for DRC. Repo root ${REPO}. Read: src/modules/designer/backend/pcb/pcb-trace-geometry.ts, pad-geometry.ts, outline-geometry.ts, net-pad-correlation.ts, ratsnest.ts; src/modules/designer/frontend/pcb/pcb-hit.ts, snap.ts, measure-snap.ts, pcb-rect-hit.ts; src/modules/designer/frontend/pcb/layers/copper-fill-geometry.ts and copper-fill-trace-geometry.ts; and any geometry in src/shared/rendering/ (geometry.ts, bounds). Also check for any existing R-tree/quadtree/spatial-index, polygon, or clipper dependency in package.json files.
Report every reusable primitive (segment-segment distance, point-segment, AABB, polygon area/contains, pad outline generation, trace bounds, ratsnest MST, net correlation) with path + signature + what it computes, and note which are duplicated (e.g. segToSegDistance already in live-drc.ts). Identify what geometry is MISSING for full DRC (capsule clearance, circle-segment, polygon clearance, board-edge distance, spatial index) and whether any npm geom lib is already installed.`, { label: 'code:geometry', phase: 'Research', agentType: 'Explore', schema: CODE_SCHEMA }),

  () => agent(`Explore OpenPCB's BACKEND ANALYSIS/PROJECTION/COMMAND pattern to learn how to wire a DRC engine end-to-end, mirroring ERC. Repo root ${REPO}. Read: src/modules/designer/backend/erc/erc-engine.ts (already understood — the report shape), and find HOW erc is invoked and surfaced: grep runErc, ErcReport, ErcViolation across backend + frontend; read src/modules/designer/backend/command-executor.ts, the designer routes file (grep for routes.ts / route registration in src/modules/designer/backend), src/modules/designer/backend/pcb/pcb-projection.ts and any projection-read; the SDK designer index/types for ErcReport/ErcViolation/anchors. Note the 'HTTP parser gotcha' (new command/request fields must be added to the routes parser or dropped over HTTP).
Report: the full path from a frontend 'run ERC' action → HTTP route → backend engine → response → frontend store/UI; whether ERC is a command (mutation) or a read-only query/projection; where a PCB DRC equivalent should live (backend/drc/?), what route shape to add, and the exact SDK types/report shape to define for DRC (DrcReport/DrcViolation/anchors/severity/summary). Flag the routes-parser gotcha location.`, { label: 'code:erc-wiring', phase: 'Research', agentType: 'Explore', schema: CODE_SCHEMA }),

  () => agent(`Explore OpenPCB FRONTEND SURFACING for PCB DRC results. Repo root ${REPO}. Read: src/modules/designer/frontend/pcb/PcbCanvas.tsx, PcbScene.tsx, layers/OverlayLayer.tsx, pcb-visual-state.ts, pcb-view-store.ts; src/modules/designer/frontend/components/DesignerStatusBar.tsx; src/modules/designer/frontend/Space.tsx; stores in src/modules/designer/frontend/stores/. Also how schematic ERC results are shown (grep ERC in frontend), and the panel/dock layout patterns (component inspector dock, OutlinePanel).
Report: how overlay markers are rendered on the R3F canvas (render order constants, demand rendering/invalidate), where a violations marker layer would hook in, how to render zoom-to/click-to-navigate to a violation anchor (trace/pad/via/segment), where a dockable DRC/violations PANEL should live (existing dock/panel components to reuse), how the status bar reports counts, and the Zustand store pattern for holding the DRC report + selected/excluded violations. Respect the r3f-eda-rendering rules (no Canvas2D, no frameloop=always, invalidate()).`, { label: 'code:surfacing', phase: 'Research', agentType: 'Explore', schema: CODE_SCHEMA }),

  () => agent(`Extract concrete EDA DRC reference VALUES + documented ALGORITHMS from the repo-local Claude skills. Read these files in full: /Users/andrejvysny/workspace/openpcb/.claude/skills/eda-standards/SKILL.md, eda-standards/references/design-rules.md, eda-standards/references/trace-width.md, /Users/andrejvysny/workspace/openpcb/.claude/skills/pcb-layout/SKILL.md, pcb-layout/references/routing.md, pcb-layout/references/data-model.md.
Report: all concrete DRC values the project already standardizes on (IPC-2221B clearance table, trace-width formula/lookup, manufacturer presets JLCPCB/PCBWay with exact numbers, via specs, annular ring, copper-to-edge, grid, 2-layer FR4 stackup, DRC rule values), any documented routing/hit-test/ratsnest/net-extraction algorithms, layer naming (F.Cu/B.Cu/Edge.Cuts), and any guidance on how DRC should behave in this project. Quote exact numbers and put each value in concreteValuesAndFormulas-equivalent notes. This is the project's source of truth — prefer these values over generic web values where they conflict.`, { label: 'code:skills-values', phase: 'Research', agentType: 'Explore', schema: CODE_SCHEMA }),
]

const research = await parallel([...webThunks, ...codeThunks])
const web = research.slice(0, webThunks.length).filter(Boolean)
const code = research.slice(webThunks.length).filter(Boolean)

phase('Synthesize')

const catalog = await agent(
  `You are the lead engineer designing DRC for OpenPCB (a TS/Bun + React/R3F desktop PCB editor). Synthesize the research below into a COMPREHENSIVE, CORRECT DRC CHECK CATALOG that is grounded in what OpenPCB's data model can actually provide.

For EACH check give: id, name, category (clearance | constraint | connectivity | manufacturability | silk-mask | board), what it compares, the exact formula/threshold (use edge-to-edge clearance math accounting for trace half-widths, pad/via geometry, drill, annular = (dia-drill)/2, etc.), default severity, the inputs it needs from the data model, the standards basis (cite IPC where relevant, prefer the project's own skill values where they conflict with generic web), and an implementation phase (P1 MVP | P2 | P3). Order checks by phase then category. Also define a severity model (error/warning/ignore + per-rule override + exclusions/waivers) and an exclusion model. Give recommendedPhasing (what ships in P1 vs later) and openQuestions for the human.

Bias P1 toward checks the existing data model + geometry already supports (copper clearance trace/pad/via same-layer, track width min, via/drill/annular, board-edge clearance, hole-to-hole, unconnected nets via ratsnest, copper shorts) and defer ones needing courtyard/silk/mask/zone-fill data if that data is thin. Be exhaustive but mark feasibility honestly.

=== WEB RESEARCH (KiCad engine, standards values, Flux/realtime UX, algorithms) ===
${JSON.stringify(web, null, 1)}

=== CODEBASE FINDINGS (data model, existing rules, geometry, ERC wiring, surfacing, skill values) ===
${JSON.stringify(code, null, 1)}`,
  { label: 'synthesize:catalog', phase: 'Synthesize', agentType: 'Explore', schema: CATALOG_SCHEMA },
)

return { web, code, catalog }
