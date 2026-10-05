# Fix brief — owner D3a

58 approved triage entries. Entries marked **shared** are co-owned: implement ONLY the part that lives in your owned files; the lead owner is listed. Screenshot paths are absolute (open with the Read tool for layout only).

## T-133 [S1] PCB hotkeys fire while typing (dock composer, comments, selects) and behind Export dialog — text mangled, parts deleted

- Area designer.pcb · category keyboard · estimate S · findings Q4-019, Q5-024, Q8-023, Q4-040 · known K12
- Summary: Text is silently corrupted (letters r,o,t,h,z,k,p,m,u,f,v,w,b… are preventDefault-ed and executed as tool hotkeys). Backspace in the composer did NOT delete a character but deleted the selected trace (projection traces 22 → 21, rev 505→506, selection cleared) — invisible data loss while the user is typing a chat message. F would flip a selected part, R rotate it, Delete delete it. Same in the Properties dock: Backsp… | Also covers: Q5-024: PCB hotkeys fire while typing in the comment composer — letters vanish, tools toggle, and…; Q8-023: Typing in the Assistant dock on the PCB view fires PCB hotkeys: letters are swallowed, to…; Q4-040: PCB hotkeys stay live behind the Export dialog: Delete removes the selected item, R/B swi…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — if (event.target instanceof HTMLInputElement) return; — textarea/select/contenteditable not excluded
- Proposed fix: PCB keymap uses shared shortcut guard: ignore editable targets (textarea/select/contenteditable) and open modals — no tool switches/deletes while typing. — Detail: Replace the guard with a shared isEditableTarget(e.target) (input, textarea, select, [contenteditable], role=textbox, and anything inside a dialog/dock that isn't the canvas) and apply it to every window keydown listener in the designer (PcbCanvas onKey + onShiftKey, SchematicCanvas, Space Cmd+K/W). Better: attach the keymap to the canvas container with focus-within semantics.
- Depends on: ['T-002']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/094-comment-typing.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/005-backspace-composer-deletes-trace.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q5/dark/077-pcb-comment-thread.png
- Q4-019 repro: Open 'Dual LED Blinker' → PCB view → right dock 'Assistant' tab → Click the 'Ask about this design…' composer and type 'rotate test' → composer shows 'ae es' (r/o/t swallowed; each toggles Route/Board/Text tools behind the scenes) → Click a trace on the board (status 'Trace · GND'), click back into the composer, press Backspace to fix a typo → Same with the PCB comment composer (Add → Comment, click board, type 'rotate test' → 'ae es') → Also in the Properties inspector: select a free pad → focus its 'Shape' <select> and press R → Route tool activates (Route (R) aria-pressed=true); focus its 'Layer' <select> and press Backspace → the pad is deleted (rev 27→28)
  - expected: Keys typed into any text field (textarea, contenteditable, select) never reach the PCB keymap
  - actual: Text is silently corrupted (letters r,o,t,h,z,k,p,m,u,f,v,w,b… are preventDefault-ed and executed as tool hotkeys). Backspace in the composer did NOT delete a character but deleted the selected trace (projection traces 22 → 21, rev 505→506, selection cleared) — invisible data loss while the user is typing a chat message. F would flip a selected part, R rotate it, Delete delete it. Same in the Properties dock: Backspace in the pad 'Layer' <select> deletes the pad; R in the 'Shape' <select> enters Route mode.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` if (event.target instanceof HTMLInputElement) return; — textarea/select/contenteditable not excluded
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5012` Delete/Backspace deletes selection
- Q5-024 repro: Open 'LED Indicators 5V' → PCB, select R8 in the Components list → Add ▾ → Comment, click an empty board spot, click INTO the composer textarea (activeElement=TEXTAREA) → Type 'x' then press Backspace → Separately: type 'QA-q5 PCB comment: parts overlap at centre' and press ⌘Enter
  - expected: Keystrokes inside a textarea only edit the text; canvas shortcuts are suppressed.
  - actual: PcbCanvas' window keydown handler only ignores <input> targets, so inside the <textarea> it preventDefaults and executes shortcuts: Backspace dispatched POST /commands {type:'pcb_delete_placement', placementId:'39243258…'} (R8 deleted → revision 71→72, re-synced as a new placement id 497fba3c…), while the 'x' stayed in the box (Backspace can't correct typos). Typing a sentence saved the comment as 'QA-q5 C cen: as vela a cene' (P,B,o,m,t,r,l,p… eaten), switched on Route mode, and 'B' twice sent pcb_set_active_layer B.Cu twice with baseRevision 70 → second answered REVISION_CONFLICT and a red 'Revision conflict. Please retry after refresh.' banner appeared. Same applies to the thread 'Reply to thread…' textarea on PCB.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` keymap guard only checks INPUT
  - code: `src/modules/designer/frontend/components/comments/CommentComposerPopup.tsx:86` Textarea inside canvas overlay
- Q8-023 repro: Designer → open 'S3 Smoke — 5 LED indicators (v2)' → PCB tab → Cmd+I (Assistant dock) → click 'Ask about this design…' → Type 'Route the power traces on top layer' → Select D2 in the Components list, click the composer, type 'rf' → Select D1, click composer (contains 'typo'), press Backspace → Press Cmd+Z inside the composer
  - expected: All keystrokes go to the textarea; PCB keymap ignores events whose target is a textarea/select/contenteditable.
  - actual: Composer value became 'e e we aces n  laye' (R,o,t,h,p,o,r,t,c,s,o,t,p,y… swallowed) and the PCB switched to Route (R) mode; z→Zone, k→Keepout tool. With D2 selected, typing 'r' rotated D2 0°→90° (design rev 42→43). With D1 selected, Backspace in the composer deleted D1's placement (POST /commands, rev 40→41, placement id ce73e36f→11fd8b2e re-synced) instead of deleting a character. Cmd+Z in the composer undid the design (rev 42) and left the text untouched. All changes silently mutate the user's board while they type a question. (Restored via Undo afterwards.)
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` if (event.target instanceof HTMLInputElement) return; — textarea/select/contenteditable not excluded
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5012` Delete/Backspace deletes selection
- Q4-040 repro: Dual LED Blinker → PCB → click the free mounting hole (bottom-right) to select it → Click 'Export…' (focus stays on the Export… button; dialog opens) → Press Delete → Close the dialog; also: with the dialog open press R, then B
  - expected: A modal owns the keyboard: focus moves into it and canvas hotkeys are suspended until it closes
  - actual: Delete with the Export dialog open deleted the hole (projection holes 1 → 0, rev 513) with no visible feedback behind the backdrop; R armed Route mode (route parameter row appeared above the dialog) and B switched the active layer to Bottom Copper. Cmd+Z restored the hole. Same keymap gap as the Design rules dialog (Q4-022) and textareas (K12/Q4-019): the window keydown handler only ignores HTMLInputElement targets and never checks for an open modal.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` onKey: only HTMLInputElement targets are ignored
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:743` exportDialogOpen state exists but is not consulted by the keymap

## T-134 [S2] Concurrent edits rejected with 'Revision conflict' (drag while saving, Alt+click layer solo)

- Area designer.pcb · category bug · estimate M · findings F1A-003, Q4-011
- **shared** with D1; lead: D1
- Summary: Both envelopes carry baseRevision 15. J1's move is saved (rev 16); R2's gets {ok:false, code:'REVISION_CONFLICT', expected 15, actual 16}. R2 snaps back, and a 6 s toast says 'Revision conflict. Please retry after refresh.', telling the user to reload after a normal action. While both are in flight, J1 also jumps back to its old position, because the second drag replaces the single committedDragOverride map, then J1… | Also covers: Q4-011: Alt+click layer solo fails with 'Revision conflict. Please retry after refresh.' (two com…
- Root cause: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:505` — baseRevision read from projectionRef, which only advances when a response returns; concurrent PCB envelopes share it
- Proposed fix: Serialize dispatches in useDesignerWorkspace (queue, rebase baseRevision on each); D3 sends Alt+click solo as one command or awaits. — Detail: useDesignerWorkspace.ts dispatchEnvelope (:485-530): chain every dispatch for a design on a promise queue (queueRef.current = queueRef.current.then(() => send())) so each envelope takes baseRevision from the previous result (same fix as Q4-011). PcbCanvas.tsx: make committedDragOverride a Map merged per placementId and remove only that command's entries when it settles. Replace the 'retry after refresh' copy: on REVISION_CONFLICT for a move, refetch and re-dispatch once.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1a/dark/057-drag-race-after-first.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1a/dark/031-drag-race-after-first.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/053-alt-solo.png
- F1A-003 repro: PCB view, DRC markers hidden (View ▾ › DRC markers), latency shim 2.5 s (simulates a slow backend) → Drag J1 70 px down, release, and within ~0.5 s drag R2 to a new spot → Watch the canvas for 8 s, then GET projection/pcb
  - expected: Commands are serialized (or rebased): both moves persist, and the first part stays where it was dropped while its save is in flight.
  - actual: Both envelopes carry baseRevision 15. J1's move is saved (rev 16); R2's gets {ok:false, code:'REVISION_CONFLICT', expected 15, actual 16}. R2 snaps back, and a 6 s toast says 'Revision conflict. Please retry after refresh.', telling the user to reload after a normal action. While both are in flight, J1 also jumps back to its old position, because the second drag replaces the single committedDragOverride map, then J1 reappears when the refresh lands. Reproduced 2/2. Same root cause as Q4-011 (Alt+click solo sends two commands with one baseRevision): the PCB command path has no queue.
  - code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:505` baseRevision read from projectionRef, which only advances when a response returns; concurrent PCB envelopes share it
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3753` setCommittedDragOverride(optimistic) replaces the previous drag's optimistic map; also cleared to null on selection changes (:3284 etc.)
  - code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:104` user-facing copy 'Revision conflict. Please retry after refresh.'
- Q4-011 repro: PCB view, Layers panel → Alt+click the 'Top Copper F.Cu' row (while Bottom Copper is active) — or Alt+click 'Bottom Copper' → Observe toast at top of canvas and inline error in Board properties
  - expected: Layer soloed and made active, no error
  - actual: Two POST /commands are fired back-to-back with the same baseRevision (pcb_set_visible_layers and pcb_set_active_layer, both baseRevision 474); the second returns {ok:false, code:'REVISION_CONFLICT', expected 474, actual 475}. User sees 'Revision conflict. Please retry after refresh.' in a toast and in the Board panel; active layer silently stays on the old layer (status bar still 'Bottom Copper' while Top Copper is soloed). Reproduced in light on QA-q4-board (Alt+click 'Bottom Copper'): toast + Board-panel error 'Revision conflict. Please retry after refresh.'; the layer strip keeps 'Top Copper' selected while B.Cu is SOLO.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6590` void setVisibleLayers(...) then void setActiveLayer(...) not awaited
  - code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:505` baseRevision read from projectionRef at send time; parallel sends share it
  - code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:104` conflict message

## T-135 [S2] PCB sidebar: Layers list paints over Components (click interception) with many parts / at 1100×720

