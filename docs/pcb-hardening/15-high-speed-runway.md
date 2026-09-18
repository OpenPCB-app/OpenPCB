# 15 — High-speed architecture runway (S15)

> Status: **BINDING** (S15, 2026-09-18). Companion: `PROGRAM.md` S15 and S15b rows,
> `../drc/OPEN_FINDINGS.md` "S15", `13-electrical-contract.md`, `14-si-contract.md`.
> Ledgers: §8.1 (plan-critique, 24 findings) and §8.2 (Astra run 0, brainstorm) are folded into the
> text below; "(critique #n)" / "(Astra Qn)" marks where.

## 0. Scope and claims

S15 is a design session. It answers one question: **which of today's data representations and
contracts would prevent — not merely make laborious — credible future high-speed analysis**, and it
changes only what prevents a known dead end.

A representation can be insufficient for an analysis without being a dead end (Astra, framing).
Missing stack-up data needs a new declaration; a missing spatial index needs computation; a lossy
derived result can be recomputed from the persisted copper. The dead ends are the places where
information is **destroyed**, or where a **definition is frozen** in a way a later extension must
break.

This contract claims nothing about impedance, delay, crosstalk or return-path quality. It builds no
solver, no impedance engine, no router behaviour. Its code changes are two: board settings stop
erasing data they do not understand (§2.1), and the manufacturing export refuses a board it would
silently truncate (§7.1).

Out of scope, with owners: the persisted stack-up model, inner-layer elevations, the via axial
metric, KiCad thickness / stack-up import and a stack-up authoring surface — **S15b** (§4); any
change to the `NetPath` result shape — the first SI session that consumes the junction graph (§3.1);
the cloud snapshot, the 3D preview, the layer tab strip, multilayer Gerber emission — registered,
§7.

## 1. Capability ladder

Verdicts: `ready` (the data exists and is reachable) · `additive` (new code or optional fields, no
existing meaning changes) · `needs declaration` (information that cannot be inferred from geometry
and must be entered) · `blocked` (information destroyed or a definition that must be broken).

| Level | Capability | Data needed | Where it lives today | Verdict |
|---|---|---|---|---|
| L0 | Routed length, same-layer coupled-span measures | copper geometry, S1 junctions | `pcb-connectivity/net-path*.ts`, `drc/si/` (contract 14) | ready |
| L1 | Per-layer propagation delay | per-segment layer and length; per-layer velocity; the conductor through pads and via lands | `PathSegment.layer` is retained; interior spans are clipped from the RESULT (`net-path-graph.ts`, the `clipped` test on each cut interval) but regenerate from persisted copper; velocity has no source | additive on the graph (§3.1) + needs declaration (§4) |
| L1 | Via barrel path and stub | which via, the set of traversed layer gaps, elevations, physical drill termination | barrel edges carry no weight and are not emitted (`net-path-graph.ts`, one edge per adjacent span-layer pair); no elevation exists; `fromLayer` / `toLayer` is a nominal span, not a drill depth | additive on the graph + needs declaration |
| L2 | Single-ended / differential impedance TARGETS by closed-form formula | ordered dielectric items, copper thickness, trace width, reference conductor, mask | none of the stack data exists; widths and gaps exist | needs declaration; a formula that does not apply to a declared arrangement stays UNRESOLVED (§6) |
| L3 | Reference-plane identification, return-path continuity | per-layer copper coverage with connectivity, layer adjacency, intent | positive per-net single-layer zones; filled islands in the DRC context (`ctx.pourResults()`); no `(layer, net)` index, no coverage query, no adjacency helper | additive (§3.4); intent needs declaration |
| L3 | Broadside coupling | cross-layer partner copper, the dielectric gap | the coupled-span kernel is same-layer 2D by definition (14 §4, §10) | additive as NEW codes and a NEW measure (§3.5) |
| L3 | Extended nets through series parts | component pin-to-pin data, selected endpoints | `NetPath.terminals` are pins; no composition layer | additive (§3.6) |
| L4 | Crosstalk, field solving | everything above, exported | — | external; never in the DRC engine |
| — | Persisting ANY of the declarations above | a settings blob that survives mixed-version use | `parseBoardSettings` rebuilt the object from named keys; every writer serialised the typed object; no schema version | **blocked → fixed in S15 (§2.1)** |

## 2. Dead-end register

### 2.1 Board settings erased what they did not understand — FIXED

`PcbBoardSettings` is one JSON blob. Its reader (`parseBoardSettings`, `parseDesignRules` and the
row parsers in `backend/pcb/pcb-store.ts`) is a strict whitelist, and every writer serialised the
typed projection. A field written by a newer build was therefore dropped on read and **erased by
the next save** of an older build — unrecoverable, and the only irreversible loss found (critique
#4, Astra Q1).

The rule from S15 on:

- Every board-settings write goes through `serializeBoardSettings(storedRaw, next)`
  (`backend/pcb/board-settings-serialize.ts`). It stamps `schemaVersion` and carries over what the
  running build does not know: unknown top-level keys, unknown keys inside `designRules` and its
  sub-blocks, inside `viewState` (and `autoLayoutConfig`), on id-keyed rows (`netClasses`,
  `diffPairs`, `lengthMatchGroups`, `drcRules`) and on their nested `target` / `constraint` /
  scope objects, and whole stored rows this build cannot parse (an unknown union variant).
- Known keys always win. A known optional key the user emptied is not resurrected; a row that
  parses and was removed is deleted. EVERY stored row that does not parse — with or without an
  id, even sharing an id with a kept row — could never have been shown or deleted, so it is kept
  raw, once; a `perNetClassAssignments` entry pointing at a rescued net class is kept with it.
- Carried data never moves to another object. A DRC rule's scopes have no id, so stored and
  next scopes are paired by CONTENT (equal known keys), never by index: a deleted, reordered or
  edited scope loses its unknown keys rather than lending them to a neighbour (R1 #1 —
  misattribution is worse than loss, because absence lets a future reader default safely).
- The TYPED projection is unchanged. DRC, the content digest, the cloud snapshot and the goldens
  read the projection; none of them sees carried data.
- A stored `schemaVersion` above the running build's still loads and is preserved.

Limits, stated:

- Preservation protects only builds that ship it — builds before S15 remain destructive (Astra Q1).
- Carried data can become **stale**: an older build may change `layerCount` or `boardThicknessMm`
  underneath a preserved stack-up, and the REPAIR path (a row that no longer parses is rewritten
  from defaults) keeps the unknown keys while resetting every known one (R1 #5). A reader of any
  carried block validates it against the known fields and reports a disagreement; it never trusts
  it.
- **A known key holding a value this build cannot parse is REWRITTEN to this build's fallback** on
  the next save — a future `fabricator`, `displayMode`, `outerConductors` or
  `defaultViaProtection` value, a severity outside the known set (R1 #2, probed). The older build
  cannot tell "the parser fell back" from "the user chose the default". Consequence, binding on
  future sessions: **extend by NEW KEYS or NEW ROW VARIANTS, never by new values of an existing
  key** — a new enum value on an old key is destroyed by every older build.
- Positions not covered: unknown keys inside `outline`, `cutouts[]` (closed geometry unions),
  `tracePresets`, `perLayerOpacity` and other maps are still dropped. A future field goes beside
  them, not inside them.
- `schemaVersion` is an integer; a non-integer stamp is rewritten to the running build's.

A new persisted field still needs its parser arm, its `routes.ts` arm and its content-digest entry
(`board-content-digest.ts` fail-closed rule); preservation is the safety net, not the mechanism.

### 2.2 Not dead ends (each was examined as a candidate)

- **`NetPath` is lossy** — three scalars plus retained copper segments; clipped interior spans,
  barrel edges, pruned branches and the topology of an `undefined` path are absent. It is a derived
  RESULT: the persisted integer-nm copper regenerates the junction graph deterministically
  (`computeConnectivity(items, { junctions: true })` and the graph builder). It becomes a blocker
  only if designated the sole input of a future analysis, which §3.1 forbids. (Critique #1 / #2
  called these blocked; Astra Q1 / Q2 overruled that, and the overruling stands on the fact that
  no information is destroyed.)
- **~18 direct readers of `boardThicknessMm`** — a refactor cost. A future stack-up consumer reads
  the new model directly (critique #3).
- **mm-named rule and target fields** (`maxSkewMm`, `target: { kind: "absolute"; mm }`, `gapMm` …)
  and `DrcViolation.measuredMm` / `requiredMm` — additive under §3.2.
- **Single-layer, per-net, positive zones** — they represent planes, splits and antipad holes; the
  missing index is computation (Astra Q1).
- **Violation ids** hash code + sorted anchors + layer and never the measure, and no SI code is
  location-hashed — a metric can gain a channel without moving an id. The constraint is the
  converse: two results on one anchor set collide (§3.2).
- **The uniqueness rule** (14 §2.4) and **the same-layer measures** (14 §4) stay valid under their
  stated definitions; §3.5 and §3.7 say how a physical model sits beside them.

## 3. Binding extension rules

A later session that adds a capability of §1 follows these. Each exists because the alternative
moves established verdicts or golden ids.

### 3.1 Future SI consumes the junction graph, never the `NetPath` scalars

Conductor length, delay, stub and return-path work need graph incidence (edge endpoints, junctions,
terminal attachments, via-layer nodes), contact geometry (entry / exit positions, layer, the pad or
via copper primitive entered), clipping provenance (EVERY overlapping clipping owner, and contact
events of zero length — tangency at `dist ≤ r`), the pruned branches (an open stub and a loaded
branch differ only there), and the topology of paths that are `undefined (via | loop | pour)` today
(Astra Q2). All of it exists inside `net-path-graph.ts`; none of it is in `NetPath`. The extension
is a public graph product beside `NetPath`, with `lengthMm` and its siblings untouched.

There is no universally correct centreline through a pad or a plane: current spreading is not
determined by the clipped trace. A delay model crossing terminal copper declares its port
convention and its approximation, or reports that contribution as unresolved. Restoring clipped
trace length as if it were the path through the land invents a route (Astra, strongest concern).

### 3.2 Join, never rename

A delay or impedance target is a NEW optional field or a NEW union member (`target: { kind:
"delay"; … }`), never a renamed or re-purposed mm field. A ps or Ω verdict is reported through a
NEW measurement channel joined to `measuredMm` / `requiredMm` with an explicit quantity and unit,
under a DISTINCT code wherever the measurement's meaning differs. Where one code can produce
several results for one net or pair (per receiver, per target), the results carry DISTINCT anchors
— ids never hash the measure, so identical code + anchors + layer collide (critique #7, Astra Q1 /
Q7). `DIFF_PAIR_SKEW` stays a length difference in mm.

### 3.3 Nominal is not finished

`designRules.electrical.copperWeightOz` / `innerCopperWeightOz` are the NOMINAL declared weight
(13 §5). They never silently become a finished copper thickness, and `TRACE_CURRENT_WIDTH` keeps
reading them until a session owns that change (critique #12). Per-layer plating thickness does not
establish via-WALL plating; 13 §5's refusal to judge barrel current stands (Astra Q4).

### 3.4 Reference planes are derived candidates; intent is declared elsewhere

Copper on the nearest adjacent layer identifies CANDIDATE reference conductors, never an
authoritative reference. Coverage counts traces, pads and via lands as well as pours; islands of
different zones may be one connected conductor; a candidate must be connected copper of a known
net, not a floating island or sparse routing. An antipad is a real absence of copper and is not by
itself a failed return path; continuous projected coverage does not prove a connection to the
relevant return ports (Astra Q5).

Reference identity is DERIVED from zones, pours and S1 connectivity. A layer `role` is at most a
non-authoritative export / UI hint — a second truth about what a layer "is" is exactly what this
program removes (critique #5). When a check judges whether a signal uses its REQUIRED reference,
that intent belongs to nets, pairs or classes; a per-layer declaration is too coarse (one inner
layer split between three plane nets is normal).

The coverage index — "which copper of which net covers this span on layer L" — is built over the
DRC context's filled geometry (`ctx.pourResults()`) plus the copper items; its home is
`src/shared/drc/` beside the context, not the connectivity kernel, because filled islands exist
only there. A reference change at a via needs more than the signal's own subtree: the local
candidates on both layers, their connected regions, local splits and antipads, and the stitching
vias or components that join the two references.

### 3.5 Broadside coupling is a new measure

14 §4's `coupled` / `tight` / `wide` are same-layer edge-to-edge gap measures. A broadside
partner's gap is a dielectric thickness; pushed through 14 §4 it would read `tight` along the whole
span. Broadside coupling gets NEW codes and a NEW measure and leaves 14 §4 and `golden-si-2l`
alone (critique #6). The 15° gate is a geometric classification, not a claim that coupling
vanishes beyond it (Astra Q7).

### 3.6 Extended nets are a composition

Length or delay through series parts is a composition over per-net GRAPHS with component
pin-to-pin data and selected endpoints. Summing per-net `lengthMm` totals is wrong wherever a
local net has branches outside the selected route or too few terminals to be `defined` (Astra Q2).

### 3.7 Stitched and parallel copper get a result variant, not a number

14 §2.4 returns `undefined (loop)` for two stitching vias or a parallel return — a normal
high-speed construction. That verdict stays: it is a route-LENGTH rule. A physical model extends
the result vocabulary (a new variant or reason) and never adopts a shortest-path reading (critique
#8, Astra Q7). Note the rule is record-sensitive: two coincident trace records are a `loop`, though
they are one piece of copper; a physical connectivity model unions coincident copper while the
legacy verdict is preserved.

### 3.8 Stack-up numerics

Stack dimensions are mm floats, like every board rule. Determinism needs more than a fixed
summation order: each declared thickness is canonicalised ONCE on a declared grid with a stated
rounding rule (a positive thickness that would collapse to zero is a reported problem), elevations
accumulate exactly in physical order (copper mid-planes on half-grid units), conversion to mm
happens at the output boundary, and the content digest hashes the SAME canonical inputs the
measurement uses — otherwise two boards in one digest bucket can differ in a verdict (Astra Q6).
The dielectric sequence is ordered top → bottom and normative; "input-order independence" never
permutes it.

## 4. The stack-up brief handed to S15b

S15b owns the persisted model. S15 fixes what it may and may not be:

1. **Shape.** Copper records top → bottom; per adjacent pair an ORDERED sequence of dielectric
   items, each with its own thickness, kind, material, Dk and Df (`docs/designer/pcb-standards.md`
   §6.2 — "a place to be better than KiCad"); optional mask items above `F.Cu` and below `B.Cu`.
   Asymmetric builds are legal data. Replacing a sequence by an averaged Dk is forbidden.
2. **Copper.** Nominal base weight, added plating and declared finished thickness are three
   quantities (§3.3). Weight alone is not geometric ground truth; the oz → mm conversion is the
   sourced 1.378 mil/oz of 13 §6 and nothing else, and a DECLARED per-layer thickness overrides it:
   JLCPCB's templates give 0.5 oz inner copper as 0.0152 mm (copper loss in production), not the
   0.0175 mm the conversion yields. Pressed prepreg thickness likewise differs from the sheet's
   nominal (0.2104 vs 0.21844 for 7628) — the stack-up stores the pressed value.
3. **Unknown is not zero.** An omitted mask, plating or Df is unknown. Validity is PER QUANTITY: a
   missing Df must not void elevations; a missing geometric thickness does (Astra Q4).
4. **Material properties are qualified.** Dk and Df are dimensionless and each carries its own
   frequency qualifier; an unqualified value stays unqualified. No material library, no default
   Dk: `/eda-standards` holds no sourced dielectric value today (its "εr ≈ 4.2–4.6" line is
   unsourced and must not be used).
5. **`boardThicknessMm` stays authoritative as a mechanical requirement — a NOMINAL with a fab
   tolerance, not a geometric sum.** Sourced 2026-09-18 (`sources/jlcpcb-stackup-2026-09-18.md`):
   JLCPCB states ± 10 % (≥ 1.0 mm) / ± 0.1 mm (< 1.0 mm) and does NOT state which surfaces bound the
   finished thickness; its own impedance templates sum (copper + dielectric) to −10.8 % … +10.4 % of
   their nominal (`JLC04161H-7628`: 1.5862 for 1.6). So a declared stack-up's sum is derived and
   never overrides the nominal, is never redistributed across gaps, and a disagreement is a reported
   problem ONLY outside the fab's stated tolerance — inside it, it is a normal build. The model must
   not need to know whether the mask is inside the nominal: elevations are measured between copper
   layers, and every axial length on a declared board comes from the declared items, never from
   `boardThicknessMm`.
6. **One additive axial metric per declared board.** With copper layer `i` occupying `[a_i, b_i]`
   and tap elevation `c_i = (a_i + b_i) / 2`, the axial length between layers is `|c_j − c_i|` —
   additive over ordered taps. It is NOT compatible with "a through via is `boardThicknessMm`":
   `L(F, In2) + L(In2, B) = c_B − c_F = D_Cu − (t_F + t_B) / 2`, and no choice of origin repairs a
   hybrid (Astra Q3, verified). So: a board WITHOUT a valid declared stack-up keeps 14 §2.5
   verbatim (through outer-to-outer = `boardThicknessMm`, everything else `undefined (via)`); a
   board WITH one uses the additive metric for ALL its vias, through vias included. That moves
   `viaLengthMm` only on boards whose user declared a stack-up — a release-note event, no golden.
7. **Stub.** An unused barrel branch attached to the active network at ONE end is a candidate stub;
   its termination and further contacts decide open versus loaded; a branch attached at both ends
   is an alternate connection. The record is a branch inventory, never "the longest unused run".
   Back-drilling removes copper — it is absent conductor, not a stub — and needs its own
   declaration; `fromLayer` / `toLayer` is a nominal span.
8. **Import and authoring.** KiCad `(general (thickness))` and `(setup (stackup …))` are read by
   the in-tree board parser (no shared-tag dependency); today every imported board is 1.6 mm.
   Without an authoring surface a stack-up arrives only by import — so S15b INCLUDES a minimal
   stack-up editor (user decision 2026-09-18), and S15b runs BEFORE S16 (same decision).
9. **Digest.** The stack-up enters the content digest conditionally, so undeclared boards keep
   their digest.

## 5. Non-goals

No field solver, 2D or 3D. No impedance calculator, no propagation-delay number, no crosstalk
estimate, no automated high-speed routing, no material database, no fab stack-up catalogue. No new
DRC code and no golden change in S15.

## 6. Open product questions (recorded, not decided)

1. Is "delay" routed-copper delay, tap-to-tap interconnect delay, or pin-to-pin delay through
   lands and components? (§3.1's port convention depends on it.)
2. Is reference analysis descriptive (list the possible return conductors) or normative (a
   required reference net per net / pair / class)?
3. Decided in principle, by the program's "precise modest claims" rule: an impedance check whose
   closed-form formula does not apply to the declared arrangement reports UNRESOLVED; it never
   substitutes an averaged or default value.

## 7. Registered findings (owners in `OPEN_FINDINGS.md` "S15")

1. **A 6+-layer board exported F.Cu / B.Cu Gerbers only** while the job file claimed the full
   `LayerNumber` (`export/index.ts`: inner layers were emitted only for `layerCount === 4`;
   reachable through KiCad import; filed as a limit in 10 §0). CLOSED fail-closed in S15: the export refuses `layerCount > 4`
   with 422 `export-unsupported-layer-count`, the precedent being 10 §5.1's non-through-via
   refusal. Both refusals are now READABLE: the export dialog shows the reason in the preview and
   disables Export (it rendered nothing for a failed preview), and the assistant / MCP
   `designer_export_manufacturing` tool returns `ok: false` with the reason instead of throwing
   (R1 #8 / #9). Real multilayer emission: export backlog.
2. The 3D preview draws every inner-layer trace on the `B.Cu` plane, skips inner pours, draws every
   via full-depth, and never receives the board's own thickness. Owner: 3D backlog.
3. `PcbLayerTabStrip` knows `In1.Cu` / `In2.Cu` only. Owner: the 4-layer UI backlog item.
4. The cloud snapshot caps the stack at 2 / 4 layers with a private layer-order copy
   (`board-snapshot.ts`). Cross-repo; owner: cloud session.
5. Five literal `1.6`s bypass `DEFAULT_BOARD_THICKNESS_MM` (`pcb-defaults.ts`, the assistant read
   tool, `PcbBoardPanel.tsx`, `PcbDesignRulesDialog.tsx` ×2). Same value today; owner S15b.
6. KiCad board import never reads the board thickness or the stack-up block, and drops the parsed
   layer `type`. Owner S15b.

## 8. Ledgers

### 8.1 Plan-critique (opus `Plan`, 24 findings, 6 blockers)

Accepted and folded: #3 (row split: persisting blocked / consuming expensive; the "seven pour-list
copies" analogy dropped), #4 (parser erasure — §2.1), #5 (§3.4), #6 (§3.5), #7 (§3.2), #8 (§3.7),
#9 (§7.4; snapshot untouched), #10 (the seam-only tier was dominated and dropped), #11 (tier T1+
now, stack-up as its own session — the user's decision), #12 (§3.3), #13 / #14 (§4.1–§4.4), #15
(§4.5, §3.8), #17 (§4.9), #20 (derivations live in `src/shared/`, kernel tests under
`src/core/backend/tests/`), #23 (decisions taken by the plan), #24 (rule-family edits are not
undoable — `pcb_set_design_rules` emits no inverse patch; recorded boundary, applies to a future
stack-up edit too). Overruled: #1 and #2's BLOCKED verdict on `NetPath` (§2.2) — their content
survives as §3.1's required graph product and §4.6–§4.7. Moot in the T1+ scope: #16, #18, #19, #21,
#22 (they bind S15b: the `viaLengthMm += boardThicknessMm` identity, the `STACKUP_INVALID` anchor
and the `CORPUS_EXCEPTIONS` literal, WP file ownership, the five extra gates).

### 8.2 Astra run 0 (GPT-6-Astra, brainstorm, xhigh, prompt-only, 2026-09-18)

Every claim below was checked against source or derived by arithmetic before acceptance.
Q1 most items additive, parser erasure the clear loss, preservation must be nested and can go
stale — accepted (§2.1). Q2 the proposed per-via and clipped-span records are insufficient and
unnecessary; the graph is the product; pre-rejection topology matters — accepted (§2.2, §3.1). Q3
the hybrid via length is non-additive; mid-plane taps; stub as an inventory; nominal span is not
drill termination — accepted, verified by the identity in §4.6; Astra's "keep the legacy value in
a separate channel" is refined to a per-board regime (§4.6), since no board declares a stack-up
today. Q4 no listed material field forces a breaking change later, their MEANINGS must be fixed
now; validity per quantity; plating ≠ via-wall plating — accepted (§3.3, §4). Q5 nearest pours are
candidates; intent per net / pair / class; a reference change needs data outside the signal
subtree — accepted (§3.4). Q6 canonical grid, exact accumulation, digest over the same inputs —
accepted (§3.8); the digest-bucket caching risk is bounded today: the content digest validates
cloud candidates only and keys no analysis cache. Q7 preserve the existing definitions, add
physical measures beside them; coincident records are one conductor physically — accepted (§3.5,
§3.7). Blind spots carried to S15b: what `diameterMm` / `drillMm` physically denote (land, finished
bore, wall); the 100 nm fill grid against integer-nm copper at tiny contacts; a stack disagreement
tolerance must be sourced, not invented.

### 8.3 R1 (`reviewer-critical`, executed probes, 9 findings)

Held under probe: no missed writer (eight in `pcb-store.ts`, two in the KiCad importer; no
duplicate / cloud-pull / capture path writes settings); no resurrection of a deleted parseable row
or an emptied key (the rescue predicate IS the read predicate); rescued rows never reach a DRC
report and never multiply; the typed projection and the eleven goldens are untouched; undo / history
replay keeps carried keys; no mutation, no aliasing, no prototype pollution. Fixed: #1 (high)
index-paired scopes moved a newer build's per-scope keys onto another scope → content pairing; #3
`viewState` internals were still erased → carried; #4 id-less / non-string-id / duplicate-id
unparseable rows were dropped and a rescued net class lost its assignments → every unparseable row
rescued, assignments carried; #6 a stored key named `__proto__` was dropped; #8 / #9 the export
refusal was invisible in the dialog preview and escaped the assistant tool as an exception.
Recorded as limits (§2.1): #2 known key with an unparseable value, #5 the repair path's stale
block, #7 integer-only version stamps.

### 8.4 Source research for S15b (2026-09-18, after the S15 commit `0f7c002`)

The user asked for a JLCPCB reference for §4.5's open question. Result in
`sources/jlcpcb-stackup-2026-09-18.md`: the capability page and the impedance templates (read
through the archived API JSON, 40 of 577 templates sampled) show the nominal thickness is a label
with a ± 10 % / ± 0.1 mm tolerance and no stated bounding surfaces — §4.2 and §4.5 amended
accordingly. Also sourced: per-construction Dk values, mask Dk 3.8 and ink ≥ 10 µm, average hole
plating 18 µm (the via-wall quantity 13 §5 lacked — an average, not a minimum), inner copper
0.5 oz by default at JLCPCB (filed S15-10: OpenPCB's inner weight falls back to the outer one).