- Area designer.pcb · category bug · estimate S · findings F1B-001, Q4-042
- **shared** with D1; lead: D1
- Summary: The Layers section is squeezed to 56 px while its 354 px body stays overflow:visible, so the layer rows (Top Solder Paste … Bottom Courtyard, the Normal/Dim/Hide segment) are painted over component rows C1–C11. elementFromPoint on component rows C1–C4 and C6–C10 returns layer rows (pcb-layer-row-F.Paste/F.Mask/F.Cu/F.CrtYd/B.Cu/B.Mask/B.Paste/B.SilkS/B.CrtYd), so clicking 'C3' actually activates Top Copper instead o… | Also covers: Q4-042: At 1100×720 the Layers list spills over the Components section while routing (rows and he…
- Root cause: `src/modules/designer/frontend/components/CollapsibleSection.tsx:63` — section 'flex min-h-0 flex-col' shrinks (flex 0 1 auto) and body 'min-h-0 flex-1' has no overflow clipping
- Proposed fix: CollapsibleSection: flex/min-h-0 so sections share height and scroll internally; no overlap at 1100×720 or with >15 components. — Detail: In DesignerSidebar PCB branch make the Layers section `shrink-0` (or cap it with max-h + overflow-y-auto) and give the Components section `flex-1 min-h-0` with its list `overflow-y-auto`; add `overflow-hidden` to the CollapsibleSection body so a shrunk section can never paint over its sibling.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/014-pcb-stacked-150.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/002-pcb-stack60-markers.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/186-1100-routing.png
- F1B-001 repro: Open QA-f1b-stress (150 parts) at 1440×900 → Switch to PCB → Look at the left sidebar: Layers section and Components section → Click component row C3 in the Components list
  - expected: Layers and Components sections each get their own height and scroll independently (or the sidebar scrolls); no painted overlap; clicking a component row selects that component.
  - actual: The Layers section is squeezed to 56 px while its 354 px body stays overflow:visible, so the layer rows (Top Solder Paste … Bottom Courtyard, the Normal/Dim/Hide segment) are painted over component rows C1–C11. elementFromPoint on component rows C1–C4 and C6–C10 returns layer rows (pcb-layer-row-F.Paste/F.Mask/F.Cu/F.CrtYd/B.Cu/B.Mask/B.Paste/B.SilkS/B.CrtYd), so clicking 'C3' actually activates Top Copper instead of selecting C3. Happens on any board whose component list + layer list exceed the sidebar height (≈15+ parts at 1440×900) — not only while routing at 1100×720 (Q4-042 is the same root cause). Root cause shared with Q4-042 (reported there only for 1100×720 while routing); this shows it at the primary 1440×900 viewport on any mid-size board, with mis-targeted clicks.
  - code: `src/modules/designer/frontend/components/CollapsibleSection.tsx:63` section 'flex min-h-0 flex-col' shrinks (flex 0 1 auto) and body 'min-h-0 flex-1' has no overflow clipping
  - code: `src/modules/designer/frontend/components/DesignerSidebar.tsx:62` aside overflow-y-auto never scrolls because both sections shrink instead
- Q4-042 repro: Window 1100×720 → Dual LED Blinker → PCB, left sidebar with Layers + Components expanded → Press R and click a J1 pad to start routing (route row + hint row appear, canvas area shrinks by 56 px) → Look at the bottom of the Layers list
  - expected: Layers section scrolls inside its own bounds; Components header stays below it
  - actual: '▾ Components 11' header (top 453) is painted over the 'Bottom Courtyard B.CrtYd' row (top 452–474); the count '11' overlaps the row's eye icon. DOM: Layers scroller content 354 px inside a 304 px flex parent with overflow:visible. Also on the same screen the route parameter row wraps 'Standard 2L' onto two lines, the 'Net VCC 0.25 mm · netclass Default' status and the status-bar hint are clipped mid-word, and the layer row label truncates to 'Top Cop…' to fit the ROUTING badge.
  - code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:1` layers scroller nested in overflow-visible flex parent
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:798` 28px parameter-row shell; chips allow wrapping

## T-137 [S2] PCB canvas freezes with many DRC markers: one wheel notch ≈0.75 s, 10 notches 50 s, hovering 10 px >30 s (4 meshes + 4 materials per marker, rebuilt on every hover)

- Area designer.pcb · category perf · estimate M · findings F1B-004
- Summary: Idle 60 fps; with markers: 10 wheel notches took 50,690 ms (1 fps, 64 long tasks, max 1,609 ms); a single wheel notch = 745 ms long task; 10 mouse-move steps over the markers exceeded a 30 s timeout (hoveredId change rebuilds the whole marker array and re-renders ~204k meshes). Same board before DRC: 55–60 fps for wheel/pan. With the ~784 markers of the spread board it is usable, so the cost is linear in marker coun…
- Root cause: `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:74` — markers memo depends on hoveredId/selectedId → full rebuild on hover
- Proposed fix: DrcMarkerLayer: instanced meshes, shared materials, no rebuild on hover/zoom. — Detail: Render markers with one InstancedMesh per visual layer (glow/stroke/ring/core) and a per-instance colour attribute; update only the hovered/selected instance matrices; drive constant screen size with a shader uniform (or one group scale) instead of per-group scale in useFrame; decimate/cluster markers below a zoom threshold.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/017-drc-dock-stacked.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/002-pcb-stack60-markers.png
- F1B-004 repro: Same 150-part board after Run DRC (50,996 markers) → Hover the board and wheel-zoom 10 notches → Move the mouse 10 small steps across markers → Click a violation in the DRC dock
  - expected: Pan/zoom/hover stay at interactive frame rates (KiCad handles tens of thousands of markers); markers drawn with one InstancedMesh per layer and hover handled without rebuilding every marker.
  - actual: Idle 60 fps; with markers: 10 wheel notches took 50,690 ms (1 fps, 64 long tasks, max 1,609 ms); a single wheel notch = 745 ms long task; 10 mouse-move steps over the markers exceeded a 30 s timeout (hoveredId change rebuilds the whole marker array and re-renders ~204k meshes). Same board before DRC: 55–60 fps for wheel/pan. With the ~784 markers of the spread board it is usable, so the cost is linear in marker count.
  - code: `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:74` markers memo depends on hoveredId/selectedId → full rebuild on hover
  - code: `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:110` markers.map → group + 4 <mesh> + 4 meshBasicMaterial per marker; useFrame rescales every group every frame

## T-138 [S2] Copper-fill render order wrong: F.Cu pour hides top silk text; active inner-layer pour drawn under dimmed F.Cu

- Area designer.pcb · category visual · estimate S · findings F1B-032, F2B-005
- Summary: The text is cut off at the zone's left edge (x≈810 px) — '…Long PCB overlay text fo' — and does not reappear to the right of the pour; the solid red fill paints over it in both themes and with either copper layer active. Footprint silk/refdes inside the same pour stay visible, so only board-level overlay text is affected. A user placing a label/logo over a ground pour cannot see it in the editor. | Also covers: F2B-005: On multilayer boards the active inner layer's copper pour is painted underneath the (dimm…
- Root cause: `src/modules/designer/frontend/pcb/layers/CopperFillLayer.tsx:72` — copperFillRenderOrder: F.Cu pour at RENDER_ORDER.PINS − 0.35
- Proposed fix: Copper-fill render order: active layer pour above inactive (dimmed) pours; board silk above same-side pour. — Detail: Render board-level silk (OverlayLayer text/shapes on F.SilkS/B.SilkS) in a slot above same-side copper objects and pours, e.g. RENDER_ORDER.ANNULAR-0.5 for the view side, or change BASE_RENDER_SLOTS in @openpcb/r3f-eda-canvas so silk > copper fill for the facing side. Add a unit test: F.SilkS object > F.Cu fill (view top) and B.SilkS > B.Cu fill (view bottom).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/111-silk-under-fcu-zone.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/015-silk-under-fcu-zone.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/035-4L-In2-active-normal.png
- F1B-032 repro: QA-f1b-long → PCB: a F.SilkS overlay text 'Long PCB overlay text …' at y≈9.4 mm and a no-net F.Cu zone (red, top-right) that the text runs into → View top, Top Copper or Bottom Copper active, Display mode Normal → Follow the text to the right
  - expected: Silkscreen is printed on top of mask/copper: F.SilkS text (like footprint silk) renders above F.Cu pours, as in KiCad; the Gerber F_Silkscreen contains the full string.
  - actual: The text is cut off at the zone's left edge (x≈810 px) — '…Long PCB overlay text fo' — and does not reappear to the right of the pour; the solid red fill paints over it in both themes and with either copper layer active. Footprint silk/refdes inside the same pour stay visible, so only board-level overlay text is affected. A user placing a label/logo over a ground pour cannot see it in the editor.
  - code: `src/modules/designer/frontend/pcb/layers/CopperFillLayer.tsx:72` copperFillRenderOrder: F.Cu pour at RENDER_ORDER.PINS − 0.35
  - code: `src/modules/designer/frontend/pcb/layers/OverlayLayer.tsx:93` overlay text renderOrder = effectiveRenderOrder(layer,'object') — the F.SilkS object slot sits below the F.Cu pour slot
- F2B-005 repro: Stack B, QA-f2b-4L (KiCad 4-layer import: GND pours on F.Cu, B.Cu and In2.Cu) → PCB → Press 4 (Mid-Layer 2 becomes active; status bar 'Mid-Layer 2 In2.Cu'); Inactive layers = Normal → Compare with Alt+click 'Mid-Layer 2' (solo) → Z → Layer In2.Cu → draw a rectangle zone in the top-left of the board → Enter
  - expected: The active layer (including its pour) renders above the other copper layers, as in KiCad/Altium, so the user sees the plane they are editing; a freshly drawn/selected zone is at least outlined.
  - actual: With In2 active, the In2 GND plane shows only through the holes of the F.Cu pour (cyan islands in the centre); the dimmed F.Cu pour (#86000f) covers the rest of the board. Soloed, the same plane covers the whole board (shot 014). A zone drawn on In2 is created and selected (inspector 'Zone In2.Cu') but nothing of it is visible on the canvas — no fill, no outline, no selection highlight. Traces of the active inner layer are raised (In1 tracks draw on top), pours are not: CopperFillLayer uses a fixed per-layer render order (F.Cu = PINS−0.35 always above IN2_COPPER−0.35) instead of the active-layer-aware effectiveRenderOrder used by traces and zone outlines; In3+ pours fall through to the B.Cu slot.
  - code: `src/modules/designer/frontend/pcb/layers/CopperFillLayer.tsx:55` copperFillRenderOrder: fixed F > In1 > In2 > B order, In3+ fall to the B.Cu slot
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:396` effectiveRenderOrder is viewSide-aware only, not active-layer aware (traces use it too)
  - code: `src/modules/designer/frontend/pcb/layers/ZoneOutlineLayer.tsx:129` zone outline order also below the F.Cu pour mesh

## T-139 [S2] A quick tap on a footprint leaves a hidden drag armed: the next click anywhere teleports that footprint to the click point (R3 jumped onto C2)

- Area designer.pcb · category bug · estimate S · findings F2A-003
- Summary: POST pcb_move_placement {placementId: R3, positionMm: (-2.135, 8.999)} (= C2's exact position) was sent by the click intended to select C2, then F flipped C2 — R3 and C2 ended stacked. Reproduced 5× (3/3 in one scripted sequence: two instant taps ~1 s apart; e.g. R3 (6.988,3.009) → (12.214,-9.212) = the second tap point), not with 90 ms clicks. Intermittent because it depends on whether React re-renders between poin…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3731` — onPointerUp reads the render-closure dragSession; when pointerup arrives before the re-render that follows pointerdown's setDragSession (:3456) it is null → early return, session never cleared
- Proposed fix: Clear armed drag on pointerup without movement threshold crossing. — Detail: Mirror dragSession in a ref (set synchronously in onPointerDown next to setDragSession) and read the ref in onPointerUp/onPointerMove; always clear the session on pointerup/pointercancel/lostpointercapture; ignore pointermove updates when event.buttons === 0.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/038-rot-flip.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2a/dark/017-after-tap-hover.png
- F2A-003 repro: QA-f2a-golden PCB, board fitted → Tap R3 (mousedown+mouseup in the same frame, like a trackpad tap-to-click), press R to rotate (optional) → Click C2 (or any empty board spot) to select something else → R3 is moved to the clicked point (snapped onto C2's centre); Undo restores it
  - expected: A click (with no pointer travel beyond the drag threshold) only selects; a later click elsewhere never moves the previously clicked part.
  - actual: POST pcb_move_placement {placementId: R3, positionMm: (-2.135, 8.999)} (= C2's exact position) was sent by the click intended to select C2, then F flipped C2 — R3 and C2 ended stacked. Reproduced 5× (3/3 in one scripted sequence: two instant taps ~1 s apart; e.g. R3 (6.988,3.009) → (12.214,-9.212) = the second tap point), not with 90 ms clicks. Intermittent because it depends on whether React re-renders between pointerdown and pointerup.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3731` onPointerUp reads the render-closure dragSession; when pointerup arrives before the re-render that follows pointerdown's setDragSession (:3456) it is null → early return, session never cleared
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3636` onPointerMove keeps updating the surviving session with no button pressed (part follows the hovering cursor, moved=true)
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:629` dragSession is useState only (freePrimitiveDragSession has a ref mirror)

## T-140 [S2] Layers-panel copper-fill droplet is titled 'Show/Hide copper fills' but creates/enables a board-wide SOLID pour: it silently overrides the user's thermal zone (canvas and Gerber) and the canvas draws clearance rings around same-net GND vias that the Gerber does not have

- Area designer.pcb · category bug · estimate S · findings F2A-004
- Summary: Click → rev 111→112, a persisted zone {id:'board:B.Cu', region:{kind:'board'}, net GND, padConnection:'solid'} is added. J1.2 loses its thermal spokes (now solid), and all three GND vias get a dark #05080c ring (pixel probe) as if cleared from the pour, while ratsnest still says 0. Clicking again doesn't remove the zone — it leaves a disabled 'board:B.Cu' row in the design. The droplet showed the 'off' state (struck…
- Root cause: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:517` — button title 'Show copper fills'/'Hide copper fills', no aria-label/aria-pressed; onClick → onToggleBoardZone; off-state only considers the board zone
- Proposed fix: Droplet toggles fill visibility only; pour creation stays an explicit action (label accordingly). — Detail: Keep the contract semantics but label them honestly: title/aria-label 'Board pour on B.Cu (GND, solid) — click to disable' vs 'Add board pour on B.Cu…', aria-pressed from the board zone's enabled state, and surface the net/pad-connection pickers §12.3 requires before the first enable. When a same-net polygon zone already exists on the layer, confirm (or inherit its padConnection) instead of silently flooding over its thermals. Fix the canvas fill so a same-net board plane does not draw clearance around same-net vi…
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/063-pour-j1.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2a/dark/025-bcu-before-nomarker.png
- F2A-004 repro: QA-f2a-golden PCB: draw a B.Cu GND zone with Z, Pads = Thermal relief (thermal spokes visible on J1.2, shots/f2a/dark/063) → Layers panel → Bottom Copper row → droplet icon (struck through, title 'Show copper fills' although the B.Cu pour is plainly visible) → Compare the canvas; GET /projection/pcb zones
  - expected: A control titled Show/Hide copper fills only changes visibility; creating a pour is an explicit action and never overrides an existing zone's pad-connection style. The icon state reflects whether fills are shown.
  - actual: Click → rev 111→112, a persisted zone {id:'board:B.Cu', region:{kind:'board'}, net GND, padConnection:'solid'} is added. J1.2 loses its thermal spokes (now solid), and all three GND vias get a dark #05080c ring (pixel probe) as if cleared from the pour, while ratsnest still says 0. Clicking again doesn't remove the zone — it leaves a disabled 'board:B.Cu' row in the design. The droplet showed the 'off' state (struck through, 'Show copper fills') even while the polygon pour was rendered, so users will click it to 'see' their pour. No aria-label/aria-pressed on the button.
  - code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:517` button title 'Show copper fills'/'Hide copper fills', no aria-label/aria-pressed; onClick → onToggleBoardZone; off-state only considers the board zone
  - code: `src/modules/designer/frontend/pcb/tools/board-zone-controls.ts:26` boardZoneToggleAction: 'add' creates a board-region zone when none exists (by design, contract 03 §12.3)
  - code: `docs/pcb-hardening/03-zone-keepout-contract.md:499` §12.3: 'the per-layer copper-fill control is the board zone: toggle = enabled … plus net and pad-connection pickers' — the control is meant to manage a board pour, not visibility

## T-141 [S2] Route tool ignores the name-based net class DRC uses: VCC/GND are routed at the Default 0.25 mm ('Class Default' in the route row) and the next DRC flags every one of them NETCLASS_TRACE_WIDTH (Power 0.5 / GND 0.4)

- Area designer.pcb · category bug · estimate XS · findings F2A-006
- Summary: All 18 traces are stored netClassId 'default'; DRC: 7× NETCLASS_TRACE_WIDTH 'Trace 0.250 mm is narrower than net class "Power" width 0.500 mm' / '"GND" width 0.400 mm' (0 errors, 45 warnings total). The user must know to press W for every power trace; a router-default trace immediately becomes a DRC warning.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3089` — route start: sessionClass = perNetClassAssignments[netId] || defaultNetClass — no name-pattern fallback
- Proposed fix: Route tool resolves net class with the same resolver DRC uses (name-based classes). — Detail: Resolve the route/bundle session class with resolveNetClassId(netNames[netId], netClasses, perNetClassAssignments, netId) at PcbCanvas.tsx:3089 and :2854, and make effectiveNetClassId use the same resolver so the router, the committed trace's netClassId, ratsnest and DRC agree.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/048-via-pressed.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2a/dark/021-route-vcc-active.png
- F2A-006 repro: Fresh design with a VCC power port and GND ports; no Design-rules net assignments touched → PCB → R → click a VCC pad: route row shows 'W 0.250 mm · Class Default', live status 'Net VCC 0.25 mm · netclass 'Default'' → Route VCC/GND traces normally, Run DRC
  - expected: One net-class resolution everywhere: the route tool starts VCC at the Power class width (0.5 mm) and GND at 0.4 mm — the same classes the ratsnest (netClassId 'gnd') and DRC resolve by name — or DRC does not hold traces to a class the router never offered.
  - actual: All 18 traces are stored netClassId 'default'; DRC: 7× NETCLASS_TRACE_WIDTH 'Trace 0.250 mm is narrower than net class "Power" width 0.500 mm' / '"GND" width 0.400 mm' (0 errors, 45 warnings total). The user must know to press W for every power trace; a router-default trace immediately becomes a DRC warning.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3089` route start: sessionClass = perNetClassAssignments[netId] || defaultNetClass — no name-pattern fallback
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2854` bundle routing also starts from defaultNetClass
  - code: `src/shared/drc/rule-resolver.ts:254` DRC resolves the class with resolveNetClassId (name patterns GND/VCC → gnd/power)
  - code: `src/shared/pcb-areas/net-class-resolver.ts:81` effectiveNetClassId (commit path) also only honours explicit assignments

## T-143 [S2] 6-layer boards: In3/In4 copper is invisible and unreachable — no layer tab, no Layers row, 'All copper' preset skips them, keys 3/4 go dead, and the layer-pair list only knows 4-layer pairs

- Area designer.pcb · category bug · estimate M · findings F2B-007
- Summary: Projection has traces on In3.Cu (4) and In4.Cu (3), but the strip shows only Top, Mid-Layer 1, Mid-Layer 2, Bottom; the Layers panel has no In3/In4 rows; 'All copper' sets visibleLayers to [F.Cu, In1.Cu, In2.Cu, B.Cu] only, so the In3/In4 tracks are never drawn (nothing at the D2-K chain location, shot 054). Keys 3/4 do nothing on a 6-layer board (handler requires layerCount === 4), so In1/In2 are keyboard-unreachab…
- Root cause: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:17` — STRIP_LAYERS hard-codes In1/In2 (requiresLayerCount: 4)
- Proposed fix: Layer tabs/Layers rows/'All copper' preset/keys cover In3/In4 on 6-layer boards. — Detail: Build strip tabs, Layers rows and presets from copperLayersForCount(board.layerCount) (colours already exist via copperLayerColor ramp); make 3/4 (and e.g. 5/6 or +/-) step through inner layers for any count ≥4; call layerPairPresets(board.layerCount) in LayerPairSelect and key the chosen pair per design. Until then, warn at import that In3+ are not editable.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/051-6L-pcb.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/dark/012-6L-pcb.png
- F2B-007 repro: Stack B: Home → Import KiCad… → $QA/f2b/QA-f2b-6L.zip (F.Cu, In1–In4, B.Cu; tracks on In3 (Net-(D2-K) ×4) and In4 (Net-(U1-VDD) ×3)) → QA-f2b-6L → PCB: read the layer tab strip, the Layers panel, Board → Stackup ('Copper layers 6') → Hover canvas, press 3 / 4 → Layers → Preset ▾ → All copper → R → layer-pair select; click where the In3 track runs (155.75, 140.3)
  - expected: Every copper layer of the stackup is listed, visible and routable (tabs In1…In4 or 'Mid-Layer 1…4', rows with eye/opacity, 'All copper' = all six, layer keys or a layer picker for In3/In4, layer pairs for adjacent layers In2↔In3, In3↔In4, In4↔B).
  - actual: Projection has traces on In3.Cu (4) and In4.Cu (3), but the strip shows only Top, Mid-Layer 1, Mid-Layer 2, Bottom; the Layers panel has no In3/In4 rows; 'All copper' sets visibleLayers to [F.Cu, In1.Cu, In2.Cu, B.Cu] only, so the In3/In4 tracks are never drawn (nothing at the D2-K chain location, shot 054). Keys 3/4 do nothing on a 6-layer board (handler requires layerCount === 4), so In1/In2 are keyboard-unreachable too. The route tool's 'Smart-via layer pair' offers F↔B, F↔In1, In1↔In2, In2↔B (In2↔B is not an adjacent pair on 6 layers); clicking on the hidden In3 track starts a no-net route on In2 in empty space. The layer pair chosen on the 4-layer design ('In1↔In2') also carries over to this design. Import review showed 'Copper layers 6' with no warning that half the inner stack cannot be viewed/edited. Inconsistently, the Zone tool's Layer select does offer In3.Cu and In4.Cu, so a 
  - code: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:17` STRIP_LAYERS hard-codes In1/In2 (requiresLayerCount: 4)
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4900` keys 3/4 gated on layerCount === 4
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:69` LayerPairSelect uses static LAYER_PAIR_PRESETS (route-layer.ts:26 = layerPairPresets(4))
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:438` 'All copper' preset visibleLayers hard-coded to F/In1/In2/B
  - code: `docs/pcb-hardening/15-high-speed-runway.md:293` registered finding 7.3: PcbLayerTabStrip knows In1/In2 only

## T-145 [S2] DRC count differs between toolbar (errors only) and dock tab / status bar (errors+warnings)

- Area designer.pcb · category consistency · estimate S · findings Q4-001 · known spike
- Summary: Toolbar DRC button shows '13' (errors only, PcbCanvas drcErrorCount = summary.errors); dock tab badge shows '19' in red and status bar shows '19 DRC' with a red diamond (errors+warnings). Home list row shows '13 errors'. Three different numbers semantics on one screen, no label/tooltip telling which is which; warnings-only boards will still render a red (danger) badge on the dock tab. Re-checked after a later DRC ru…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:606` — drcErrorCount = report.summary.errors
- Proposed fix: One DRC count everywhere (errors+warnings with split tooltip) — toolbar = dock = status bar. — Detail: Pick one metric (recommend errors, with warnings as a secondary amber count 'E 13 · W 6') and share it via a single selector in useDrcStore; use text-status-warning when only warnings exist; add a title like '13 errors, 6 warnings' on all three.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/001-pcb-initial.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/001-pcb.png
- Q4-001 repro: Open 'Dual LED Blinker' (13 errors, 6 warnings in last DRC run) → Switch to PCB view → Compare toolbar 'DRC' badge, right-dock 'DRC' tab badge, and status-bar DRC chip
  - expected: One number (or clearly split errors/warnings) used consistently in every DRC indicator; badge colour red only when errors exist
  - actual: Toolbar DRC button shows '13' (errors only, PcbCanvas drcErrorCount = summary.errors); dock tab badge shows '19' in red and status bar shows '19 DRC' with a red diamond (errors+warnings). Home list row shows '13 errors'. Three different numbers semantics on one screen, no label/tooltip telling which is which; warnings-only boards will still render a red (danger) badge on the dock tab. Re-checked after a later DRC run: toolbar 32 vs dock tab 106 vs status bar 106 (both themes); while a route is in progress the status-bar chip switches to the live route count ('1 DRC') — a fourth number with the same label.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:606` drcErrorCount = report.summary.errors
  - code: `src/modules/designer/frontend/Space.tsx:930` drcIssueCount = errors + warnings, dock badge always text-status-danger (:970)
  - code: `src/modules/designer/frontend/Space.tsx:1588` status bar: pcbLiveDrc ?? errors+warnings — live route count reuses the same chip

## T-146 [S2] Canvas jumps 14 px each time a route/tune/notice row appears (resizes mid-gesture)

- Area designer.pcb · category bug · estimate M · findings Q4-004, F1B-033, F2A-020
- **shared** with D1; lead: D1
- **Approved scope:** Approved proposal P1: fixed 28 px PCB tool row; notices as canvas overlays; canvas never resizes mid-gesture.
- Summary: The toolbar stack grows 28 px per row (Route row, hint row, notice row), the canvas shrinks and the orthographic camera stays centred, so all copper moves 14 px vertically. The rubber-band endpoint jumps ~0.7 mm at 80% zoom right after the first click, and again whenever a transient notice ('Via blocked', 'Commit blocked') appears/disappears, causing misplaced clicks. | Also covers: F1B-033: Arming Route (R) or Tune (U) inserts a 28 px parameter bar above the PCB canvas, so the b…; F2A-020: Extension of F1B-033/Q4-004: after the FIRST click of a route a second hint row ('Enter f…
- Root cause: `src/modules/designer/frontend/Space.tsx:1314` — param-row slot is a shrink-0 flex child above the canvas, so every portalled row shrinks the canvas
- Proposed fix: Reserve a fixed tool/hint row in PCB view (or render route/notice rows as canvas overlays) so the canvas never resizes mid-gesture. — Detail: Keep the param row a fixed single 28 px row per D10: move the route hint line into the status bar (it is already duplicated there) and render routeNotice/autoFinish notices as an absolutely-positioned overlay inside the canvas (like AreaToolOptionsBar) instead of extra rows in the Space.tsx:1314 slot; optionally reserve the 28 px slot whenever the PCB view is active so arming Route doesn't resize the canvas.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/018-route-idle.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/019-routing.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/001-pcb-initial.png
- Q4-004 repro: PCB view at 1440x900, note a pad position (J1 pin 2 at ~463,462) → Press R: the Route parameter row appears → pad now at ~463,476 → Click the pad to start routing: second hint row appears → pad now at ~463,490 → Press V where the via is refused: a third 'Via blocked…' row appears → board shifts again; row disappears on next action → shifts back
  - expected: Starting a tool/route never moves the design under a stationary cursor (param rows overlay the canvas or reserve fixed space, or the camera compensates)
  - actual: The toolbar stack grows 28 px per row (Route row, hint row, notice row), the canvas shrinks and the orthographic camera stays centred, so all copper moves 14 px vertically. The rubber-band endpoint jumps ~0.7 mm at 80% zoom right after the first click, and again whenever a transient notice ('Via blocked', 'Commit blocked') appears/disappears, causing misplaced clicks.
  - code: `src/modules/designer/frontend/Space.tsx:1314` param-row slot is a shrink-0 flex child above the canvas, so every portalled row shrinks the canvas
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6617` param row / hint / notice rows portalled into paramRowTarget
  - code: `src/modules/designer/frontend/pcb/RouteHud.tsx:31` routeNotice rendered as an extra row
- F1B-033 repro: QA-f1b-stress → PCB, hold the mouse still at (700,500) and read the status-bar X/Y → Press R (route) without moving the mouse and read X/Y again → Esc; press U (Tune), click a routed trace (Net_43)
  - expected: Tool parameters appear in a fixed-height strip or an overlay so the canvas never resizes; the pad/trace under the cursor stays under the cursor when a tool is armed by key (KiCad/Altium keep the canvas fixed).
  - actual: Canvas top moves 64 → 92 px on R and on U (Measure M and Hole H do not); the world point under the stationary cursor changes from (−10.055, −11.243) to (−10.055, −7.633) mm — a 14 px jump — and returns on Esc. In Tune, clicking a trace adds the 28 px HUD row (canvas top 92 → 120) so the trace the user just clicked slides another ~14 px away before 'sweep along the trace' can start (shots 115: trace at y≈600–715 before, ≈615–730 after). At 1100×720 the Tune HUD wraps to 56 px (F1B-034), shifting further.
  - code: `src/modules/designer/frontend/Space.tsx:1314` pcbParamRowSlot is an in-flow shrink-0 div above the canvas — portalled PcbParamRow content changes its height
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:799` PcbParamRow (RouteHud/TuneHud/BundleHud render into it)
- F2A-020 repro: PCB idle: calibrate (e.g. U1.3 at y=451) → Press R: row 1 appears → board +14 px (U1.3 at 465) → Click a start pad: row 2 (hints) appears → board +14 px again (U1.3 at 479) → Aim at the target pad where it was a moment ago
  - expected: Route rows overlay the canvas or reserve space permanently; pads never move under the cursor mid-gesture.
  - actual: Three different frames in one trace: idle (oy 26.52 mm), route armed (27.32), route active (28.13) — 0.8 mm per step at 17 px/mm. My first attempt at R3.1→U1.3 missed the pad by 14 px and turned into a runaway route through U1 with '8 conflicts' (/Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/043-routes-2-6.png) that had to be cancelled.
  - code: `src/modules/designer/frontend/Space.tsx:1309` PcbCanvas portals its docked toolbar / parameter rows into in-flow containers above the canvas

## T-147 [S2] Trace width / via diameter / via drill 'Custom…' use native window.prompt with no validation

- Area designer.pcb · category bug · estimate S · findings Q4-008 · known K03
- Summary: 3 window.prompt calls (dialog-spy count prompt=3); menu item label 'Custom… (Alt+W)' promises the inline editor but opens a native prompt instead; non-numeric input silently discarded; drill ≥ diameter accepted and a physically impossible via is dropped into the session (only live DRC '6 conflicts' hints at it). Native prompts are unstyled and blocked/unsupported in some Electron configs.
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:207` — window.prompt trace width
- Proposed fix: 'Custom…' width/via -> inline kit NumberInput popover with validation (no window.prompt). — Detail: Replace prompts with an inline numeric input inside the dropdown (reuse the RouteHud 'Trace width (mm)' input pattern); validate drill < diameter − 2×min annular ring and show the error inline; make the 'Custom…' item open the same inline editor as Alt+W.
- Depends on: ['T-004', 'T-014']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/023-width-dropdown.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/022-width-dd.png
- Q4-008 repro: PCB → R → click J1 pin 2 to start routing → Click the 'W 0.500 mm' chip → 'Custom… (Alt+W)' → native prompt 'Custom trace width (mm):' → Click 'Ø 0.80 mm' → 'Custom…' → prompt 'Custom diameter (mm):', type 'abc' → nothing happens, no error → Click '⌀ 0.40 mm' → 'Custom…' → prompt 'Custom drill (mm):', type 1.2 (> 0.80 diameter) → accepted; press V → a via with drill larger than its pad is placed
  - expected: Inline numeric editor (the RouteHud already has one for width, opened by Alt+W) with validation (drill < diameter, ≥ fab min) and inline error text
  - actual: 3 window.prompt calls (dialog-spy count prompt=3); menu item label 'Custom… (Alt+W)' promises the inline editor but opens a native prompt instead; non-numeric input silently discarded; drill ≥ diameter accepted and a physically impossible via is dropped into the session (only live DRC '6 conflicts' hints at it). Native prompts are unstyled and blocked/unsupported in some Electron configs.
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:207` window.prompt trace width
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:294` window.prompt via diameter/drill

## T-148 [S2] Deleting a footprint on PCB silently re-spawns it at an auto position overlapping another part

- Area designer.pcb · category data · estimate S · findings Q4-014
- **Approved scope:** Approved (DEC-PCB2): block deleting a schematic-backed footprint on PCB with a notice "Delete R3 in the schematic".
- Summary: POST pcb_delete_placement succeeds (rev 498→499), the schematic sync immediately creates a NEW placement for R3 at X -2.015 Y -3.052, rotation 0 — directly on top of R4's pads. No notice, Components list still shows 11 parts, selection cleared. Undo restores the old placement, but a user who doesn't notice ends up with overlapping parts / broken routing.
- Root cause: `src/modules/designer/backend/command-executor.ts:1689` — pcb_delete_placement deletes the row
- Proposed fix: Block PCB delete of schematic-backed footprints with notice 'Delete R3 in the schematic' (frontend); no re-spawn. — Detail: Refuse pcb_delete_placement for schematic-backed placements (or convert it into 'unplace' that keeps position/rotation in a parked area and shows a notice); in the UI, disable Delete for footprints and hint 'Delete R3 in the schematic'.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/076-delete-part.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/014-r3-respawned.png
- Q4-014 repro: Open 'Dual LED Blinker' → PCB → Click 'R3' in the Components panel (selects + centres R3 at X -6.480 Y -2.967) → Press Delete (hint says 'Del delete') → Click R3 in the Components panel again
  - expected: Either the footprint is removed (and the part shown as unplaced) or deletion is refused with a message ('R3 is driven by the schematic — delete it there'); never a silent move
  - actual: POST pcb_delete_placement succeeds (rev 498→499), the schematic sync immediately creates a NEW placement for R3 at X -2.015 Y -3.052, rotation 0 — directly on top of R4's pads. No notice, Components list still shows 11 parts, selection cleared. Undo restores the old placement, but a user who doesn't notice ends up with overlapping parts / broken routing.
  - code: `src/modules/designer/backend/command-executor.ts:1689` pcb_delete_placement deletes the row
  - code: `src/modules/designer/backend/pcb/pcb-projection.ts:206` projection read calls syncPcbPlacementsFromSchematic, re-adding the part at an auto position
  - code: `src/modules/designer/backend/pcb/pcb-store.ts:1870` syncPcbPlacementsFromSchematic

## T-149 [S2] Vias under a trace end can't be picked: click/right-click always hit the trace, and the Alt+click overlap picker closes the instant it opens

- Area designer.pcb · category bug · estimate M · findings Q4-016
- Summary: hit order pad → trace → via, so any via with a connected trace is unreachable by click. The 'Disambiguation chooser' listbox is mounted and removed on the same click (MutationObserver saw it added once, it is gone 400 ms later): its window mousedown 'click-outside' listener is registered during the pointerdown that opened it and then fires for that same click's mousedown. Because the popup state is reset, 'Alt+click…
- Root cause: `src/modules/designer/frontend/pcb/pcb-hit.ts:396` — Order: pad → trace → via → placement
- Proposed fix: Hit-test prefers vias over trace ends; Alt+click overlap picker stays open until choice/Esc. — Detail: Put vias before traces in the plain-click and context-menu hit order; in PcbDisambiguationPopup register the outside-close listener on the next tick (setTimeout 0) or ignore the event whose timeStamp ≤ open time; add real Trace/Via property sections (net, layer, width/diameter/drill, length) with editable width/size.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/085-zoom-via.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/015-zoom-via.png
- Q4-016 repro: PCB, zoom in on any via with a trace ending on it (e.g. the via right of R5) → Click the middle of the via → status bar 'Trace · …' → Right-click the via → menu is 'Split and reroute from here / Delete trace / Add comment' (no via menu) → Alt+click the via → no chooser visible, the trace stays selected; repeating Alt+click never cycles to the via
  - expected: Via wins over track on a direct click (KiCad), or the Alt+click chooser stays open listing Trace + Via
  - actual: hit order pad → trace → via, so any via with a connected trace is unreachable by click. The 'Disambiguation chooser' listbox is mounted and removed on the same click (MutationObserver saw it added once, it is gone 400 ms later): its window mousedown 'click-outside' listener is registered during the pointerdown that opened it and then fires for that same click's mousedown. Because the popup state is reset, 'Alt+click again to cycle' always re-picks candidate 0. Only workaround is F → Selection filter → untick Traces. Via right-click shows the trace menu even when traces are filtered out. Via and trace inspectors show only 'CONTENTS · Vias 1 / Traces 1' — no net, width, layer, diameter/drill, and nothing is editable.
  - code: `src/modules/designer/frontend/pcb/pcb-hit.ts:396` Order: pad → trace → via → placement
  - code: `src/modules/designer/frontend/pcb/PcbDisambiguationPopup.tsx:58` window mousedown outside-close registered while the opening click is still in flight
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3225` Alt+click opens popup from the pointerdown handler

## T-153 [S2] Layer visibility / active-layer / view clicks are recorded as undoable document edits (revision bump, DRC stale) and their undo is a silent no-op

- Area designer.pcb · category bug · estimate M · findings Q4-025
- **Approved scope:** Approved (DEC-PCB1): layer visibility/active layer/view become per-design view state (frontend, localStorage) — not undoable document edits.
- Summary: Each view click is a design command (pcb_set_visible_layers / pcb_set_active_layer / pcb_set_view_state), bumps the revision (Dual LED Blinker went r449→r510 in one session, mostly from view clicks; a single preset click = 4 revisions), marks DRC stale and pushes an undo entry. Cmd+Z then 'undoes' them with no visible change (F.SilkS stays hidden, active layer stays B.Cu) — two presses consumed, redoDepth 2. With th…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6580` — comment claims view state is 'durable but non-undoable'
- Proposed fix: Treat layer visibility/active layer/view as view state (per-design localStorage), not undoable document commands. — Detail: Persist view state outside the command log (per-user view-state endpoint or local store), or mark these command types non-undoable and non-revisioning in the command executor.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/115-new-pcb.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/006-keys-behind-export.png
- Q4-025 repro: New design 'QA-q4-board' → PCB (rev 0, undoDepth 0, Undo disabled) → Click the eye on 'Top Overlay' → rev 1, undoDepth 1, Undo enabled → Click layer tab 'Bottom Copper' → rev 2, undoDepth 2 → Press Cmd+Z twice
  - expected: View state (visibility, active layer, view side, opacity, preset, display mode) is not part of the design undo history and doesn't bump the design revision
  - actual: Each view click is a design command (pcb_set_visible_layers / pcb_set_active_layer / pcb_set_view_state), bumps the revision (Dual LED Blinker went r449→r510 in one session, mostly from view clicks; a single preset click = 4 revisions), marks DRC stale and pushes an undo entry. Cmd+Z then 'undoes' them with no visible change (F.SilkS stays hidden, active layer stays B.Cu) — two presses consumed, redoDepth 2. With the 200-entry cap, layer toggling pushes real edits out of the undo history.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6580` comment claims view state is 'durable but non-undoable'
  - code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:368` setActiveLayer dispatches a design command

## T-154 [S2] Board panel shows un-applied typed size as the board's real size after 'Done' (e.g. 'Circle 80 × 60' for a 60 mm circle)

- Area designer.pcb · category data · estimate XS · findings Q4-026
- Summary: Read-only view shows 'Shape Circle · Width 80 · Height 60' while the canvas and backend still hold a 60×60 circle; same with the earlier rect case (shot 118: panel 'Rectangle 60 × 30', board 50 × 30). The stale buffer stays until the outline next changes, so the user believes the board is resized.
- Root cause: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:418` — read-only Width/Height render widthText/heightText (edit buffers)
- Proposed fix: Board panel shows applied size only; typed values stay in draft until Apply. — Detail: Render the read-only rows from currentOutline.widthMm/heightMm (roundDimMm), and on Done (onToggleEditMode false) re-seed widthText/heightText from the persisted outline; optionally prompt 'Apply changes?' when buffers differ.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/118-done-without-apply.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/043-done-unapplied.png
- Q4-026 repro: New design QA-q4-board → PCB, nothing selected → Properties → Board → Edit → Board is a 60 mm circle (projection outline kind=circle 60×60) → Click 'Rect', type Width 80, do NOT click Apply, click 'Done' → Read the read-only OUTLINE section
  - expected: Read-only view reflects the persisted outline (Circle, Ø60) and un-applied edits are discarded (or Done applies them / asks)
  - actual: Read-only view shows 'Shape Circle · Width 80 · Height 60' while the canvas and backend still hold a 60×60 circle; same with the earlier rect case (shot 118: panel 'Rectangle 60 × 30', board 50 × 30). The stale buffer stays until the outline next changes, so the user believes the board is resized.
  - code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:418` read-only Width/Height render widthText/heightText (edit buffers)
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:1170` buffers only re-seeded when projection outline changes
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5594` onToggleEditMode does not reset buffers

## T-155 [S2] 'Fit to parts' ignores free pads/holes (cuts them off the board) and on an empty board silently resizes to a hard-coded 80 × 56 mm

- Area designer.pcb · category data · estimate S · findings Q4-028
- Summary: Board silently becomes 80 × 56 (rev 8 → 9): fallbackBoardBoundsFromProjection returns a fixed {-40,-28,40,28} box when there are no placements/traces/vias. The same helper ignores free holes, free pads, zones, keepouts and overlay text, so fitting a board that has them cuts them off. On DRC Demo the board shrank to 40.6 × 14 (rev 11→12) and the panel immediately warned '2 items outside outline' — the free pad at (-1…
- Root cause: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:229` — fitBoardToParts uses 3D fallback bounds helper
- Proposed fix: Fit to parts includes free pads/holes/text; empty board shows notice instead of silent 80×56 resize. — Detail: In PcbBoardPanel disable 'Fit to parts' when placements+traces+vias+freeHoles+freePads+zones+texts are all empty (title 'Nothing on the board to fit'); give fitBoardToParts its own bounds helper that includes every board item and returns null when empty.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/124-fit-to-parts-empty.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/030-drc-demo-pcb.png
- Q4-028 repro: QA-q4-board (0 components) → PCB → Board panel → Edit → Board is a rounded rect 80 × 60 → Click 'Fit to parts' → DRC Demo (3196d811, 50×30 board with 2 free pads, 3 free holes, 5 traces, 1 via) → PCB → Board panel → 'Fit to parts'
  - expected: Button disabled (or a notice 'No parts to fit') when there is nothing on the board; free holes/pads/zones/text also counted when present
  - actual: Board silently becomes 80 × 56 (rev 8 → 9): fallbackBoardBoundsFromProjection returns a fixed {-40,-28,40,28} box when there are no placements/traces/vias. The same helper ignores free holes, free pads, zones, keepouts and overlay text, so fitting a board that has them cuts them off. On DRC Demo the board shrank to 40.6 × 14 (rev 11→12) and the panel immediately warned '2 items outside outline' — the free pad at (-15, 8) and the hole at (16, 8) were left outside the new board. Undone with Cmd+Z.
  - code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:229` fitBoardToParts uses 3D fallback bounds helper
  - code: `src/modules/designer/frontend/three-d/primitives/geometry-utils.ts:427` hard-coded 80×56 fallback; only placements/traces/vias considered

## T-156 [S2] PCB Text tool uses window.prompt and drops text onto a hidden silkscreen layer

- Area designer.pcb · category bug · estimate S · findings Q4-030, Q4-031 · known K02
- Summary: Browser-native prompt 'Overlay text:' blocks the page (the click's mouseup hangs until the dialog is handled); dialog spy: {prompt:1, log:['prompt: Overlay text:']}. In Electron window.prompt is unsupported, so the Text tool cannot place anything there. Any add failure is swallowed (.catch(() => undefined)). | Also covers: Q4-031: Text tool drops text onto a hidden silkscreen layer with no feedback — placed text is inv…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2996` — window.prompt("Overlay text:", "")
- Proposed fix: Text tool: inline text popover (no window.prompt); auto-enable silkscreen layer or warn when target layer hidden. — Detail: Place the text immediately with a placeholder ('TEXT') and focus the Properties 'Text' input (already exists in the text inspector), or open a small kit popover at the click point with an input + Enter/Esc; surface add failures via the workspace error strip.
- Depends on: ['T-014']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/157-text-tool.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/033-qa-board.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/158-text-placed.png
- Q4-030 repro: QA-q4-board → PCB → press T (or Add ▾ → Text) → Click on the board
  - expected: Inline in-canvas text editor or kit dialog (Electron blocks/does not support window.prompt; sandboxed renderer returns null)
  - actual: Browser-native prompt 'Overlay text:' blocks the page (the click's mouseup hangs until the dialog is handled); dialog spy: {prompt:1, log:['prompt: Overlay text:']}. In Electron window.prompt is unsupported, so the Text tool cannot place anything there. Any add failure is swallowed (.catch(() => undefined)).
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2996` window.prompt("Overlay text:", "")
- Q4-031 repro: QA-q4-board → PCB with 'Top Overlay F.SilkS' hidden (eye off; default preset hides overlay here) → Press T, click the board, enter 'QA text' in the prompt → Look at the canvas; then turn on the Top Overlay eye
  - expected: Tool places on a visible layer, or auto-reveals the target layer, or shows a notice 'Placed on hidden layer F.SilkS'
  - actual: Projection gains overlayText {layer:'F.SilkS', text:'QA text'} (rev 30) but nothing appears on the canvas and no notice/selection is shown; only after toggling the layer eye does the text appear. Layer is always F.SilkS/B.SilkS by view side, independent of the active layer (B.Cu here) or visibility.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2998` textLayer = mirrorActive ? B.SilkS : F.SilkS, visibility not checked

## T-157 [S2] Pad/text Rotation field silently rejects 0° and negative angles (can't rotate back to 0); 360 stored un-normalised

- Area designer.pcb · category bug · estimate XS · findings Q4-033
- Summary: 0 is discarded without any message; the field snaps back to 45 and no command is sent. -90 is also rejected. 360 is accepted and persisted as rotationDeg 360. The same NumericField guard (n > 0) applies to every inspector number, so any legitimately-zero value (rotation, and position once X/Y become editable) is impossible.
- Root cause: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:71` — commit(): requires n > 0
- Proposed fix: Rotation accepts 0 and negatives, normalises to [0,360). — Detail: Make the positivity check opt-in (e.g. prop positive?: boolean used only for sizes/drill); for rotation normalise ((v % 360) + 360) % 360; show an inline invalid state instead of silently reverting.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/162-pad-rot-zero-rejected.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/036-rot-zero-rejected.png
- Q4-033 repro: QA-q4-board → PCB → select the free pad (or an overlay text) → Properties → Rotation: type 45, Enter → rotationDeg 45 (rev 33) → Type 0, Enter → Type 360, Enter
  - expected: 0 (and negative angles, normalised to 0–359) accepted
  - actual: 0 is discarded without any message; the field snaps back to 45 and no command is sent. -90 is also rejected. 360 is accepted and persisted as rotationDeg 360. The same NumericField guard (n > 0) applies to every inspector number, so any legitimately-zero value (rotation, and position once X/Y become editable) is impossible.
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:71` commit(): requires n > 0
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:236` pad Rotation uses NumericField
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:344` text Rotation uses NumericField

## T-158 [S2] Layer solo state leaks across design tabs; exiting it writes the other design's layer visibility into the current design

- Area designer.pcb · category data · estimate XS · findings Q4-049
- Summary: Dual LED Blinker shows a SOLO badge it never had. Exiting it replaced Dual LED Blinker's visibleLayers [B.Cu, Drill, Edge.Cuts, F.Cu, In1.Cu, In2.Cu, Metadata] with QA-q4-board's pre-solo snapshot [B.Cu, Drill, Edge.Cuts, F.Cu, F.SilkS, Metadata] and persisted it (rev 518 → 520). The global zustand store keeps soloLayer/preSoloVisible/preSoloActive/selectionFilter when hydrateFromProjection switches designId.
- Root cause: `src/modules/designer/frontend/pcb/pcb-view-store.ts:219` — hydrateFromProjection sets designId/viewState/layers but never resets soloLayer/preSoloVisible/preSoloActive
- Proposed fix: Layer solo state keyed by design id; exiting restores that design's visibility only. — Detail: In pcb-view-store hydrateFromProjection (pcb-view-store.ts:219), when `designId !== get().designId` reset soloLayer/preSoloVisible/preSoloActive (and selectionFilterPanelOpen) and flush or drop pendingPatch for the previous design before switching.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/light/022-alt-solo-toast.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/light/001-alt-solo-qa.png
- Q4-049 repro: Open two designs as tabs: QA-q4-board and Dual LED Blinker → On QA-q4-board PCB, Alt+click 'Bottom Copper' in Layers (row shows SOLO; see also Q4-011 conflict) → Switch to the Dual LED Blinker tab → PCB: its Bottom Copper row also shows 'SOLO' → Alt+click that row to exit solo; read GET /projection/pcb board.visibleLayers for both designs
  - expected: Solo / selection-filter UI state is per design (reset on design switch); exiting solo only restores that design's own snapshot
  - actual: Dual LED Blinker shows a SOLO badge it never had. Exiting it replaced Dual LED Blinker's visibleLayers [B.Cu, Drill, Edge.Cuts, F.Cu, In1.Cu, In2.Cu, Metadata] with QA-q4-board's pre-solo snapshot [B.Cu, Drill, Edge.Cuts, F.Cu, F.SilkS, Metadata] and persisted it (rev 518 → 520). The global zustand store keeps soloLayer/preSoloVisible/preSoloActive/selectionFilter when hydrateFromProjection switches designId.
  - code: `src/modules/designer/frontend/pcb/pcb-view-store.ts:219` hydrateFromProjection sets designId/viewState/layers but never resets soloLayer/preSoloVisible/preSoloActive
  - code: `src/modules/designer/frontend/pcb/pcb-view-store.ts:345` toggleSoloLayer restores preSoloVisible regardless of which design captured it

## T-223 [S2] 'Show in schematic' selects the part but leaves the canvas on an unrelated area; 'PCB' does not frame the part either

- Area designer.bom · category bug · estimate S · findings Q5-005
- **shared** with D1, D2; lead: D1
- Summary: Schematic opens with R4 (or R2,R5,R6,R7,R8 for the grouped line) selected in Outline/Properties, but the canvas sits at 80% on D1/GND/+5V; the selected parts are not on screen. The frameToBoundsMm call in requestAnimationFrame runs before the freshly mounted schematic canvas restores its viewport, so it is lost. The PCB button selects R3 but keeps the whole-board view (parts are tiny and overlapping), no zoom-to-sel…
- Root cause: `src/modules/designer/frontend/Space.tsx:866` — frameToBoundsMm in a single rAF right after setActiveView — lost on the fresh canvas mount
- Proposed fix: Cross-probe 'Show in schematic'/'PCB' selects AND frames the part (zoom-to-selection) in target view. — Detail: Pass the frame request through the selectionRequest (like pcbSelectionRequest) and let SchematicCanvas/PcbCanvas frame the selection after their projection+viewport are ready.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q5/dark/012-bom-show-in-schematic.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq5/dark/004-schem-fit.png
- Q5-005 repro: Open 'LED Indicators 5V' → Schem → Fit schematic → Go to BOM, click line R4 (at 24,40 mm) → Click 'Show in schematic' → Back to BOM, click R3, click 'PCB'
  - expected: View switches and zooms/pans to the selected part(s), which are highlighted.
  - actual: Schematic opens with R4 (or R2,R5,R6,R7,R8 for the grouped line) selected in Outline/Properties, but the canvas sits at 80% on D1/GND/+5V; the selected parts are not on screen. The frameToBoundsMm call in requestAnimationFrame runs before the freshly mounted schematic canvas restores its viewport, so it is lost. The PCB button selects R3 but keeps the whole-board view (parts are tiny and overlapping), no zoom-to-selection.
  - code: `src/modules/designer/frontend/Space.tsx:866` frameToBoundsMm in a single rAF right after setActiveView — lost on the fresh canvas mount
  - code: `src/modules/designer/frontend/Space.tsx:892` handleBomShowPcb only sets pcbSelectionRequest
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:1066` selectionRequest effect selects but never frames

## T-103 [S3] Unconnected pins shown as auto nets; schematic vs PCB net counts disagree (0 vs 4, 60 vs 353)

- Area designer.schematic · category consistency · estimate S · findings F1C-008, F1B-010
- **shared** with D2; lead: D2
- Summary: The inspector shows synthetic net names for floating pins, and the two summaries disagree (0 vs 4) for the same design. | Also covers: F1B-010: Net count disagrees between views: schematic Summary 'Nets 60' vs PCB Board Summary 'Nets…
- Root cause: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:60` — Sheet summary counts only nets with wires/labels/primitives (excludes the 1-pin nets the projection emits)
- Proposed fix: Single-pin nets are 'unconnected' (not Net_N); schematic and PCB summaries count nets with ≥2 pins the same way. — Detail: Pick one definition of a net for the summaries. PcbBoardPanel.tsx:499 should count only nets with 2+ connected items (the same predicate as SelectionInspector.tsx:60-70), or both should show 'Nets 3 (+10 unconnected pins)'. In PartInspectorPanel's Pins table (:666), render '—' / 'unconnected' for nets whose pinIds.length === 1 and that have no wires, labels or primitives, instead of the regenerated Net_<n>.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1c/dark/011-drop-design-after-source-removed.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1c/dark/013-schematic-summary-nets-0.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/021-reopen.png
- F1C-008 repro: Stack B, new design QA-f1c-drop, place an LED and a Resistor with no wires → Schem: the Properties dock with nothing selected shows Summary 'Nets 0' → Select R1: the Pins table lists '1 Net_4' and '2 Net_3' → PCB tab: Board panel Summary reads 'Nets 4'
  - expected: An unconnected pin shows 'unconnected' or '—'. Net counts agree between views. Either both count only real nets, or both label the singleton nets as such.
  - actual: The inspector shows synthetic net names for floating pins, and the two summaries disagree (0 vs 4) for the same design.
  - code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:60` Sheet summary counts only nets with wires/labels/primitives (excludes the 1-pin nets the projection emits)
  - code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:499` Board summary counts Object.keys(projection.netNames), which includes every singleton net
  - code: `src/modules/designer/backend/projection-world.ts:857` unconnected pins get regenerated Net_<n> names
  - code: `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:666` Pins table 'Name · net' renders the synthetic Net_<n> for floating pins
- F1B-010 repro: Open QA-f1b-stress (150 parts, 60 wires) → Schematic, nothing selected → Properties Summary: Nets → Switch to PCB, nothing selected → Board panel Summary: Nets → Also open Design rules → Net assignments / length group chips
  - expected: One definition of 'net' across the app (nets with ≥2 connections, like KiCad's net count); the same number in both summaries; auto single-pin nets hidden from net pickers.
  - actual: Schematic Summary shows Nets 60 (filters out auto 1-pin nets), PCB Board Summary shows Nets 353 (Object.keys(projection.netNames)). The 293 single-pin 'Net_n' entries also flood the Outline Nets tab numbering (Net_187…Net_335), the Design-rules Net assignments list (353 selects) and length-group chips (353). Dual LED Blinker shows 13 vs 13 only because every pin there is wired.
  - code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:499` Nets = Object.keys(projection.netNames).length
  - code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:61` schematic netCount excludes auto 1-pin nets

## T-160 [S3] If the PCB projection fails to load, PCB shows only grey 'PCB projection unavailable' with no reason or retry, and the workspace error is never rendered

- Area designer.pcb · category error-handling · estimate XS · findings F1A-012 · known K09
- Summary: Unlike K09 it doesn't spin forever: it switches to plain 13 px grey text 'PCB projection unavailable' in the middle of the canvas. There is no reason, no Retry, and no role=alert. The Layers section is empty, 'Components 0' is shown, the PCB toolbar is gone, and the Properties dock is blank. usePcbWorkspace stores the failure message in workspace.error, but the alert toast only renders inside the projection branch,…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6189` — !workspace.projection -> 'Loading PCB...' / 'PCB projection unavailable' text only
- Proposed fix: PCB projection failure state shows reason + Retry. — Detail: Render a kit error state when !projection && error: 'Couldn't load the PCB — <reason>', a Retry button calling workspace.refresh(), role=alert. Retry automatically on window focus and 'online' events.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1a/dark/041-k41-pcb-view-proj500.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1a/dark/140-pcb-proj500.png
- F1A-012 repro: route '**/api/modules/designer/designs/*/projection/pcb*' → 500 → Open QA-f1a-board → PCB (or click a violation in the DRC view) → unroute and wait 10 s without leaving the view
  - expected: An error state with the reason and a Retry button, recovering automatically or on Retry.
  - actual: Unlike K09 it doesn't spin forever: it switches to plain 13 px grey text 'PCB projection unavailable' in the middle of the canvas. There is no reason, no Retry, and no role=alert. The Layers section is empty, 'Components 0' is shown, the PCB toolbar is gone, and the Properties dock is blank. usePcbWorkspace stores the failure message in workspace.error, but the alert toast only renders inside the projection branch, so it never appears. After unroute nothing retries until the user leaves PCB and comes back (Schem → PCB recovers).
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6189` !workspace.projection -> 'Loading PCB...' / 'PCB projection unavailable' text only
  - code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:136` refresh() sets error, but the role=alert surface is gated on projection

## T-166 [S3] DRC marker hover tooltip: long net names overflow the 280 px card (no wrap, no viewport clamp), and in light theme its 10 px message text is 2.8:1 on a blue-tinted translucent card

- Area designer.pcb · category visual · estimate XS · findings F1B-021
- Summary: The card is max-w-[280px] (x≈766–1046) but the anchor line 'VERY_LONG_NET_LABEL_FOR_QA_VERY_LONG…' and the quoted net in the message run to x≈1302, outside the card background, over the canvas/inspector boundary (1140) and onto the Properties panel. The card is placed at cursor+14 px with no viewport clamping, so near the right edge it runs off-screen. Light theme (/Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/light/010-drc-tooltip.png): the card is b…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6410` — tooltip div: max-w-[280px], no break-words/break-all, fixed left=cursor+14 without clamping
- Proposed fix: Tooltip wraps/clamps to viewport; message text ≥4.5:1 in light. — Detail: Add 'break-all' (or [overflow-wrap:anywhere]) to the anchors and message rows, and clamp left/top against window.innerWidth/innerHeight minus the measured card size (flip to the left of the cursor near the right edge). Use an opaque bg-surface-raised (drop /95 and backdrop-blur) and text-text-secondary for the message so it meets 4.5:1 in light.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/086-overlap-picker.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/018-drc-tooltip-overflow.png
- F1B-021 repro: QA-f1b-long has a net labelled VERY_LONG_NET_LABEL_FOR_QA_… (80 chars) and a DRC run with an UNCONNECTED_NET on it → PCB view, hover the Unconnected-net marker near the stacked parts
  - expected: Tooltip text wraps (break-all for identifiers) or truncates with an ellipsis inside the card; the card is clamped to the viewport.
  - actual: The card is max-w-[280px] (x≈766–1046) but the anchor line 'VERY_LONG_NET_LABEL_FOR_QA_VERY_LONG…' and the quoted net in the message run to x≈1302, outside the card background, over the canvas/inspector boundary (1140) and onto the Properties panel. The card is placed at cursor+14 px with no viewport clamping, so near the right edge it runs off-screen. Light theme (/Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/light/010-drc-tooltip.png): the card is bg-surface-raised/95 + backdrop-blur, so over the B.Cu pour it renders #d9dce5 (blue cast, nearest --status-info-soft) instead of --surface-raised #e2e2e5; the 10 px layer line and message (#818188 / #85858d) reach only 2.82:1 contrast (dark theme: 4.27:1).
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6410` tooltip div: max-w-[280px], no break-words/break-all, fixed left=cursor+14 without clamping

## T-167 [S3] Tune HUD: key readouts in low-contrast grey (2–2.5:1) and wrap mid-value

- Area designer.pcb · category a11y · estimate XS · findings F1B-022, F1B-034
- Summary: Dark: '≈16.32 / 30.00 mm' is --status-warning (#d9a441, fine) but '13.68 mm short' is #515156 (--text-disabled #55555a) on the #151517 HUD = 2.46:1. Light: the delta span uses --text-disabled #a8a8ae on #ebebed ≈ 2.0:1, and with no target the length '25.06 mm' plus 'set target…' are --text-tertiary #7f7f86 on #ebebed = 3.34:1 at 11 px. (The hint row itself is OK only by accident: PcbParamRow is given both 'text-text… | Also covers: F1B-034: Tune HUD wraps every readout mid-value when the row is full ('≈16.32 /' ⏎ '30.00 mm', 'A…
- Root cause: `src/modules/designer/frontend/pcb/TuneHud.tsx:90` — delta span className='text-text-disabled'
- Proposed fix: Tune HUD readouts in text-strong/status tokens; no mid-value wraps (nowrap + truncate). — Detail: TuneHud.tsx: render the delta in the same BAND_CLASS as the length (or text-text-secondary) and the no-target length in text-text; merge PcbParamRow classes with tailwind-merge (or drop its default colour) so callers can override deterministically.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/052-tune-hud.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/022-tune-hud.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/115-tune-long-group-name.png
- F1B-022 repro: QA-f1b-stress → PCB (length group 'Group 1', absolute 30 mm) → press U → Click a routed trace on a group net (dark shot 052: Net_43) and on a non-group net (light shot 017: Net_131) → Read the HUD row: net · length · delta
  - expected: The live length and its distance to target — the whole point of the Tune tool — are rendered at ≥4.5:1 (text-text or the band status colour); only the inapplicable 'Enter apply' hint is dimmed.
  - actual: Dark: '≈16.32 / 30.00 mm' is --status-warning (#d9a441, fine) but '13.68 mm short' is #515156 (--text-disabled #55555a) on the #151517 HUD = 2.46:1. Light: the delta span uses --text-disabled #a8a8ae on #ebebed ≈ 2.0:1, and with no target the length '25.06 mm' plus 'set target…' are --text-tertiary #7f7f86 on #ebebed = 3.34:1 at 11 px. (The hint row itself is OK only by accident: PcbParamRow is given both 'text-text-secondary' and 'text-text-disabled' and secondary wins in CSS order.)
  - code: `src/modules/designer/frontend/pcb/TuneHud.tsx:90` delta span className='text-text-disabled'
  - code: `src/modules/designer/frontend/pcb/TuneHud.tsx:83` length falls back to text-text-tertiary without a band
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:808` PcbParamRow hard-codes text-text-secondary, so a passed text-* class conflicts
- F1B-034 repro: QA-f1b-stress: rename length group 'Group 1' to a 60-char name (USB_HS_DIFFERENTIAL_PAIR_LENGTH_MATCH_GROUP_FOR_QA_LONG_NAME; via Design rules or pcb_set_design_rules) → PCB → U → click the Net_43 trace (member of the group) → Resize to 1100×720
  - expected: One-line HUD: numeric readouts never break; the group name truncates with ellipsis (full name in title); the hint collapses first.
  - actual: At 1440 the 60-char name fits on one line only because the canvas is wide. At 1100×720 the HUD row is 56 px (scrollWidth 1020 in a 1020 px bar, white-space: normal): '≈16.32 / 30.00 mm', '13.68 mm short', 'target: '…'', 'A 2.00 · pitch 1.00' and the hint each wrap independently into ragged two-line cells. Without a target (Net_334) the row fits on one line at 1100.
  - code: `src/modules/designer/frontend/pcb/TuneHud.tsx:132` target: '${model.groupName}' rendered untruncated

## T-168 [S3] 'Remove redundant pour traces' is hidden for zones drawn with Z (only shown while a board zone is enabled) and gives no feedback — it returned ok with 0 changes and nothing on screen

- Area designer.pcb · category bug · estimate S · findings F2A-005
- Summary: Button rendered only when hasEnabledBoardZone(); with the normal Z workflow it never appears. When clicked: POST pcb_cleanup_pour_traces → {ok:true, revision:116} (unchanged), the B.Cu GND trace stays, no toast/notice — indistinguishable from a broken button.
- Root cause: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:625` — button rendered only when hasEnabledBoardZone(boardZones)
- Proposed fix: Show 'Remove redundant pour traces' for any zone; toast with count removed (or 'nothing to remove'). — Detail: Gate on any enabled zone; return the removed-trace count from the executor and show it in the PCB notice strip.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/067-gnd-bottom-trace.png
- F2A-005 repro: QA-f2a-golden: B.Cu GND polygon zone drawn with Z; route a GND trace on B.Cu under it (J1.2 → C2.2) → Layers panel: no 'Remove redundant pour traces' button → Enable the board zone via the droplet (see F2A-004) → button appears → click it
  - expected: The cleanup is offered whenever any enabled zone exists (the backend already evaluates polygon zones), and reports the outcome ('Removed 2 traces' / 'No redundant traces found').
  - actual: Button rendered only when hasEnabledBoardZone(); with the normal Z workflow it never appears. When clicked: POST pcb_cleanup_pour_traces → {ok:true, revision:116} (unchanged), the B.Cu GND trace stays, no toast/notice — indistinguishable from a broken button.
  - code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:625` button rendered only when hasEnabledBoardZone(boardZones)
  - code: `src/modules/designer/backend/command-executor.ts:1319` pcb_cleanup_pour_traces already evaluates EVERY effective zone incl. polygon zones (contract §9/S5)
  - code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:472` cleanupPourTraces ignores the result; no count/notice

## T-169 [S3] No 'routing complete' indicator: nothing shows how many connections are still unrouted — users must hunt for faint dashed ratsnest lines or run DRC

- Area designer.pcb · category stub · estimate S · findings F2A-017
- Summary: No UI element exposes the ratsnest count (projection.ratsnest has it). With 1 airwire left the status bar still read '0 DRC' until a manual DRC run produced 'Net "Net_4" is not fully routed (1 airwire remaining)'. The only live cue is a thin dashed line that is easy to miss under DRC markers (Q4-043) and hidden when Ratsnest is toggled off (Shift+B).
- Root cause: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:494` — Board 'Summary' shows only Components and Nets (netNames count); PLAN D8 asked for 'nets/unrouted from workspace if available' — projection.ratsnest is available
- Proposed fix: Add 'Unrouted N' to Board Summary + status bar (click frames next airwire); success state at 0. — Detail: Add 'Unrouted N' to the PCB status bar and Board Summary from projection.ratsnest.length (clickable → frame next airwire); show a success state at 0.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/051-routed.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2a/dark/020-golden-pcb.png
- F2A-017 repro: QA-f2a-golden PCB with 1 unrouted connection (Net_4 deleted on purpose) or 4 GND airwires before the pour → Look at the Board Summary (Components 8 · Nets 7), status bar ('0 DRC'), toolbar and Layers panel
  - expected: A persistent count like KiCad's 'Unrouted: N' (status bar or Board Summary), turning into a clear 'All nets routed' state; clicking it cycles/zooms to the next airwire.
  - actual: No UI element exposes the ratsnest count (projection.ratsnest has it). With 1 airwire left the status bar still read '0 DRC' until a manual DRC run produced 'Net "Net_4" is not fully routed (1 airwire remaining)'. The only live cue is a thin dashed line that is easy to miss under DRC markers (Q4-043) and hidden when Ratsnest is toggled off (Shift+B).
  - code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:494` Board 'Summary' shows only Components and Nets (netNames count); PLAN D8 asked for 'nets/unrouted from workspace if available' — projection.ratsnest is available

## T-170 [S3] Traces on the non-active copper layer can't be clicked, silently — and the route tool leaves the active layer on B.Cu after a via, so the next click on a top trace selects nothing

- Area designer.pcb · category bug · estimate S · findings F2A-018
- Summary: First click: 'No selection', no hover/feedback; after pressing 1 the same click gives 'Trace · Net_4'. Nothing indicates why the click failed; the layer switch done by V is easy to miss (only the small active-layer chip changes).
- Root cause: `src/modules/designer/frontend/pcb/pcb-hit.ts:177` — hitTrace: `if (trace.layer !== activeLayer) continue;`
- Proposed fix: Allow selecting traces on non-active layers (or auto-switch layer on click); restore active layer after via placement per preference. — Detail: Hit-test all visible copper layers, preferring the active one; or show a transient notice when a click lands on copper of another layer.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/052-trace-selected.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2a/dark/029-click-top-trace-bcu-active.png
- F2A-018 repro: Route a trace, press V to drop to B.Cu, finish (active layer is now Bottom Copper) → Esc, click any top-layer (F.Cu) trace → Press 1 (Top) and click it again
  - expected: Clicking visible copper selects it (active layer only as a tie-breaker, as in KiCad), or a hint says 'Switch to Top Copper to select this trace'.
  - actual: First click: 'No selection', no hover/feedback; after pressing 1 the same click gives 'Trace · Net_4'. Nothing indicates why the click failed; the layer switch done by V is easy to miss (only the small active-layer chip changes).
  - code: `src/modules/designer/frontend/pcb/pcb-hit.ts:177` hitTrace: `if (trace.layer !== activeLayer) continue;`
  - code: `src/modules/designer/frontend/pcb/pcb-hit.ts:461` unified hit-test: traces also filtered to the active layer

## T-172 [S3] Layer tab strip overflows (4+ layers at 1440, 2 layers at 1100); canvas squeezed to 458 px at 1100

- Area designer.pcb · category visual · estimate S · findings F2B-009, Q4-041
- **Approved scope:** Approved proposal P2 (narrow-window layout) applies.
- Summary: The two Mid-Layer tabs add 170 px: tablist scrollWidth 923 vs clientWidth 798 at 1440, so 'Drill Holes' is clipped mid-word at the canvas edge (1139 px) and the PcbSideModeButton ('Viewing Top', 1174–1258 px) lives inside the same overflow-x scroller with a hidden scrollbar → invisible and mouse-unreachable unless the user discovers horizontal wheel-scrolling. On 2-layer boards the same strip fits and shows 'Viewing… | Also covers: Q4-041: At the 1100×720 minimum window the PCB canvas is squeezed to 458 px; layer tab strip over…
- Root cause: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:83` — overflow-x-auto with scrollbarWidth none; side-mode button rendered inside the scroller after flex-1 spacer
- Proposed fix: Layer tab strip overflow menu/chevrons; flip button pinned; refit on canvas resize. Narrow-window dock collapse = proposal P2. — Detail: Render the side-mode button outside the scrolling tablist (sibling, shrink-0); add edge fades + chevron buttons (or a '…' overflow menu) when scrollWidth > clientWidth; consider short labels (In1/In2) for inner layers.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/063-strip-2L-vs-6L-1440.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/dark/002-blind-pcb-open.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/light/012-1100-pcb.png
- F2B-009 repro: Stack B, open QA-f2b-4L or QA-f2b-6L → PCB at 1440×900 (right dock open, default sidebar) → Look at the bottom layer tab strip; compare with QA-f2b-2L → Resize to 1100×720
  - expected: All tabs and the 'Viewing Top' side toggle remain reachable: the toggle pinned outside the scroller, and an overflow chevron/menu (or compact labels 'F.Cu / In1 / In2 / B.Cu') when tabs don't fit.
  - actual: The two Mid-Layer tabs add 170 px: tablist scrollWidth 923 vs clientWidth 798 at 1440, so 'Drill Holes' is clipped mid-word at the canvas edge (1139 px) and the PcbSideModeButton ('Viewing Top', 1174–1258 px) lives inside the same overflow-x scroller with a hidden scrollbar → invisible and mouse-unreachable unless the user discovers horizontal wheel-scrolling. On 2-layer boards the same strip fits and shows 'Viewing Top' at the right. At 1100×720 clientWidth is 458: everything after 'Top Overlay' is hidden (Q4-041 reported the 2-layer 1100 case only).
  - code: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:83` overflow-x-auto with scrollbarWidth none; side-mode button rendered inside the scroller after flex-1 spacer
- Q4-041 repro: Dual LED Blinker → PCB with the right dock open (DRC or Properties) at 1440×900, board fitted → Resize the window to 1100×720
  - expected: Canvas keeps the majority of the width (side panels shrink to their minimums or the dock auto-collapses), layer strip collapses into an overflow menu, camera re-fits on resize
  - actual: Left sidebar 260 px + dock 300 px leave a 458×612 canvas (42% of the window); the board stays at the old zoom and is cropped on both sides; the layer tab strip (sw 755 / cw 458) silently scrolls horizontally, cutting 'Top Court…' mid-word with no fade/chevron; Components VALUE column truncated.
  - code: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:1` overflow-x-auto strip without overflow affordance

## T-173 [S3] At 1100×720 on a 4-layer board the route parameter row pushes the live route status (length, clear/N conflicts, warnings) off-screen; 'Standard 4L' wraps onto two lines

- Area designer.pcb · category visual · estimate S · findings F2B-010
- Summary: With the 4L-only 'In1↔In2' layer-pair select added, the Route status region spans 946–1454 px in a 1100 px window: 'via 0.60/0.30', length, 'clear'/'N conflicts' and '1 warning' are all beyond the viewport (only 'Net GND 0.20 mm · netc' visible). The 'Standard 4L' via-preset chip wraps to two lines at both 1100 and 1440 while routing; at 1440 the status also runs to the window edge ('2 conflicts 8…' cut). Same famil…
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:892` — LayerPairSelect added for layerCount ≥ 4 into the same non-wrapping row
- Proposed fix: Route param row: live status pinned right, presets truncate before status. — Detail: Give the route row a two-zone layout: fixed parameter chips (whitespace-nowrap) + a status zone that truncates low-priority parts (netclass text, via summary) first and always keeps conflicts/clear visible; or mirror conflicts into the status bar.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/065-4L-1100-routing.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/dark/011-4L-routing-1100.png
- F2B-010 repro: Stack B, QA-f2b-4L → PCB, window 1100×720 → Zoom to fit → R, click the GND via at (146.0, 140.0) to start routing, move the cursor
  - expected: The row keeps the safety-relevant status (conflicts/'clear') visible — lower-priority chips collapse or the status moves to its own line/status bar — and chips never wrap internally.
  - actual: With the 4L-only 'In1↔In2' layer-pair select added, the Route status region spans 946–1454 px in a 1100 px window: 'via 0.60/0.30', length, 'clear'/'N conflicts' and '1 warning' are all beyond the viewport (only 'Net GND 0.20 mm · netc' visible). The 'Standard 4L' via-preset chip wraps to two lines at both 1100 and 1440 while routing; at 1440 the status also runs to the window edge ('2 conflicts 8…' cut). Same family as Q4-042 (2-layer, 'Standard 2L').
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:892` LayerPairSelect added for layerCount ≥ 4 into the same non-wrapping row

## T-174 [S3] No trace/via inspector: selecting a via or trace shows only 'Contents · Vias 1' — a blind via (F.Cu–In1.Cu) looks and inspects exactly like a through via; type, span, size, net and width are nowhere

- Area designer.pcb · category stub · estimate M · findings F2B-011
- **shared** with DB; lead: DB
- **Approved scope:** Approved proposal P4: trace/via inspector (net, width, layer span, via type) with backend edit commands.
- Summary: The blind via renders identically to a through via (same green-yellow ring, black drill). Selecting it gives the generic 'Selection · 1 item selected · CONTENTS Vias 1' panel and status 'Via'; selecting a trace gives 'Traces 1' / 'Trace'. There is no way to learn the via type, span, diameter/drill or net (nor a trace's net/width/layer) from the UI; the Selection filter even describes vias as 'Through-hole vias'. The…
- Root cause: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:358` — traces/vias always fall through to the counts-only branch
- Proposed fix: Trace/via inspector (net, width, layer span, via type) — needs backend edit commands. — Detail: Add ViaPanel and TracePanel to PcbPropertiesPanel's single-selection switch (read-only first: type, span, Ø/drill, net, class; width, layer, length) with edit via existing commands; render non-through vias with a split two-colour annulus and a type badge at zoom; rename the filter description to 'Vias'.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/073-blind-vs-through.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/dark/014-blind-via-zoom.png
- F2B-011 repro: Stack B, QA-f2b-blind (KiCad 4-layer import with one '(via blind (layers F.Cu In1.Cu))' at 156.75, 132.5) → PCB, zoom to D1 → Compare the blind via with the through via at 158.75, 141.25 → Click the via (a click hits the trace first, Q4-016) → press F, keep only 'Vias', click it again → Read the Properties dock and status bar; also select any trace
  - expected: Like KiCad/Altium: a via inspector (type through/blind/buried/micro, layer span, Ø/drill, net, tenting) and a trace inspector (net, layer, width, length), both editable; blind/buried vias drawn distinctly (e.g. split ring coloured by the two span layers).
  - actual: The blind via renders identically to a through via (same green-yellow ring, black drill). Selecting it gives the generic 'Selection · 1 item selected · CONTENTS Vias 1' panel and status 'Via'; selecting a trace gives 'Traces 1' / 'Trace'. There is no way to learn the via type, span, diameter/drill or net (nor a trace's net/width/layer) from the UI; the Selection filter even describes vias as 'Through-hole vias'. The export 422 lists the via by id only, so a user cannot verify which via is blind or fix it (no 'convert to through' action).
  - code: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:358` traces/vias always fall through to the counts-only branch
  - code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:29` hint 'Through-hole vias'
  - code: `src/sdks/designer/types.ts:2287` no trace/via property-update command exists (INVALID_PCB_TRACE/VIA only for add)

## T-177 [S3] Cloud layout entry points float over the canvas with shadows at 25 px, and the Auto-route/Auto-place panels cover the dock, layer strip, status bar and their own buttons; naming differs (Route Board… → 'Auto-route')

- Area designer.pcb · category visual · estimate S · findings Q10-014
- **Approved scope:** Approved proposal P3: move cloud layout entry points into a PCB toolbar "Layout ▾" dropdown with kit dialogs.
- Summary: Buttons are 25 px tall with Tailwind shadow-sm (box-shadow 0 1px 3px rgba(0,0,0,.1)) floating over the board, the only floating canvas buttons in the app. The 'Auto-route' panel (fixed bottom-4 right-4, 360–420 px) at 1100×720 spans x 664–1084, y 534–704: it hides the Properties dock bottom, the layer tab strip, half of 'Route Board…' and the status bar's DRC count/selection. Title mismatch: button 'Route Board…' op…
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6207` — absolute bottom-12 right-3 floating buttons, py-1 shadow-sm
- Proposed fix: Flatten floating layout buttons (no shadow, kit size); anchor route/place panels inside canvas bounds. Toolbar relocation = proposal P3. — Detail: Move the three actions into PcbTopToolbar as a 'Layout ▾' dropdown (Auto Layout…, Route board…, Auto place…) using kit ToolbarButton; render the route/place panels as kit Dialogs or anchor them inside the canvas area above the layer strip (bottom offset ≥ layer strip + status bar); title them 'Route Board' / 'Auto Place' to match.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q10/dark/021-C1-pcb-autolayout-buttons.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq10/dark/001-pcb-signedout.png
- Q10-014 repro: Stack C1, 'Dual LED Blinker' → PCB → Inspect the bottom-right 'Auto Layout… / Route Board… / Auto Place…' buttons → Click 'Route Board…' (fails fast offline) at 1440×900 and at 1100×720
  - expected: Entry points in the PCB toolbar (or a toolbar 'Layout ▾' menu) at kit height with no drop shadow; result panels docked or modal without covering the status bar / dock; one name per feature.
  - actual: Buttons are 25 px tall with Tailwind shadow-sm (box-shadow 0 1px 3px rgba(0,0,0,.1)) floating over the board, the only floating canvas buttons in the app. The 'Auto-route' panel (fixed bottom-4 right-4, 360–420 px) at 1100×720 spans x 664–1084, y 534–704: it hides the Properties dock bottom, the layer tab strip, half of 'Route Board…' and the status bar's DRC count/selection. Title mismatch: button 'Route Board…' opens 'Auto-route'; 'Auto Place…' opens 'Auto-place'.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6207` absolute bottom-12 right-3 floating buttons, py-1 shadow-sm
  - code: `src/modules/designer/frontend/pcb/PcbAutoplaceDialog.tsx:149` fixed bottom-4 right-4 … shadow-2xl
  - code: `src/modules/designer/frontend/pcb/PcbAutorouteDialog.tsx:259` same fixed placement

## T-178 [S3] Ctrl+H activates the Hole tool instead of cycling the layer display mode

- Area designer.pcb · category keyboard · estimate XS · findings Q4-002
- Summary: The Add button switches to 'Hole' (hole placement tool armed); the Display mode group stays at Normal (aria-pressed Normal:true). The Ctrl+H handler is unreachable because the plain-H hole handler runs first and has no ctrl/meta guard.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4391` — H → hole tool, no !ctrlKey/!metaKey guard, returns early
- Proposed fix: Plain-H branch ignores Ctrl/Meta so Ctrl+H cycles display mode. — Detail: In PcbCanvas onKey (PcbCanvas.tsx:4390) add `!event.ctrlKey && !event.metaKey && !event.altKey` to the plain H branch (and to P/T/M at :4478/:4490/:4500, which lack it too) so the Ctrl/⌘+H display-mode cycle at :4931 is reachable.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/006-ctrl-h.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/002-ctrl-h.png
- Q4-002 repro: Open 'Dual LED Blinker' → PCB view, nothing selected, Select tool → Hover the 'Normal/Dim/Hide' display-mode buttons: tooltip says 'Display mode: … (Ctrl+H)' → Press Ctrl+H over the canvas
  - expected: Inactive-layer display mode cycles Normal → Dim → Hide (KiCad Ctrl+H) and no tool changes
  - actual: The Add button switches to 'Hole' (hole placement tool armed); the Display mode group stays at Normal (aria-pressed Normal:true). The Ctrl+H handler is unreachable because the plain-H hole handler runs first and has no ctrl/meta guard.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4391` H → hole tool, no !ctrlKey/!metaKey guard, returns early
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4932` Ctrl+H display-mode cycle never reached
  - code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:647` tooltip advertises Ctrl+H

## T-179 [S3] Status-bar hint shows 'Click to select…' while Hole/Pad/Text/Zone/Keepout/Tune/Cutout tools are armed

- Area designer.pcb · category copy · estimate S · findings Q4-003
- Summary: Hint stays 'Click to select · Shift+click to add · drag to box-select' for hole, pad, text, zone, keepout, zone-cutout and tune tools (only route/measure/board-shape have hints). Zone/keepout/text selections also summarise as a generic '1 selected'. Tune puts its hint in a separate floating status instead.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5474` — statusHint only handles route/measure/boardShape/placement
- Proposed fix: Status hint per active tool (Hole/Pad/Text/Zone/Keepout/Tune/Cutout). — Detail: Add HINT_* strings for hole/pad/text/zone/keepout/zoneHole/tune/bundle/comment tool modes in statusHint, and zone/keepout cases in statusSelectionSummary ('Zone · GND · F.Cu').
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/007-zone-mode.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/002-ctrl-h.png
- Q4-003 repro: PCB view, nothing selected → Press H (or P, T, Z, K, U, Shift+Z with a zone selected) → Read the status-bar hint
  - expected: Tool-specific hint, e.g. 'Click on the board to place a 3.2 mm hole · Esc exit', 'Click to place vertices · Enter close · Esc cancel'
  - actual: Hint stays 'Click to select · Shift+click to add · drag to box-select' for hole, pad, text, zone, keepout, zone-cutout and tune tools (only route/measure/board-shape have hints). Zone/keepout/text selections also summarise as a generic '1 selected'. Tune puts its hint in a separate floating status instead.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5474` statusHint only handles route/measure/boardShape/placement
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5534` zones/keepouts fall through to '1 selected'

## T-180 [S3] Route refusal notices show raw DRC codes (NET_SHORT_CIRCUIT, COPPER_OFF_BOARD…) and a developer tooltip

- Area designer.pcb · category copy · estimate XS · findings Q4-005
- Summary: 'Via blocked: NET_SHORT_CIRCUIT' and 'Via blocked: COPPER_OFF_BOARD, COPPER_TO_BOARD_EDGE'; warning chip tooltip reads 'Reported by DRC but never blocking (contract 07 §6)'. 'Commit blocked: 4 DRC conflicts' also stays stale after the live count drops to 3 and never says which items conflict.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:549` — violationCodeList returns raw DRC codes (used by Via blocked / Commit rejected / Reshape rejected notices)
- Proposed fix: Map DRC codes to drc-labels in refusal notices; drop developer tooltip. — Detail: Map codes through drc-labels (DRC_LABELS[code] ?? code) in violationCodeList; rewrite the RouteHud warning title; recompute the commit-blocked notice from the live conflict count.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/028-route-via.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/021-via-blocked2.png
- Q4-005 repro: PCB → R, click J1 pin, place a corner → Hover over copper of another net (or near the board edge) and press V → Read the notice row; hover the '4 warnings' text in the route status
  - expected: Human wording from drc-labels ('Via blocked: short circuit with R4.1 (Net_5)', 'too close to board edge'); tooltip 'Warnings are reported by DRC but do not block the commit'
  - actual: 'Via blocked: NET_SHORT_CIRCUIT' and 'Via blocked: COPPER_OFF_BOARD, COPPER_TO_BOARD_EDGE'; warning chip tooltip reads 'Reported by DRC but never blocking (contract 07 §6)'. 'Commit blocked: 4 DRC conflicts' also stays stale after the live count drops to 3 and never says which items conflict.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:549` violationCodeList returns raw DRC codes (used by Via blocked / Commit rejected / Reshape rejected notices)
  - code: `src/modules/designer/frontend/pcb/RouteHud.tsx:181` title 'Reported by DRC but never blocking (contract 07 §6)'
  - code: `src/modules/designer/frontend/pcb/drc/drc-labels.ts:20` human labels available

## T-182 [S3] PCB toolbar dropdowns (Add, View, width, via) have no menu semantics or keyboard support; Esc does not close them

- Area designer.pcb · category a11y · estimate S · findings Q4-007
- Summary: Esc leaves the menu open (Add and View verified), ArrowDown does nothing (focus stays on trigger). Add trigger has no aria-expanded/aria-haspopup, menus are plain divs of buttons, trigger buttons use outline-none so there is no focus ring. (Tooltip copy → Q4-051; Measure/Tune entry points → Q4-035.)
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:139` — useOutsideClose handles mousedown only
- Proposed fix: Toolbar dropdowns (Add/View/width/via) -> kit DropdownMenu (menu semantics, Esc, arrows). — Detail: Reuse the kit Menu/Dropdown (with Esc, arrow roving focus, role=menu) for AddDropdown, ViewToggleDropdown, WidthDropdown, ViaSizeDropdown; add Esc to useOutsideClose; add 'Measure (M)' and 'Tune length (U)' entries to a Tools/Add menu.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/002-add-menu.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/026-add-menu-after-esc.png
- Q4-007 repro: PCB view: click 'Add' (or 'View', or the W width chip while routing) → Press Escape → Press ArrowDown
  - expected: Menu closes on Esc and focus returns to the trigger; arrows move between items; trigger exposes aria-haspopup/aria-expanded; items are role=menuitem(checkbox)
  - actual: Esc leaves the menu open (Add and View verified), ArrowDown does nothing (focus stays on trigger). Add trigger has no aria-expanded/aria-haspopup, menus are plain divs of buttons, trigger buttons use outline-none so there is no focus ring. (Tooltip copy → Q4-051; Measure/Tune entry points → Q4-035.)
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:139` useOutsideClose handles mousedown only
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:481` Add trigger: no aria-haspopup/expanded, outline-none

## T-183 [S3] Via size shown in three different orders/symbols (preset list drill/diameter vs chips Ø diameter ⌀ drill vs status diameter/drill)

- Area designer.pcb · category consistency · estimate XS · findings Q4-009
- Summary: Preset list order is drill/diameter, status is diameter/drill; the two chips differ only by Ø (U+00D8) vs ⌀ (U+2300), visually almost identical — users cannot tell which chip is drill without hovering. 'Net-class default (0.80 mm)' wraps to two lines in the dropdown.
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:231` — ViaSizeDropdown
- Proposed fix: One via notation everywhere: 'Ø0.60 / 0.30 drill' (diameter first). — Detail: Label chips 'Via 0.80' and 'Drill 0.40' (text, not glyphs) and render preset rows as 'Ø0.80 / drill 0.40' matching the status order.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/045-via-preset-dd.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/025-via-preset-dd.png
- Q4-009 repro: Start routing → Open the via preset dropdown: rows read 'Standard 2L 0.40 / 0.80 mm' (drill / diameter) → Compare chips 'Ø 0.80 mm' (diameter) and '⌀ 0.40 mm' (drill) and the status 'via 0.80/0.40' (diameter/drill)
  - expected: One consistent order and explicit labels (e.g. 'Pad 0.80 · Drill 0.40')
  - actual: Preset list order is drill/diameter, status is diameter/drill; the two chips differ only by Ø (U+00D8) vs ⌀ (U+2300), visually almost identical — users cannot tell which chip is drill without hovering. 'Net-class default (0.80 mm)' wraps to two lines in the dropdown.
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:231` ViaSizeDropdown

## T-184 [S3] Flipping to bottom view mirrors about the world origin, pushing the board half off-screen

- Area designer.pcb · category bug · estimate XS · findings Q4-010
- Summary: Board jumps right and is clipped by the dock at x≈1139 (right third of the board invisible); user has to press Fit. The button label is abbreviated 'Viewing Bot'.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2685` — setViewSide without camera compensation
- Proposed fix: Flip view mirrors about board centre, keeping board centred. — Detail: When toggling viewSide, negate camera.position.x (mirror the camera about the scene X axis) so the same world region stays centred; label 'Viewing Bottom'.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/050-bottom-view.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/044-before-flip.png
- Q4-010 repro: PCB view, Zoom to fit (board centred) → Click 'Viewing Top' in the layer strip (or press Shift+F)
  - expected: View mirrors about the current view centre (or re-fits), so the board stays where it was on screen
  - actual: Board jumps right and is clipped by the dock at x≈1139 (right third of the board invisible); user has to press Fit. The button label is abbreviated 'Viewing Bot'.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2685` setViewSide without camera compensation
  - code: `src/modules/designer/frontend/pcb/PcbSideModeButton.tsx:19` 'Viewing Bot' label

## T-185 [S3] Inactive-layer display mode 'Normal' dims other layers to 22% once a layer is focused; 'Normal' and 'Dim' look identical

- Area designer.pcb · category bug · estimate XS · findings Q4-013
- Summary: After any layer focus, Normal renders B.Cu at #0c1d3a (22% opacity) and Dim at #0a172d (16%) — practically indistinguishable, and very different from the initial Normal (#2667dc). Flipped parts on the inactive side are near-black (#000107) and easily lost.
- Root cause: `src/modules/designer/frontend/pcb/pcb-visual-state.ts:30` — mode = hasLayerFocus ? (solo ? 'solo' : 'dim') : 'normal' — displayMode 'normal' maps to 'dim'
- Proposed fix: 'Normal' leaves inactive layers undimmed; 'Dim' dims — distinct. — Detail: Map displayMode 'normal' to visual mode 'normal' (opacity 1, maybe 0.85 for non-active copper) regardless of layer focus; keep 'dim' ~0.35 so the two are distinguishable.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/001-pcb-initial.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/001-pcb.png
- Q4-013 repro: Open design → PCB: bottom traces bright blue (#2667dc) → Click any layer row / layer tab (e.g. 'Bottom Copper' then 'Top Copper') → Display mode still shows 'Normal' pressed; probe a B.Cu trace → Click 'Dim' and probe again
  - expected: 'Normal' renders inactive layers at full strength (as on first open); 'Dim' visibly dims them
  - actual: After any layer focus, Normal renders B.Cu at #0c1d3a (22% opacity) and Dim at #0a172d (16%) — practically indistinguishable, and very different from the initial Normal (#2667dc). Flipped parts on the inactive side are near-black (#000107) and easily lost.
  - code: `src/modules/designer/frontend/pcb/pcb-visual-state.ts:30` mode = hasLayerFocus ? (solo ? 'solo' : 'dim') : 'normal' — displayMode 'normal' maps to 'dim'
  - code: `src/modules/designer/frontend/pcb/pcb-visual-state.ts:45` 0.16 vs 0.22

## T-186 [S3] PCB empty-canvas context menu advertises 'X' for route mode (real key R) and overflows the viewport bottom

- Area designer.pcb · category copy · estimate XS · findings Q4-015 · known K15
- Summary: Item reads 'Enter route mode X' (X does nothing; R is the route hotkey). Menu is 210 px tall at y=720 → bottom 930 > 900 viewport; the last item 'Add comment' is clipped off-screen. The clamp estimates height from ENABLED items × 32 px, but disabled items ('Top layer (F.Cu)', 'Clear selection') also take space. 'Hide ratsnest' shows no ⇧B shortcut.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4150` — shortcut: "X"
- Proposed fix: Context menu shows R for route; viewport clamping via F0b menu fix. — Detail: shortcut 'R' (and '⇧B' for ratsnest); clamp using the rendered menu's getBoundingClientRect in a layout effect (or count all items + separators).
- Depends on: ['T-024']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/079-ctx-empty.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/027-ctx-empty.png
- Q4-015 repro: PCB view, Select tool, nothing selected → Right-click empty canvas near the bottom (e.g. 700,760 at 1440x900)
  - expected: 'Enter route mode  R'; menu fully inside the viewport
  - actual: Item reads 'Enter route mode X' (X does nothing; R is the route hotkey). Menu is 210 px tall at y=720 → bottom 930 > 900 viewport; the last item 'Add comment' is clipped off-screen. The clamp estimates height from ENABLED items × 32 px, but disabled items ('Top layer (F.Cu)', 'Clear selection') also take space. 'Hide ratsnest' shows no ⇧B shortcut.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4150` shortcut: "X"
  - code: `src/core/frontend/src/components/AppContextMenu.tsx:17` menuHeight = enabledCount * 32 + 12 ignores disabled items/separators

## T-187 [S3] Raw internal net/item IDs shown to users (status bar 'Trace · 51272803:15620728', DRC list 'trace 4f0646 ↔ net -10160 ↔ net -10277')

- Area designer.pcb · category copy · estimate S · findings Q4-017
- **shared** with D1; lead: D3a
- Summary: Coordinate-derived net ids and 6-char entity hashes are the primary text of violation rows and the status-bar selection summary; the severity filter buttons are named only by their counts ('13', '6', '0').
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5503` — netLabel falls back to raw netId
- Proposed fix: Display names for anonymous nets/items ('Net-(R4-1)', 'Trace on F.Cu') in status bar and DRC list. — Detail: Generate display names for anonymous nets (from the first pad: 'Net-(R4-1)') in the projection's netNames; format DRC item refs via a shared describeItem() (kind + ref/pad + net name); give severity toggles aria-labels 'Errors 13' etc.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/042-drc-dock.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/029-drc-dock.png
- Q4-017 repro: PCB: click a trace/via on a net without a schematic name → status bar shows 'Trace · 51272803:15620728' / 'Via · 51272803:15620728' → Open the DRC dock tab: rows read 'trace 4f0646 ↔ trace a6aea0', 'trace 1ff5f8 ↔ R4.1 ↔ net -10160 ↔ net -10277'
  - expected: Human names: 'Trace · Net_7 · F.Cu · 0.25 mm', 'Track (Net_3) ↔ R4 pad 1 (GND)'; unnamed nets get a stable readable name ('Net-(R4-Pad1)' like KiCad)
  - actual: Coordinate-derived net ids and 6-char entity hashes are the primary text of violation rows and the status-bar selection summary; the severity filter buttons are named only by their counts ('13', '6', '0').
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5503` netLabel falls back to raw netId

## T-188 [S3] Cmd/Ctrl+A on PCB selects nothing on the board and instead text-highlights the entire app chrome

- Area designer.pcb · category keyboard · estimate S · findings Q4-018 · known K18
- Summary: Status bar stays 'No selection'; the browser's native select-all highlights every label in the rail, tabs, layers panel, component list and properties (window.getSelection() = 'Home Designer Library …'). Related: pressing Esc to close any canvas context menu also clears the current selection (right-click U1 → Esc → 'No selection').
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4340` — keymap has no Cmd/Ctrl+A branch
- Proposed fix: Cmd/Ctrl+A selects all board items (respect selection filter); preventDefault text selection. — Detail: Add Cmd/Ctrl+A → select all visible, unlocked items passing the selection filter (preventDefault); add `select-none` to the designer shell (keep text selectable in inputs); stopPropagation of Esc in AppContextMenu so the canvas doesn't also clear selection.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/092-cmd-a.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/028-cmd-a.png
- Q4-018 repro: PCB view, hover canvas, nothing focused → Press Cmd+A (or Ctrl+A)
  - expected: All board items selected (schematic editor supports Cmd+A); app chrome is user-select:none
  - actual: Status bar stays 'No selection'; the browser's native select-all highlights every label in the rail, tabs, layers panel, component list and properties (window.getSelection() = 'Home Designer Library …'). Related: pressing Esc to close any canvas context menu also clears the current selection (right-click U1 → Esc → 'No selection').
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4340` keymap has no Cmd/Ctrl+A branch

## T-189 [S3] Comment mode: PCB 'C' hotkey advertised but dead; Esc doesn't exit; drafts discarded silently

- Area designer.pcb · category keyboard · estimate S · findings Q4-020, Q5-027 · known K14
- **shared** with D2; lead: D3a
- Summary: No C handler in the PCB keymap; comment mode is not cleared by Esc; composer opens without focus. | Also covers: Q5-027: Comment mode is sticky: Esc doesn't leave it (schematic or PCB), PCB 'C' shortcut adverti…
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:463` — hotkey: 'C' advertised
- Proposed fix: Build PCB C comment hotkey; Esc exits comment mode (PCB + schematic); discarding a non-empty draft asks. — Detail: Add C (no modifiers) → props.onToggleCommentMode(); on Escape with commentMode → exit; autoFocus the composer textarea.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/093-pcb-comment.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/026-add-menu-after-esc.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q5/dark/060-schem-comment-mode.png
- Q4-020 repro: PCB view, hover canvas, press C → nothing (Add button stays 'Add') → Add ▾ → Comment → toolbar shows 'Comment' pressed → Press Esc (focus on body) → tool stays 'Comment'; only re-picking Add ▾ → Comment turns it off → After placing a pin the composer is not focused (activeElement BODY) so typing goes to the board hotkeys
  - expected: C toggles the comment tool (as on schematic), Esc exits it, composer autofocuses
  - actual: No C handler in the PCB keymap; comment mode is not cleared by Esc; composer opens without focus.
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:463` hotkey: 'C' advertised
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4340` no 'c' branch; Esc branch does not call onToggleCommentMode
- Q5-027 repro: Schem: press C (button pressed), blur, press Esc → button still pressed → PCB (fresh reload): press C, click board → no composer (K14) → PCB: Add ▾ → Comment, press Esc, click board → composer opens again; toolbar shows 'Comment' pressed and clicking it only reopens the Add menu → Type a reply draft, press Esc (or click the canvas) → popup closes; reopen → reply box empty
  - expected: Esc cancels the comment tool like every other tool; C toggles it on PCB as the menu label 'Comment C' promises; drafts are kept (or confirmation asked) when the popup closes.
  - actual: Schematic Escape handler has no commentMode branch; PCB keymap has no C binding; both keep the crosshair comment mode until C/menu toggles it or a comment is posted. Composer and reply drafts are dropped without warning on Esc or any outside mousedown. Status-bar hint stays 'Click to select · Shift+click to add · drag to box-select' in comment mode.
  - code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1745` Escape branch excludes commentMode
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:467` hotkey 'C' label with no keymap entry
  - code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:197` Esc closes, body state lost

## T-190 [S3] Board panel buttons use raw Unicode glyphs ('✏ Draw custom shape', '⭳ Import DXF…'); ⭳ renders as a tofu box

- Area designer.pcb · category visual · estimate XS · findings Q4-029
- Summary: Text glyphs '✏' and '⭳' are embedded in the label; U+2B73 has no glyph in the UI font and renders as an empty box ('▯ Import DXF…'); the glyphs also end up in the accessible names ('⭳ Import DXF…'). Dashed-border button style is unique to this panel.
- Root cause: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:309` — ✏ Draw custom shape / ⭳ Import DXF… (also 228, 236, 317)
- Proposed fix: Replace ✏/⭳ glyphs with Lucide icons in kit Buttons. — Detail: Replace with kit Button variant=secondary size=sm icon={<Pencil/>} / icon={<FileUp/>}; remove glyphs from labels.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/120-shape-Oval.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/040-board-edit.png
- Q4-029 repro: PCB, nothing selected → Properties → Board → Edit → Look at the dashed 'Draw custom shape' / 'Import DXF…' buttons (and 'Redraw shape' for a custom outline)
  - expected: Lucide icons (Pencil / FileInput) at 12px like every other kit button
  - actual: Text glyphs '✏' and '⭳' are embedded in the label; U+2B73 has no glyph in the UI font and renders as an empty box ('▯ Import DXF…'); the glyphs also end up in the accessible names ('⭳ Import DXF…'). Dashed-border button style is unique to this panel.
  - code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:309` ✏ Draw custom shape / ⭳ Import DXF… (also 228, 236, 317)

## T-191 [S3] Free-hole inspector shows X/Y as raw 15-digit floats and read-only, although holes can be dragged

- Area designer.pcb · category visual · estimate S · findings Q4-032
- Summary: 'X 11.92982456140351', 'Y 15.958646616541353' as plain text (comment says 'read-only until a move command exists' but canvas drag moves the hole, rev 22→23). The free-pad inspector has no X/Y at all; hole/pad placements land off-grid.
- Root cause: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:157` — readOnly NumericField renders {value} unformatted; stale comment
- Proposed fix: Hole inspector X/Y formatted (3 dp mm) and editable (move command). — Detail: Format readOnly values with toFixed(3); wire X/Y as editable NumericFields using the existing move command used by canvas drag (also allow 0/negative — NumericField currently rejects n <= 0); add X/Y rows to FreePadPanel.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/150-hole-inspector.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/037-hole-inspector.png
- Q4-032 repro: QA-q4-board → PCB → press H, click the board → Select the hole → Read Properties → HOLE; then drag the hole on the canvas
  - expected: X/Y formatted to 3 decimals (like the status bar) and editable like other numeric fields; free pads also expose X/Y
  - actual: 'X 11.92982456140351', 'Y 15.958646616541353' as plain text (comment says 'read-only until a move command exists' but canvas drag moves the hole, rev 22→23). The free-pad inspector has no X/Y at all; hole/pad placements land off-grid.
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:157` readOnly NumericField renders {value} unformatted; stale comment
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:77` readOnly branch has no toFixed

## T-192 [S3] Measure / sketch dimension labels are world-sized, off-token cyan and drawn under board items — the measured distance can be unreadable

- Area designer.pcb · category visual · estimate S · findings Q4-034
- Summary: Measure label 'xx.62 mm' has its leading digits hidden behind the hole's silk ring (rendered on top) and the measure line strikes through the text; colour is hard-coded #38bdf8 (Tailwind sky-400). Sketch rubber-band length label is ~5px tall at the default 20% zoom ('47.27 mm' illegible, crop in shot 127); both are fixed world sizes (0.9 mm / edge labels 0.6 mm) so they vanish when zoomed out. Board-edit edge labels…
- Root cause: `src/modules/designer/frontend/pcb/layers/MeasureOverlayLayer.tsx:15` — COLOR = '#38bdf8'
- Proposed fix: Measure labels screen-sized, token colours, drawn above board items. — Detail: Render measure/sketch labels via the existing DOM HUD pattern (like SketchDimEntry) or scale fontSize by 1/zoom (EDAText screen-space); give them RENDER_ORDER top + a token background; replace #38bdf8 with the canvas theme measure token.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/169-measure-done.png
- Q4-034 repro: QA-q4-board (free hole + keepout) at default fit zoom → press M → Click at bottom-left of the board, click at top-right so the midpoint lands near the hole → Read the distance label; separately: press O and start a board sketch, read the edge length label on the rubber-band line
  - expected: Screen-space label (constant ~11px) on an opaque token chip, always drawn above copper/holes, offset from the line
  - actual: Measure label 'xx.62 mm' has its leading digits hidden behind the hole's silk ring (rendered on top) and the measure line strikes through the text; colour is hard-coded #38bdf8 (Tailwind sky-400). Sketch rubber-band length label is ~5px tall at the default 20% zoom ('47.27 mm' illegible, crop in shot 127); both are fixed world sizes (0.9 mm / edge labels 0.6 mm) so they vanish when zoomed out. Board-edit edge labels ('40.00 mm', '25.00 mm') are ~6px tall at 1100×720 fit zoom (shot 184).
  - code: `src/modules/designer/frontend/pcb/layers/MeasureOverlayLayer.tsx:15` COLOR = '#38bdf8'
  - code: `src/modules/designer/frontend/pcb/layers/MeasureOverlayLayer.tsx:99` EDAText fontSize 0.9 (world mm), no renderOrder
  - code: `src/modules/designer/frontend/pcb/layers/OutlineEdgeLabels.tsx:19` FONT_MM = 0.6

## T-193 [S3] Footprint Properties are read-only: X/Y/Rotation/Side cannot be typed; multi-selection panel offers no actions

- Area designer.pcb · category bug · estimate M · findings Q4-036
- Summary: U1 shows X 8.020, Y -1.927, Rotation 0.0 as static text (no inputs); the only way to position precisely is dragging. Multi-selection shows only 'CONTENTS Footprints 4 / Traces 1 / Vias 2'. Free text/pad/zone inspectors, in contrast, are editable — inconsistent.
- Root cause: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:306` — Location rows are PropertyRow text only
- Proposed fix: Footprint Properties: editable X/Y/Rotation/Side via existing pcb_move/rotate/flip; multi-select actions (Rotate/Flip/Delete). — Detail: Use the inspector NumericField (after fixing Q4-033) for X/Y/Rotation wired to movePlacement/rotatePlacement; add a Side segmented control (flipPlacement); add Rotate 90°/Flip/Delete buttons to the multi-selection panel.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/172-footprint-inspector.png
- Q4-036 repro: Dual LED Blinker → PCB → Components panel → click 'U1' → Properties → GENERAL / LOCATION → Box-select several parts → Properties
  - expected: Pro-EDA inspector: editable X, Y, Rotation (and side/lock) for footprints, and for multi-selection at least Rotate/Flip/Delete/Align actions
  - actual: U1 shows X 8.020, Y -1.927, Rotation 0.0 as static text (no inputs); the only way to position precisely is dragging. Multi-selection shows only 'CONTENTS Footprints 4 / Traces 1 / Vias 2'. Free text/pad/zone inspectors, in contrast, are editable — inconsistent.
  - code: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:306` Location rows are PropertyRow text only

## T-194 [S3] PCB canvas clear colour is hard-coded #0e1116 (blue-cast) instead of --surface-canvas-well #08090a, in both themes

- Area designer.pcb · category visual · estimate XS · findings Q4-038 · known K38
- Summary: Both themes render #0e1116 (ΔE 3.9 vs #08090a; B channel 0x16 > R 0x0e → visible blue cast next to the neutral #111113 / #f7f7f8 chrome). Board interior probes #05080c–#0d1219, also blue-shifted.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5922` — backgroundColor="#0e1116"
- Proposed fix: PCB clear colour = --surface-canvas-well token. — Detail: Read the token at runtime (getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas-well')) or pass a theme-map constant '#08090a' to EdaCanvas backgroundColor; align the board-interior fill in the canvas theme package.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/183-canvas-clear.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/001-pcb.png
- Q4-038 repro: Dual LED Blinker → PCB (dark, then light theme) → Probe empty canvas outside the board (700,780) and (360,200)
  - expected: Canvas well = --surface-canvas-well #08090a (neutral), matching the redesign tokens
  - actual: Both themes render #0e1116 (ΔE 3.9 vs #08090a; B channel 0x16 > R 0x0e → visible blue cast next to the neutral #111113 / #f7f7f8 chrome). Board interior probes #05080c–#0d1219, also blue-shifted.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5922` backgroundColor="#0e1116"
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:1` package theme also carries #0e1116

## T-196 [S3] DRC markers are fixed-size screen diamonds that bury the board at fit zoom (106 markers cover every pad)

- Area designer.pcb · category visual · estimate M · findings Q4-043
- Summary: Each violation draws a ~20 px layered diamond (glow + ring + core) at constant screen size; at fit zoom the markers overlap each other and completely cover pads/parts (at 1100×720 the board is an orange/pink field). Pad numbers under markers are hidden even when zoomed in (U1 pads 3/4/5/8, shot 172). Only workaround is View ▾ → DRC markers off, which hides all of them.
- Root cause: `src/modules/designer/frontend/pcb/drc:1` — marker layer (drc-colors / markers) renders one badge per violation
- Proposed fix: Scale markers with zoom / cluster at fit zoom; draw beneath selection highlight. — Detail: Cluster markers within N px into a count badge at low zoom; hide warnings below a zoom threshold; reduce marker size to ~12 px and drop the glow; draw pad numbers above markers or offset markers to the violation edge.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/171-dual-led-pcb.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/001-pcb.png
- Q4-043 repro: Dual LED Blinker (32 errors / 74 warnings) → PCB → Fit board → Look at the board at 1440×900 and at 1100×720
  - expected: Markers readable but subordinate to the design: cluster/aggregate at low zoom, scale with zoom, or show only errors by default; copper and pad numbers stay legible
  - actual: Each violation draws a ~20 px layered diamond (glow + ring + core) at constant screen size; at fit zoom the markers overlap each other and completely cover pads/parts (at 1100×720 the board is an orange/pink field). Pad numbers under markers are hidden even when zoomed in (U1 pads 3/4/5/8, shot 172). Only workaround is View ▾ → DRC markers off, which hides all of them.
  - code: `src/modules/designer/frontend/pcb/drc:1` marker layer (drc-colors / markers) renders one badge per violation

## T-197 [S3] In Route mode before the first click, B switches to bottom copper but T quits Route and arms the Text tool (keymap advertises T/B = layer)

- Area designer.pcb · category keyboard · estimate XS · findings Q4-045 · known K16
- Summary: T leaves Route (Route (R) aria-pressed=false) and the Add button turns into 'Text ▾' — the next board click opens the Text prompt. 1 and 2 behave correctly (Route stays, layer switches). The 'T/B layer' hint itself is never rendered (HUD uses primaryOnly hints), so the conflicting hint from K16 is not visible — only the behaviour is inconsistent.
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4490` — T → Text tool whenever not actively routing (incl. idle Route mode)
- Proposed fix: Route idle: T/B both switch layer (T no longer arms Text) or fix hint; consistent keymap. — Detail: While toolMode==='route' (idle or routing) treat T/B/1/2/PgUp/PgDn as layer keys before the global tool hotkeys; keep T=Text only in Select mode.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/192-route-idle-T.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/050-route-idle-T.png
- Q4-045 repro: Dual LED Blinker → PCB → Top Copper active → hover canvas, press R (route idle, 'Route — click a pad to start') → Press B → Route stays on, active layer Bottom Copper → Press T
  - expected: T mirrors B (select Top Copper while staying in Route), as the route keymap table declares ({keys:'T/B', label:'layer'}) and as 1/2 already do
  - actual: T leaves Route (Route (R) aria-pressed=false) and the Add button turns into 'Text ▾' — the next board click opens the Text prompt. 1 and 2 behave correctly (Route stays, layer switches). The 'T/B layer' hint itself is never rendered (HUD uses primaryOnly hints), so the conflicting hint from K16 is not visible — only the behaviour is inconsistent.
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4490` T → Text tool whenever not actively routing (incl. idle Route mode)
  - code: `src/modules/designer/frontend/pcb/tools/route-keymap.ts:34` { keys: 'T/B', label: 'layer' }

## T-198 [S3] Selection filter covers only Traces/Vias/Pads/Components — zones, keepouts, free holes/pads, text and outline can't be filtered

- Area designer.pcb · category bug · estimate S · findings Q4-046
- Summary: Only 4 kinds: Traces ('Routed copper segments'), Vias, Pads ('Component pads'), Components. Free holes, free pads, zones, keepouts, overlay text and board outline are always selectable; with a large GND zone every box-select/click inside it competes with the zone.
- Root cause: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:28` — FILTER_KINDS lists 4 kinds only
- Proposed fix: Selection filter adds zones, keepouts, free holes/pads, text, outline. — Detail: Extend SelectionFilterKind with zones, keepouts, freeHoles, freePads, texts (and outline) and honour them in pcb-hit / box-select; add All/None shortcuts.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/light/019-selection-filter.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/038-selection-filter.png
- Q4-046 repro: QA-q4-board (free hole, free pad, overlay text, keepout) → PCB, nothing selected → Press F → 'SELECTION FILTER' panel → Try to exclude the keepout/text/hole from box selection
  - expected: One toggle per selectable primitive (KiCad: Footprints, Text, Tracks, Vias, Pads, Graphics, Zones, Keepouts, Other), so users can box-select e.g. traces over a zone
  - actual: Only 4 kinds: Traces ('Routed copper segments'), Vias, Pads ('Component pads'), Components. Free holes, free pads, zones, keepouts, overlay text and board outline are always selectable; with a large GND zone every box-select/click inside it competes with the zone.
  - code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:28` FILTER_KINDS lists 4 kinds only

## T-199 [S3] PCB controls off-spec: 18/20/32px inputs, 13px checkboxes, zone-net select clips 'GND' to 'GN', pour select crushed to 10px

- Area designer.pcb · category consistency · estimate M · findings Q4-050, F2A-021, Q4-012 · known K37
- Summary: Measured via getBoundingClientRect: Board panel inputs 18 px (INPUT_CLASS h-[18px]) and preset buttons 18 px; pad/text/zone/keepout inspector inputs + <select>s 18 px (FIELD_CLASS h-[18px]); route row W/Auto/via chips 20 px but 45°/90° segments 18 px; Corner/Edge/DXF modal inputs 32 px (h-8); keepout/inspector checkboxes 13 px native; Design rules inputs 21 px (Q4-022). Also nameless route-row buttons (only title at… | Also covers: F2A-021: Zone/Keepout options bar: 'Zone net' select is 43 px wide and shows 'GN' for GND (every n…; Q4-012: Layers panel pour row: 'pad connection' select is crushed to 10 px, value unreadable
- Root cause: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:34` — INPUT_CLASS h-[18px]
- Proposed fix: PCB inputs/selects to kit sizes (22/20px) with min widths; zone net select shows full names; pour 'pad connection' select ≥80px. — Detail: Replace the local INPUT_CLASS/FIELD_CLASS and native selects/checkboxes with the shared kit Input/Select/Checkbox at size sm (20) or md (22); give the route-row SegmentedControl the same height as its sibling chips; add aria-labels to route-row buttons.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/154-pad-inspector.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/043-done-unapplied.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2a/dark/058-zone-tool.png
- Q4-050 repro: PCB → Board panel → Edit: measure Width/Height/Corner radius inputs and size preset buttons → Select a free pad / text / zone / keepout: measure inspector inputs & selects → Press R: measure route-row chips and 45°/90° segments → Open Fillet corner / Set edge length / Import DXF modals: measure inputs
  - expected: Kit standard 22 px controls (20 px sm) everywhere; one checkbox component
  - actual: Measured via getBoundingClientRect: Board panel inputs 18 px (INPUT_CLASS h-[18px]) and preset buttons 18 px; pad/text/zone/keepout inspector inputs + <select>s 18 px (FIELD_CLASS h-[18px]); route row W/Auto/via chips 20 px but 45°/90° segments 18 px; Corner/Edge/DXF modal inputs 32 px (h-8); keepout/inspector checkboxes 13 px native; Design rules inputs 21 px (Q4-022). Also nameless route-row buttons (only title attributes, no aria-label).
  - code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:34` INPUT_CLASS h-[18px]
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:41` FIELD_CLASS h-[18px]
  - code: `src/modules/designer/frontend/pcb/CornerOpModal.tsx:70` h-8 input
  - code: `src/modules/designer/frontend/pcb/EdgeDimModal.tsx:24` h-8 input
- F2A-021 repro: PCB → Z (Zone tool) → Look at the floating options bar at the top of the canvas (dark + light)
  - expected: Net select wide enough for typical names (GND, VCC, +3V3, Net_12) or auto-width; kit 22 px controls; flat bar per tokens (no drop shadow).
  - actual: DOM: Zone layer select 53×20, Zone net 43×18 (shows 'GN'), Zone pad connection 126×20 — three widths/two heights in one row; native OS selects/checkbox; bar box-shadow '0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)', bg surface-raised/95 + backdrop-blur (off the flat-token rule). The chosen net is the key setting of a pour and is unreadable. Light theme: the bar renders #d8d8db over the (always-dark) canvas and the 'Layer'/'Net'/'Pads' labels are #808087/#7f7f86/#85858c on #d8d8db = 2.76/2.80/2.58:1 contrast (text-tertiary on surface-raised).
  - code: `src/modules/designer/frontend/pcb/AreaToolOptionsBar.tsx:75` floating bar classes 'shadow-lg backdrop-blur', text-[11px], labels text-text-tertiary on bg-surface-raised/95
  - code: `src/modules/designer/frontend/pcb/AreaToolOptionsBar.tsx:107` Net uses NetSelect from the inspector
  - code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:40` NetSelect uses FIELD_CLASS 'h-[18px] w-full min-w-0' — inside the auto-width flex span it collapses to 43 px
- Q4-012 repro: PCB → Layers panel → Top Copper row → click the droplet 'Show copper fills' → Look at the POUR row under Top Copper
  - expected: Net select and pad-connection select (Solid/Thermal…) both readable
  - actual: 'Top Copper pour net' select takes 173 px, 'Top Copper pad connection' select is 10 px wide (only a sliver of the chevron visible, current value 'Solid' hidden). Both are native <select> at 18 px height (kit standard 22/20). The adjacent 'Remove redundant pour traces' button deletes traces with no preview, no confirmation and no result feedback (clicked: nothing removed, nothing reported).
  - code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:590` NetSelect + pad connection select in one flex row, no min-width
  - code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:472` cleanupPourTraces: no result count surfaced

## T-200 [S4] No in-flight feedback for PCB commands: Undo/moves on a slow backend look like no-ops for seconds

- Area designer.pcb · category perf · estimate XS · findings F1A-013
- Summary: Undo stays enabled and nothing changes for ~5 s (undo POST plus projection refetch), then the board jumps. All 3 clicks are sent: two apply (rev 17 → 19), the third returns {ok:false, code:'HISTORY_EMPTY'} and is silently ignored. The history itself is correct (no data issue); the problem is only the lack of pending state, which also lets the user trigger the F1A-003 conflict.
- Root cause: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:243` — undo/redo await api + refresh + refreshHistory with no pending flag exposed to the toolbar
- Proposed fix: Subtle in-flight indicator (status bar 'Saving…') while PCB commands are pending. — Detail: Expose a pendingCommands count from the workspace. Show 'Saving…' in the status bar and disable Undo/Redo while an undo/redo is in flight.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1a/dark/061-undo-race-inflight.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1a/dark/040-undo-race-inflight.png
- F1A-013 repro: Latency shim 2.5 s, PCB view with 2 undoable moves → Click toolbar Undo 3× quickly and watch the canvas and the Undo button for 10 s → GET projection/pcb + response bodies of the /history/undo calls
  - expected: A busy indicator (status-bar 'Saving…' or a disabled Undo while pending), and extra clicks either queue or are ignored with a hint.
  - actual: Undo stays enabled and nothing changes for ~5 s (undo POST plus projection refetch), then the board jumps. All 3 clicks are sent: two apply (rev 17 → 19), the third returns {ok:false, code:'HISTORY_EMPTY'} and is silently ignored. The history itself is correct (no data issue); the problem is only the lack of pending state, which also lets the user trigger the F1A-003 conflict.
  - code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:243` undo/redo await api + refresh + refreshHistory with no pending flag exposed to the toolbar

## T-205 [S4] Via preset menu offers 'Microvia 0.10 / 0.30 mm — HDI / BGA laser-drilled (Phase C)': internal roadmap copy, and picking it places a 0.1 mm THROUGH via

- Area designer.pcb · category copy · estimate XS · findings F2B-017
- Summary: The last entry reads 'Microvia 0.10 / 0.30 mm · HDI / BGA laser-drilled (Phase C)'. The route tool always commits viaType 'through', so this preset yields a 0.1 mm-drill through via spanning all layers (below every fab preset's drill minimum). 'Standard 4L — Default for 4-layer (JLCPCB 4L min)' is listed as the default even when the board minimum (0.8 mm) rejects it (see F2B-003).
- Root cause: `src/modules/designer/backend/pcb/via-presets.ts:73` — description 'HDI / BGA laser-drilled (Phase C)'
- Proposed fix: Hide 'Microvia (Phase C)' preset until supported (and drop roadmap copy). — Detail: Drop 'Microvia' from the route-time list until microvias exist, remove '(Phase C)', and grey out presets below the resolved board minimum with a tooltip.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/030-4L-via-preset-menu.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/dark/009-4L-via-preset-menu.png
- F2B-017 repro: QA-f2b-4L → PCB → R → start a route → open the via preset chip ('Standard 4L ▾')
  - expected: Only presets the board/fab can build (or disabled with a reason); no internal phase names in UI copy; a microvia preset should create a microvia (layer-adjacent) or not be listed.
  - actual: The last entry reads 'Microvia 0.10 / 0.30 mm · HDI / BGA laser-drilled (Phase C)'. The route tool always commits viaType 'through', so this preset yields a 0.1 mm-drill through via spanning all layers (below every fab preset's drill minimum). 'Standard 4L — Default for 4-layer (JLCPCB 4L min)' is listed as the default even when the board minimum (0.8 mm) rejects it (see F2B-003).
  - code: `src/modules/designer/backend/pcb/via-presets.ts:73` description 'HDI / BGA laser-drilled (Phase C)'
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2546` route vias always viaType 'through'

## T-206 [S4] Tune (U) and Measure are hotkey-only and Bundle routing is unreachable: no toolbar/menu entry exposes them

- Area designer.pcb · category stub · estimate S · findings Q4-035 · known K13
- Summary: Tune (pcb.lengthTuning) is reachable only by pressing U; Measure only by M or the empty-canvas context menu; Bundle (K13) not at all. While Tune is active no toolbar button shows a pressed state and the status-bar hint still says 'Click to select…'. The Tune row also shows 'no net' for the picked trace and an 'Enter apply' that is disabled until a target is typed, with no explanation. K13 confirmed: nothing in PcbCa…
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:646` — 'Measure (M), Tune (U) and Bundle stay hotkey-only'
- Proposed fix: Remove dead Bundle leftovers (keep pcb.bundleRouting flag); expose Measure in View/Add menu. — Detail: Add a split button next to Route (Route / Tune length / Bundle) or put Tune/Measure/Bundle in the Add ▾ or a Tools ▾ menu with hotkey hints; show the pressed state while active; label 'Enter apply' with a tooltip 'Set a target length first'.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/177-tune-click-trace.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/027-ctx-empty.png
- Q4-035 repro: Dual LED Blinker → PCB → Look for a Tune / length-matching control in the toolbar, Add ▾, View ▾, right-click menus → Press U over the canvas → 'Tune — click a routed trace…' row appears
  - expected: Every tool discoverable from the toolbar (e.g. Route ▾ → Tune length (U), Bundle) with the hotkey in the tooltip, like Route (R) / Board (O)
  - actual: Tune (pcb.lengthTuning) is reachable only by pressing U; Measure only by M or the empty-canvas context menu; Bundle (K13) not at all. While Tune is active no toolbar button shows a pressed state and the status-bar hint still says 'Click to select…'. The Tune row also shows 'no net' for the picked trace and an 'Enter apply' that is disabled until a target is typed, with no explanation. K13 confirmed: nothing in PcbCanvas/PcbTopToolbar ever calls setToolMode('bundle') (only 'toolMode === "bundle"' checks exist), so the Bundle tool behind pcb.bundleRouting cannot be entered by any key, button or menu.
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:646` 'Measure (M), Tune (U) and Bundle stay hotkey-only'
  - code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:348` 'bundle' tool mode declared; no setter anywhere
  - code: `src/core/contracts/feature-flags/registry.ts:106` pcb.lengthTuning / pcb.bundleRouting availability 'dev'

## T-207 [S4] Components panel: Shift/Cmd+click does not multi-select and instead leaves a native text-selection highlight across rows

- Area designer.pcb · category bug · estimate XS · findings Q4-037
- Summary: Only R2 is selected; R1's footprint/value text stays highlighted in browser selection blue for the rest of the session (visible in later screenshots).
- Root cause: `src/modules/designer/frontend/pcb/PcbComponentsPanel.tsx:1` — row onClick selects single placement
- Proposed fix: Components panel: Shift/Cmd multi-select, user-select-none on rows. — Detail: Add select-none to rows and honour shiftKey/metaKey in the row click handler (toggle/add to selection).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/173-multi-rows.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/049-shift-click-rows.png
- Q4-037 repro: Dual LED Blinker → PCB → Components panel → Click 'R1', then Shift+click 'R2'
  - expected: Range/additive selection like the canvas (Shift+click to add), no text highlight (user-select:none on rows)
  - actual: Only R2 is selected; R1's footprint/value text stays highlighted in browser selection blue for the rest of the session (visible in later screenshots).
  - code: `src/modules/designer/frontend/pcb/PcbComponentsPanel.tsx:1` row onClick selects single placement

## T-208 [S4] Selection filter panel ignores Esc and survives view switches; only F or its × closes it

- Area designer.pcb · category keyboard · estimate XS · findings Q4-048
- Summary: Esc leaves the panel open; it is still open after DRC view → PCB and overlaps the canvas top-right; pressing F again closes it.
- Root cause: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:46` — no Escape handling
- Proposed fix: Selection filter closes on Esc and on view switch. — Detail: Handle Escape in the PCB keymap (close filter first, before clearing selection) and close the panel on view change.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/light/019-selection-filter.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/038-selection-filter.png
- Q4-048 repro: PCB, nothing selected → press F → 'SELECTION FILTER' floating panel → Press Esc (canvas hovered) → Switch to the DRC view tab and back to PCB
  - expected: Esc closes transient floating panels (like menus/pickers); panel does not reappear after navigating away
  - actual: Esc leaves the panel open; it is still open after DRC view → PCB and overlaps the canvas top-right; pressing F again closes it.
  - code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:46` no Escape handling

## T-209 [S4] PCB toolbar tooltips incomplete: Flip part/Fit board omit hotkeys, disabled Flip gives no reason, 'Add' tooltip omits Comment, DRC tooltip is just 'DRC'

- Area designer.pcb · category copy · estimate XS · findings Q4-051
- Summary: titles: 'Fit board', 'Flip part' (disabled, no 'select a part' hint, F hotkey missing), 'Add hole, pad, text, zone, or keepout' (menu also has Comment), 'DRC' (badge meaning undefined — see Q4-001). Undo/Redo/Route/Board include hotkeys, so the set is inconsistent.
- Root cause: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:650` — frozen accessible names; titles composed by ToolbarButton
- Proposed fix: Complete toolbar tooltips (hotkeys, disabled reasons, Comment in Add). — Detail: In PcbTopToolbar pass richer titles while keeping aria-labels frozen (D9): 'Flip part (F)' and, when disabled, 'Flip part (F) — select a footprint first'; 'Add hole, pad, text, zone, keepout or comment'; DRC 'Design rule check — {errors} errors, {warnings} warnings' (see Q4-001).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/120-shape-Oval.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq4/dark/001-pcb.png
- Q4-051 repro: PCB view, nothing selected → Hover each toolbar button / read title attributes
  - expected: Every tool tooltip names the action + hotkey (Flip part (F), Fit board (Home/0)…), disabled buttons explain why, DRC button says what the badge counts ('Run / show DRC — 32 errors')
  - actual: titles: 'Fit board', 'Flip part' (disabled, no 'select a part' hint, F hotkey missing), 'Add hole, pad, text, zone, or keepout' (menu also has Comment), 'DRC' (badge meaning undefined — see Q4-001). Undo/Redo/Route/Board include hotkeys, so the set is inconsistent.
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:650` frozen accessible names; titles composed by ToolbarButton
