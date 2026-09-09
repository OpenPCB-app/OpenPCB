# Session 3a — zone / keepout semantic contract

> Status: **implemented, Astra-attacked and amended** (S3a, 2026-09-07); **§12 authoring + board-fill
> storage migration implemented** (S3b, 2026-09-07, generic review only); **§13 legality integration
> implemented and Astra-verified** (S4, 2026-09-07). Companion to
> [`PROGRAM.md`](PROGRAM.md) (S3a row), [`00-ground-truth.md`](00-ground-truth.md),
> [`01-connectivity-contract.md`](01-connectivity-contract.md) and
> [`02-geometry-contract.md`](02-geometry-contract.md). This document is the authoritative answer to
> "what does a copper zone or a keepout mean in OpenPCB". S3b (authoring tools), S4 (legality
> integration) and S5 (pour correctness) consume it; they do not redefine it.

## 0. Scope and non-goals

S3a defines the data model, persistence, import mapping, the single derivation every consumer
reads, and the single predicate that answers "does this keepout affect this object?". It ships the
predicate with tests but does **not** wire it into DRC, routing or the fill (S4), does not add
commands or tools (S3b), and does not harden the fill algorithm (S5). Breaking changes to the
persisted shape are deliberate: the legacy `PcbZone` was import-only, never authored, and half of
its fields were silently dropped on load.

## 1. Vocabulary and domain

- **Copper zone** (`PcbZone`) — a region of **one** copper layer that is filled with copper of
  **one** net, or of no net. Zones make copper.
- **Board zone** — a copper zone whose region is the whole board. Today's per-layer "copper fill"
  toggle is a board zone; there is at most one per layer.
- **Keepout** (`PcbKeepout`, KiCad "rule area") — a region on a **set** of copper layers where
  selected object classes are forbidden. Keepouts make rules, never copper.
- Both are **simple polygons in millimetres** (unquantised doubles, like outlines, cutouts and pads;
  trace points stay integer nanometres). No arcs: KiCad arc vertices are flattened at import
  through the S2 contour flattener with a **safe bias per arc** — `bias: "inward"` for a zone (the
  polygon is a subset of the drawn region: never more copper), `bias: "outward"` for a keepout (a
  superset: never a smaller forbidden area). The side is decided per arc from the contour's exact
  orientation (S2 §4), never from the object kind alone — an inscribed chord across a concave notch
  would otherwise *add* copper into the notch (Astra finding 8).
- Every boundary predicate uses `GEOM_EPS_MM = 5e-7` (S2 §1) and the S2 kernels; nothing here
  introduces a second epsilon or a second point-in-polygon.

## 2. Data model (v2)

```ts
type PcbZoneRegion = { kind: "board" } | { kind: "polygon"; pointsMm: PcbPointMm[] };
type PcbZonePadConnection = "solid" | "thermal" | "thruHoleThermal" | "none";
type PcbZoneIslandRemoval = "always" | "never" | { minAreaMm2: number };

interface PcbZone {
  id: string;
  name: string | null;
  enabled: boolean;
  lockedAt: string | null;
  layer: PcbCopperLayerId;              // one zone = one layer
  netId: string | null;                 // persisted; see §3.2 for null
  netName: string | null;               // import hint, bound to netId at projection time
  region: PcbZoneRegion;
  priority: number;                     // integer ≥ 0; higher fills first
  padConnection?: PcbZonePadConnection; // absent = board default
  clearanceMm?: number | null;          // tighten-only override, §6
  minWidthMm?: number | null;           // tighten-only override, §6
  thermal?: { gapMm: number; spokeWidthMm: number } | null;
  islandRemoval?: PcbZoneIslandRemoval; // absent = board default
}

interface PcbKeepout {
  id: string;
  name: string | null;
  enabled: boolean;
  lockedAt: string | null;
  layers: PcbCopperLayerId[];           // non-empty; copper layers only in v1
  pointsMm: PcbPointMm[];
  restrictions: {                       // true = forbidden inside the keepout
    tracks: boolean; vias: boolean; pads: boolean; copperPour: boolean; footprints: boolean;
  };
}
```

Removed from v1: `fillType`, `hatchEdgeMm` (read by no consumer; a KiCad hatched fill is imported
as solid with a warning), `connection` (renamed `padConnection`, and now actually persisted).
`DesignerPcbProjection` gains `keepouts: PcbKeepout[]`.

### 2.1 Persistence and the read-time upgrade

Both live in `designer_pcb_entities` as JSON payloads: kind `zone` (v2 payload) and the new kind
`keepout`. Migration `0018_pcb_zone_v2_keepouts.sql` is a marker (`SELECT 1;`), as `0009` was. One
function, `upgradePcbZoneRecord(unknown) → { zone | null, warnings }` in
`src/shared/pcb-areas/zone-parse.ts`, is the only reader of a zone payload (used by `pcb-store`,
the golden-fixture loader and any future paste/import path). A v1 row is recognised by the absence
of `region`:

| v1 field / situation | v2 result |
|---|---|
| `polygonPointsMm` | `region: { kind: "polygon", pointsMm }` |
| `priority` missing / non-finite / negative / fractional | `0` (fractional → `floor`, negative → `0`) |
| `connection` | `padConnection` |
| `netId` present | kept (v1 loads dropped it — a defect) |
| `name`, `lockedAt` missing | `null` |
| `enabled` missing | `true`, **except** a v1 row with `netName` empty or null **and** no `netId` → `enabled: false` + warning `zone_legacy_netless_disabled`. Such a row is either a KiCad rule area imported before S3a or a net-0 zone; it must never start pouring copper because the data model changed. |
| `fillType: "hatched"` | dropped + warning `zone_hatched_fill_as_solid` |
| `hatchEdgeMm` | dropped silently (display-only in KiCad) |
| `region.kind === "board"` **persisted** | accepted (S3b): a board zone is a persisted row whose `id` must equal `board:<layer>`; the derivation (§3.1) skips a board row with any other id with `zone_board_id_mismatch`. Board rows are written by `pcb_add_zone` / the layers-panel toggle and by the one-time legacy-fill migration (§12.1) |
| `id` missing, `layer` not a copper-layer id, points unparsable | row rejected (`null`), as v1 |
| `clearanceMm` / `minWidthMm` non-finite or negative | field dropped |
| `thermal` with a non-finite or non-positive member | field dropped |
| `islandRemoval` malformed | field dropped |

Ring validity is **not** judged at parse time (a persisted invalid ring is data the user can fix);
the derivation (§3.1) skips it with a warning. A zone row with fewer than three parsable points is
rejected, as in v1. Keepout rows: `parsePcbKeepoutRecord` rejects a row with no `id`, an empty
`layers` list or one containing a non-copper id, or fewer than three parsable points — persistence
is strict; the import path (§8) is the one that filters and warns.

## 3. Semantics

### 3.1 The derivation — one list of effective copper zones

`collectCopperZones({ zones, layerCount, knownNetIds? }) → { zones: EffectiveCopperZone[], warnings }`
in `src/shared/pcb-areas/copper-zones.ts` is the **only** place that decides which copper areas
exist. Since S3b it reads persisted zone rows only — there is no view-state input and no legacy
board-fill policy; the per-layer copper fill is a persisted **board zone** row (§12.1). (S3a
synthesized board zones from `viewState.copperFillLayers` through `applyLegacyBoardFillPolicy`;
both are gone.)

- **Gate order per row** (total, so the warnings are stable): `enabled: false` → skipped silently;
  an id shared by more than one enabled row → every holder skipped with `zone_id_duplicate`; then a
  **board row** (`region.kind === "board"`): `id !== "board:<layer>"` → `zone_board_id_mismatch`;
  layer off the stackup (`copperLayersForCount(layerCount)`) → `zone_layer_off_stackup`; stale
  `netId` → `zone_net_stale`; unresolved `netName` → `zone_net_unresolved`; `netId` null →
  `board_zone_no_net` (a board zone whose net is unset is **not** net-less copper — nobody drew it
  with that intent; it pours nothing); otherwise it enters with `sourceKind: "board"`,
  `priority = −1` (forced, whatever the row says — explicit priorities are integers ≥ 0) and its own
  `padConnection` / overrides. Then a **polygon row** whose id starts with the reserved `board:`
  prefix → `zone_id_reserved`; then the polygon path: stale `netId` → `zone_net_stale`; layer on
  the stackup (else `zone_layer_off_stackup`); valid ring (§3.3; else `zone_ring_invalid`);
  unresolved `netName` → `zone_net_unresolved` (§3.2). Net-less polygon zones (`netId` and
  `netName` both null) enter with `netId: null`.
- **Order** (total, deterministic; pour keys `pour:<layer>:<net>:<pourIndex>:<island>` depend on
  it): explicit zones by `priority` descending, then `id` ascending; then board zones by stackup
  index. Two calls with the same inputs, or with the input arrays permuted, return deep-equal
  output.
- `EffectiveCopperZone = { id, sourceKind: "board" | "zone", layer, netId, region, priority,
  padConnection, clearanceMm?, minWidthMm?, thermal?, islandRemoval?, name }` — `padConnection`
  is `zone.padConnection ?? "solid"` (the constant default, §6), so consumers never consult any
  board-level setting; the design-rule compositions of §6 (`max(board, zone)` for clearance and
  minimum width, kernel defaults for thermal and island removal) live in one helper,
  `pourParamsForZone(zone, designRules, keepouts)`, that every fill call site uses. Keepouts get
  `keepout_ring_invalid` / `keepout_layer_off_stackup` and are ordered by id. Ordering comparisons
  are plain code-unit comparisons, never locale-aware. Producers cannot break the order: a
  non-finite or fractional `priority` is normalised (`floor`, `≥ 0`, non-finite → 0) before
  sorting; the `warnings` array is sorted (code, id, detail) so the whole result is
  permutation-invariant. An empty-string net id is `null`.

`collectKeepouts({ keepouts, layerCount }) → { keepouts, warnings }` is the keepout twin: enabled,
valid ring, `layers` intersected with the stackup (empty → skipped with `keepout_layer_off_stackup`).

### 3.2 Net binding

Persisted `netId` wins. Otherwise `netName` is bound case-insensitively to the schematic's net ids
at projection time, exactly as traces and vias are. Three outcomes:

| `netId` | `netName` | meaning |
|---|---|---|
| set | any | pours that net |
| null | resolves | pours the resolved net |
| set, but no current net has that id | any | **unbound** — pours nothing, warning `zone_net_stale` (`collectCopperZones` receives the schematic's net-id set as `knownNetIds`; a deleted net must not keep pouring a phantom) |
| null | set, does not resolve | **unbound** — pours nothing, warning `zone_net_unresolved` (a renamed or deleted schematic net; the copper must not silently become floating) |
| null | set, resolves to **more than one** net (names equal case-insensitively) | **unbound** — pours nothing, warning `zone_net_ambiguous`; a first-match choice would make the zone's net depend on net order (Astra finding 9) |
| null | null / empty | **net-less copper** — pours; keeps clearance to every net's copper; joins no net graph (S1: null-net items never join a component); never a routing target; no `ISOLATED_COPPER_ISLAND` (there is no net to be isolated from) |

### 3.3 Ring validity (zones and keepouts)

`zoneRingValidity(points)` — one function, the same tests the board outline uses (S2 §6): at least
three finite vertices after `canonicalizeRing`, no inclusive self-intersection
(`ringSelfIntersects`), `|area| ≥ DEGENERATE_AREA_MM2` (strict `<` rejects, the outline check's
sense). `checkOutline` keeps its own outline-specific sequence (cutout containment, biased rings)
but shares the kernels; folding it onto `zoneRingValidity` is S4/S7 housekeeping. Import drops an invalid ring with a
warning; the derivation skips a persisted one with a warning; S4 adds the DRC code.

### 3.4 Zone copper extent

The copper a zone may produce is `R_zone = int(polygon) ∩ R_board⁻`, where `R_board⁻` is the S2
board region inset by the copper-to-edge clearance (cutouts inflated by the same amount). A board
zone's extent is `R_board⁻` itself. A zone polygon may extend off the board or over a cutout; only
the intersection pours. A zone whose extent is empty pours nothing (S4 warns). **S5:** the kernel
builds `R_board⁻` from `buildBoardRegion(outline, cutouts, { bias: "board-inner" })` with one round
inset (`04-copper-pour-contract.md` §3.1); a polygon zone's extent also excludes its hole rings
exactly (§11 there).

### 3.5 Enabled / disabled

`enabled: false` zone → no copper anywhere: no fill, no connectivity node, no Gerber, no snapshot
pour, no DRC island check. The canvas draws a disabled polygon zone's ring as a dashed ghost so the
intent stays visible, and an enabled polygon zone's ring as a thin solid line under its fill
(`ZoneOutlineLayer`, S3b; S3a drew nothing for a disabled zone). `enabled: false` keepout →
affects nothing anywhere; the canvas draws it dimmed. Disabled objects are not warnings — they are
intent.

## 4. Keepouts — "does this keepout affect this object?"

A keepout `K` (ring, layers `Λ`, restrictions) is the **open interior** of its polygon on each
layer in `Λ`. Touching the boundary is allowed — a keepout has clearance 0, so copper whose edge lies
on the boundary (within `GEOM_EPS_MM`) is legal. "Strictly inside" below means
`strictlyInsideRing(p, K, eps)`: inside by ray cast **and** farther than `eps` from every edge.
`keepoutAffects(K, item) → boolean` in `src/shared/pcb-areas/keepout-predicates.ts` is the only
implementation; DRC (S4), the commit gate (S4; since S8 through `keepoutItems` inside `checkPendingCopper`, client and server) and the fill (S4/S5) call it. Routing may
use a conservative superset (an AABB obstacle) for avoidance, never a subset.

| item (mm) | affected iff |
|---|---|
| trace segment `ab`, layer `L`, width `w` | `restrictions.tracks` ∧ `L ∈ Λ` ∧ `stadiumOverlapsRing([a,b], w/2, K)` |
| via, span `S`, copper diameter `d`, centre `c` | `restrictions.vias` ∧ `S ∩ Λ ≠ ∅` ∧ `discOverlapsRing(c, d/2, K)` (the pad diameter, not the drill — the barrel's copper is what the rule forbids) |
| pad, copper layers `P`, world ring (exact disc for circle pads) | `restrictions.pads` ∧ `P ∩ Λ ≠ ∅` ∧ `ringsOverlapPositiveArea(pad, K)` (disc → `discOverlapsRing`) |
| placement (`footprints`) | `restrictions.footprints` ∧ the outer copper layer of the placement's side (`F.Cu` top, `B.Cu` bottom, `placementSideLayer`) `∈ Λ` ∧ `ringsOverlapPositiveArea(extent, K)`, where `extent` (resolved by `placementKeepoutExtentMm`, S4) = the courtyard hull when the footprint carries one (preview graphics, else the raw KiCad footprint when a lookup is available), else the footprint-local bounds rectangle of every pad **and** every footprint graphic (silk / fab strokes; `preview.bounds`, labels excluded) transformed to world by the pad transform (rotation, mirror, position), else the bounding box of the placement's pad rings, else no extent (the placement is not evaluated). Every branch is a declared **superset** of the physical part, so the verdict errs towards "affected"; a pad-only hull is not acceptable because it misses the body (Astra finding 14). A keepout on inner layers only never affects a placement through this restriction. The predicate takes the extent pre-resolved. |
| copper pour (`copperPour`) | every effective zone on `L ∈ Λ` has `int(K)` removed from its extent, regardless of priority. The kernel subtraction landed in S3a (`pourParamsForZone(zone, rules, keepouts)` → `excludePolygonsMm` → the kernel's `subtractKeepouts`), because a keepout the canvas draws but the Gerber ignores would be a displayed-but-unenforced rule (Astra finding 2). **Correction (S4):** S3a wired the keepouts into the canvas and the 3D preview only. The Gerber writer, the snapshot pours, the DRC island check and `pcb_cleanup_pour_traces` called `pourParamsForZone` without them, and the connectivity pours (projection ratsnest and DRC) passed them into `boardPourSpecs` whose `BoardPourSpec` never declared `excludePolygonsMm`, so `pourItems` dropped the field — until S4 made the parameter required and the spec forward it (§13.3). The subtraction inflates each keepout ring by one output-grid step (`10^-PRECISION` = 0.1 µm) before subtracting, so nearest-grid rounding of the result never lands inside the keepout (Astra finding 7); the residual error is ≤ one grid step *outside* the keepout. |

Predicates (`src/shared/pcb-geometry/area-overlap.ts`, all on the S2 kernels, eps = `GEOM_EPS_MM`):

- `stadiumOverlapsRing(polyline, hw, K)` ⇔ `hw > eps` ∧ (some polyline vertex is strictly inside
  `K`, **or** `polylineToRingEdgeDistance(polyline, K) < hw − eps`). Complete for `hw > eps`: a
  stadium whose centreline is nowhere strictly inside and stays ≥ `hw − eps` from `∂K` has no
  interior point in `int(K)`; a centreline that enters `K` crosses `∂K` (distance 0). For `hw ≤ eps`
  the interior is empty (degenerate copper, S1) and the answer is false.
- `discOverlapsRing(c, r, K)` ⇔ `r > eps` ∧ (`c` strictly inside `K`, or `pointToRingEdgeDistance(c, K) < r − eps`).
  A disc or stadium with `r ≤ eps` / `hw ≤ eps` has an empty open interior and never overlaps —
  the predicate is total and agrees with the "degenerate items are never evaluated" rule below.
- **Eps-band tilt (implementation fact, pinned by tests).** `polylineToRingEdgeDistance` is built on
  `segmentToSegmentDistance`, whose inclusive `segmentsIntersect` short-circuit returns exactly 0
  for a centreline within `eps` of `∂K`, so the stadium clause is fail-**closed** on the eps band; the
  point projection behind `discOverlapsRing` is exact, so the disc clause is fail-**open** for a centre
  inside `K` within `eps` of `∂K` when `eps < r ≤ 2·eps`. Both errors are ≤ 2·eps (1 nm) and below any
  manufacturable feature; neither is a licence to widen the band. `ringsOverlapPositiveArea` assumes
  simple rings — a self-intersecting ring with non-zero signed area gets a definite orientation and
  the collinear-shared-edge branch may then misjudge the interior side; `zoneRingValidity` (§3.3)
  rejects such rings before any predicate sees them.
- `ringsOverlapPositiveArea(A, K)` ⇔ `holeInteriorMeetsRing(A, K) ∨ holeInteriorMeetsRing(K, A)`
  (S2 §5: a vertex strictly inside the other ring, a sub-segment midpoint — split at every contact
  parameter — strictly inside, or a collinear shared piece whose interior sides agree). Both
  directions are needed: `A ⊂ K` has no `A` vertex outside but every `A` vertex strictly inside
  `K`; `K ⊂ A` is the mirror. Identical rings overlap (collinear pieces, agreeing sides); rings that
  only touch at a vertex, share an edge with opposite interiors, or are tangent do not. Degenerate
  orientation is fail-closed (`interiorSidesAgree` returns true), i.e. "affected".

Layer rules: a trace is on exactly one layer; a via occupies every layer of its span (S1 §2); a
pad's copper layers follow `resolvePadCopperLayers` (S1 §2) — a plated through-hole pad is on every
layer, so an inner-layer keepout with `pads` affects it; an SMD pad on the opposite side is not
affected. Keepouts are not clipped to the board; the off-board part of a keepout is inert.

Degenerate items are never evaluated: a trace with `w/2 ≤ eps`, a via with `d/2 ≤ eps`, or a pad /
hull ring with fewer than three vertices or `|area| < DEGENERATE_AREA_MM2` is not copper (S1 §2) and
produces no item, so `keepoutAffects` is never asked about it — the structural checks own such data.
`keepoutAffects` is nevertheless total: it canonicalises every ring it receives and returns false
for a degenerate or self-intersecting ring (item or keepout) and for non-finite coordinates.
(The fail-closed branch of `interiorSidesAgree` would otherwise report a zero-area sliver *outside*
the keepout as affected.) The fill kernel quantises its output to `PRECISION = 4` (0.1 µm); the
predicate is never applied to filled copper — the `copperPour` restriction is enforced by exact
subtraction, not by testing fill output against `int(K)`.

## 5. Precedence and overlap between zones

Semantics fixed here; enforcement is S4 (`ZONE_OVERLAP`, narrowed in S5 to equal-priority pairs)
and S5 (fill subtraction — `pourParamsForZone(zone, rules, keepouts, zones, nets)` emits
`excludeZonesMm`, `04-copper-pour-contract.md` §3.3).

- Zones on **different layers** never interact.
- **Same layer, different nets, different priorities:** the higher-priority zone fills first; the
  lower-priority zone's extent excludes the higher-priority zone's **polygon** (not its fill —
  order-independent and independent of the other zone's obstacles) inflated by
  `max(clearance_lower, clearance_higher)` (each zone's resolved clearance, §6).
- **Same net, any priorities:** no exclusion; the fills merge where they overlap (S1 §3
  island–island touch already unions them).
- **Same layer, different nets, equal priority:** each zone's extent excludes the other's polygon
  inflated by `max(clearance_a, clearance_b)` — symmetric, so the contested region and a clearance
  band around it belong to neither fill (no copper where the design is ambiguous). Positive-area
  polygon overlap additionally reports `ZONE_OVERLAP` (S4, error). Polygons that only touch, share
  an edge, or sit closer than the clearance are *legal as data* but their fills are still kept apart
  by the exclusion — two different-net fills never meet at an edge or a corner (Astra finding 3).
  Every exclusion is computed from the immutable original polygons, so the result is independent of
  evaluation order.
- **Board zones** rank below every explicit zone on their layer — an explicit zone of another net
  always carves the board plane around itself; a same-net explicit zone merges into it. Two board
  zones never share a layer.
- A keepout with `copperPour` is subtracted after all of the above, from every zone.

## 6. Overrides and their composition

| field | resolution |
|---|---|
| `padConnection` | zone value, else the constant default `"solid"` (S3b removed the view-state board default; a board zone carries its own value like any other row). `"solid"` floods the pad; `"thermal"` relief with spokes; `"thruHoleThermal"` = thermal for drilled pads, `"none"` for undrilled (SMD) pads; `"none"` = same-net pads are treated as **different-net** copper (excluded with clearance). `"none"` therefore removes those pads from island membership and can add airwires / `UNCONNECTED_NET` — that is the electrically correct answer, not a regression. |
| `clearanceMm` | `max(board fill clearance, zone value)` — tighten-only, like every clearance in this repo. A KiCad zone clearance below the board rule cannot pour closer than the board allows. **S5:** the fill resolves `max(zone tier, class(pour net), class(item net), floor)` per obstacle net — the implicit net-class tier the DRC uses. **S6:** the zone value is `max`-ed with the one rule resolver's pour pair kinds (`05-rule-semantics-contract.md` §6); scoped rules reach a fill only through an explicit pour `pairKind` scope. |
| `minWidthMm` | `max(designRules.minimums.traceWidthMm, zone value)` — tighten-only. The kernel *enforces* it on the final copper: an open/close pass removes every neck narrower than the resolved width before islands are split (Astra finding 11 — enforced, not merely resolved). |
| `thermal` | zone `{ gapMm, spokeWidthMm }`, else the kernel defaults (0.4 / 0.4 mm, 4 spokes, first spoke at 90° in the PAD-LOCAL frame — `04-copper-pour-contract.md` §6, S5). |
| `islandRemoval` | `"never"` → unanchored islands kept (min area 0); `{ minAreaMm2 }` → kept when `area ≥ minAreaMm2` or anchored; `"always"` → unanchored islands always removed; absent → board default (`minIslandAreaMm2` kernel default). |

All overrides are threaded through `CopperFillPourParams`; `"none"` and `"thruHoleThermal"` are
implemented in the kernel's bare-copper collector in the fail-safe direction (pads leave the
same-net set). The kernel's correctness beyond that is S5.

## 7. Consumers — who sees what after S3a

| consumer | zones | keepouts |
|---|---|---|
| `pcb-projection.ts` (ratsnest pours) | `collectCopperZones` (after the one-time legacy-fill migration, §12.1, and name binding) | loads `keepouts`, appends derivation warnings to `projection.warnings` |
| `command-executor.ts` `pcb_add/update/delete_zone` | the writers (§12.2): shared `zoneRingValidity`, stackup check, board-id rule, lock gate; undoable through the zone/keepout history arms | `pcb_add/update/delete_keepout` |
| `board-connectivity.ts` | `BoardPourSpec` from the effective list (existing three fields unchanged; overrides added) | — |
| `drc-context.ts` | `collectCopperZones` with `knownNetIds` (S4) for `ensureConnectivity` and the checks; the DRC-side pours pass the effective keepouts (S4) | `DrcContext.keepouts` (effective list) + `DrcContext.copperAreaWarnings` (both derivations' warnings, S4) — consumed by `checks/keepouts.ts` and `checks/zones.ts` |
| `checks/copper-pour.ts` | one loop over every effective zone (net-less included since S4); anchor `{ kind: "net" }` for board zones, `{ kind: "zone" }` for polygon zones (violation ids and waivers depend on it); a zone whose fill has no island → `ZONE_EMPTY_FILL` (§13.1) | keepouts into the fill (S4) |
| `board-snapshot-pours.ts` | effective list (`knownNetIds` since S4); `sourceId` stays `board:<layer>` / `zone.id` so `islandId` is byte-stable | `copperPour` keepouts subtract from the snapshot pours (S4); `board-snapshot.ts` warns that the autorouter ignores keepouts (wire contract untouched — §13.5) |
| `gerber/writer.ts` | **S5:** per layer, every effective zone's `ok` islands are unioned per net, merged into one list in the kernel's total order and emitted pours-first (`LPD` outer / `LPC` holes / `LPD`), each island with its own `%TO.N`; a `failed` fill or a collapsed union fails the export with a 422 problem; `padNetIds` = `projection.padNets` (`04-copper-pour-contract.md` §9). | `copperPour` keepouts subtract from every exported pour (S4; keepouts are otherwise not artwork) |
| `command-executor.ts` `pcb_cleanup_pour_traces` | **every effective zone on the trace's layer (S5; was board zones only)**, a `failed` fill skipped; `knownNetIds` since S4. "Covered" is geometric since S4: every segment stadium strictly inside ONE island's outer ring and overlapping none of its holes (Astra S4 #2) — a trace bridging two islands or crossing a thermal-relief gap is never deleted (before S4 a 99.9 % area ratio deleted both) | keepouts into the fill (S4) — a trace inside a `copperPour` keepout is never judged covered |
| `board-content-digest.ts` | whole zone objects, board rows included since S3b (a migrated board's digest rotates once) | `keepouts` by id — fail-closed rule |
| `tests/helpers/drc-golden.ts` | effective list (was the seventh copy) | — |
| `PcbScene.tsx` | one map over the effective list built from `projection.zones` (no store slice since S3b); `ZoneOutlineLayer` draws every polygon zone's ring (solid enabled / dashed ghost disabled); selection highlights and vertex grips for the selected zone | `KeepoutLayer` — hatched outline on each of its layers, non-interactive; selection highlight and grips |
| `PcbLayersPanel.tsx` | the per-layer copper-fill control **is** the board zone: toggle = `enabled`, plus net and pad-connection pickers (§12.3) | — |
| `PcbSelectionInspector.tsx` | `ZonePanel` — every §2 field; layer/region fixed for board zones | `KeepoutPanel` — layers + restrictions |
| `CopperPour.tsx` (3D) | the same effective list — zones now render in 3D and board planes only when the fill is enabled (3D and Gerber agree; before, 3D flooded both faces unconditionally) | — |
| `drc-labels.ts` | prefers `zone.name` | — |
| assistant `read-tools.ts` | count | count |
| routing / live DRC | unchanged (a zone is not an obstacle) | `route-obstacles.ts` keepout rects (`tracks`, superset), `live-drc.ts` `trace-keepout` (exact), via guard (`vias`) — §13.4 |

Legality codes: `KEEPOUT_VIOLATION`, `ZONE_OVERLAP`, `ZONE_INVALID` (supersedes the S3a-reserved name
`ZONE_OUTLINE_INVALID`) and `ZONE_EMPTY_FILL` — declared, emitted, labelled and tested together in S4
(§13; a declared-but-unemitted code is the failure mode `00-ground-truth.md` §5 warns about).

## 8. KiCad import mapping

`kicad-pcb-parser.ts` classifies every `(zone …)` node:

| KiCad token | `PcbKeepout` (when `(keepout …)` is present) | `PcbZone` otherwise |
|---|---|---|
| `layer` / `layers` | `layers`: single id, or the list; `F&B.Cu` → `[F.Cu, B.Cu]`, `*.Cu` → every copper layer of the imported stackup; non-copper ids dropped with `zone_layer_unsupported`; empty → node dropped | one `PcbZone` **per layer** (multi-layer → N zones sharing `name`, warning `zone_multilayer_split`) |
| `keepout (tracks\|vias\|pads\|copperpour\|footprints allowed\|not_allowed)` | `restrictions.* = (value === "not_allowed")`; missing → `false` | — |
| `net` / `net_name` | ignored | `netName` from `net_name`, else the ordinal table; ordinal 0 or empty name → `netId: null, netName: null` (net-less copper, §3.2) |
| `name` | `name` | `name` |
| `priority` | — | `priority` (integer ≥ 0) |
| `connect_pads [yes\|no\|thru_hole_only] (clearance x)` | — | KiCad writes the mode token only for non-default modes and its default is **thermal reliefs**, so a `connect_pads` node with no mode token → `thermal`; `yes` → `solid`; `thru_hole_only` → `thruHoleThermal`; `no` → `none`; the nested `clearance` → `clearanceMm`. A zone with no `connect_pads` node at all leaves `padConnection` absent (board default). (Corrected from the draft's "absent → solid" — needs verification against KiCad source, confidence high.) |
| `min_thickness` | — | `minWidthMm` |
| `fill (thermal_gap g) (thermal_bridge_width w)` | — | `thermal: { gapMm: g, spokeWidthMm: w }` when both present |
| `fill (island_removal_mode m) (island_area_min a)` | — | `0` → `"always"`, `1` → `"never"`, `2` → `{ minAreaMm2: a }` |
| `fill (mode hatch)` | — | warning `zone_hatched_fill_as_solid`; filled solid |
| `locked` | `lockedAt` = import timestamp | same |
| `polygon (pts (xy …) (arc (start)(mid)(end)))` | first contour; arcs flattened **circumscribed** | first contour; arcs flattened **inscribed**. A further `polygon` block that lies strictly inside the first contour is a **hole**: v1 regions have no holes, and pouring over the hole would be more copper than drawn, so the zone imports `enabled: false` with `zone_holes_unsupported` (fail-safe; hole support is filed for S3b/S5). A further block outside the first contour is a second outline and is dropped with `zone_extra_contour_dropped` (less copper than drawn — safe). Every contour, holes included, is flattened with the outline's bias; a hole would need the opposite side once holes pour (S3b/S5 must flip it when they add hole support). |
| `filled_polygon`, `fill_segments`, `hatch`, `uuid`, `placement`, hatch-style tokens | ignored | ignored |

Every warning carries a stable code and the zone `name`/ordinal. The stale
`pcb_zones_imported` message ("fill recomputation and DRC participation are not yet wired") is
removed. **KiCad behaviours relied on here — `connect_pads` mode names, `island_removal_mode`
values, `F&B.Cu` / `*.Cu` spellings, `not_allowed` — are quoted from the KiCad file format as
understood at authoring time and are marked *needs verification* until Astra or a KiCad source
confirms them. No numeric constant is invented; every mm value comes from the file.** Footprint-
embedded rule areas (`.kicad_mod` zones) are dropped by `@openpcb/kicad-parsers` and stay out of
scope (recorded in `PROGRAM.md`).

## 8a. Stated limits (from the Astra ledger)

- Keepout tolerance is eps-relaxed: copper may penetrate a keepout by up to `GEOM_EPS_MM` (0.5 nm,
  half a coordinate quantum) without being "affected". This is the same closed/open convention S2
  uses for the board edge and is far below any manufacturable feature; it is not a physical
  exclusion proof (Astra Q1).
- Degeneracy thresholds (`w/2 ≤ eps`, `d/2 ≤ eps`, `|area| < 1e-6 mm²`) are the keepout
  predicate's own; S1's item builder rejects zero-size copper. Copper between zero and these
  thresholds is unmanufacturable and is reported by `TRACE_WIDTH_MIN` / `VIA_DIAMETER_MIN` /
  structural checks, never silently exported as legal (Astra finding 6).
- `keepoutAffects` costs `O(P·V·(P+V))` per item–keepout pair in the worst case (contact
  parameters ray-cast against the keepout); candidate pairs are `O(items × keepouts)` without a
  spatial index (S9). Zone precedence is `O(Z²)` per layer and keepout subtraction `O(Z·K)`; S5/S9
  bound or accelerate them (Astra finding 18).
- `ISOLATED_COPPER_ISLAND` is reported once per zone (aggregate count, located at the largest
  island), so island identity never enters the violation id (Astra finding 13 — no collision).
- Nearly coincident rings offset by less than `eps` (Astra finding 5) ARE detected: the S2
  collinear-piece test is eps-tolerant, so two squares offset by 2.5e-7 mm overlap — pinned by a
  test, not by the literal reading Astra attacked.

## 9. Golden delta

Predicted **none**. Both goldens carry one v1 zone `z1` (`netId: "gnd"`, B.Cu, four points) which
upgrades to an enabled polygon zone with identical geometry and net; the single
`ISOLATED_COPPER_ISLAND` keeps its `zone` anchor and its id has no location component. A golden
diff after the consumer rewiring is a bug signal, not a refresh trigger.

## 10. Astra ledger

### 10.1 Runs

| run | mode | effort | access | outcome |
|---|---|---|---|---|
| 1 (2026-09-07 12:00) | spec-attack | xhigh | prompt-only, cwd under the session scratchpad | **aborted by the Codex usage limit** after 251k tokens with no output. Astra inferred the repository path from the scratchpad directory name, read the contracts, kernels and skills and ran `bun -e` probes; a few probe results survived in stderr and were folded into §4 (degenerate items, grazing via, r = 2000 mm cap). Process lesson: prompt-only isolation needs a neutral cwd **and** an explicit "reason over the packet only" instruction. |
| 2 (13:52) | spec-attack | xhigh | packet-only from `/tmp/astra-s3a` (no shell calls, 51k tokens) | 18 findings + Q1–Q14 answers, classified below. |

### 10.2 Findings (run 2)

| # | finding (Astra severity) | verdict | evidence / action |
|---|---|---|---|
| 1 | Null-net zones both admitted (§3.2) and rejected (§3.1 "null net → pours nothing") — blocker | **accepted (wording)** | The packet condensed two rules into one line; the contract already distinguishes explicit net-less zones (pour) from board zones with no net (pour nothing). §3.1 now says why the board case differs. |
| 2 | Keepout `copperPour` displayed but unenforced until S4 — high | **accepted** | Subtraction implemented in S3a in the kernel: `pourParamsForZone(zone, rules, keepouts)` → `excludePolygonsMm` → kernel `subtractKeepouts`; Vitest pins the removed area. **S4 correction:** the S3a claim that every fill site passed the keepouts was wrong — only the canvas and the 3D preview subtracted them; Gerber, snapshot pours, the DRC island check and `pcb_cleanup_pour_traces` omitted the (then optional) argument, and the connectivity pours lost it inside `BoardPourSpec`. S4 made it required, made the spec forward it, and pinned each site (§13.3). |
| 3 | Equal-priority different-net zones get no clearance (edge/corner contact, near-disjoint) — blocker | **accepted (contract)** | §5 rewritten: symmetric exclusion of the other polygon inflated by the resolved clearance, computed from immutable originals; `ZONE_OVERLAP` stays for positive-area overlap. Enforcement is S5's fill work (other pours are not obstacles today — pre-existing, recorded in ground truth §4). |
| 4 | Override resolution omits net-class clearance — high | **accepted (recorded gap)** | Pre-existing: the fill kernel never consulted the rule resolver (`00-ground-truth.md` §4.2). §6 now states the gap; S5 wired the net-class tier, S6 the full resolver (pour pair kinds). |
| 5 | Nearly coincident pad/keepout (offset δ < eps) escapes `ringsOverlapPositiveArea` — blocker | **rejected** | Probe: squares offset by 2.5e-7 mm → `true`, 6e-7 → `true`, rotated ±δ → `true`. The S2 collinear-piece test is eps-tolerant (`isCollinear` = `|orient| ≤ eps·len`), which Astra's "literal shared-piece" reading excluded. Regression test added. |
| 6 | Degeneracy thresholds (≤ eps, < 1e-6 mm²) discard copper S1 recognises — medium | **accepted (documented limit)** | §8a: such copper is unmanufacturable and reported by width/diameter/structural checks; it is never exported as legal. |
| 7 | Output quantisation (0.1 µm grid) can round copper into a keepout — blocker | **accepted** | `subtractKeepouts` inflates each keepout by one output-grid step before subtracting (kernel `PRECISION` exported for it); residual error ≤ one step *outside*. Vitest asserts no pour vertex inside the keepout. |
| 8 | Fixed bias per kind reverses at concave arcs — blocker | **accepted** | Import now flattens through the S2 contour flattener (`flattenOutline(contour, { bias: "inward" \| "outward" })`), which decides inscribed vs tangent chain per arc from the exact contour orientation. §1 rewritten; parser tests compare polygon area against the exact area on both sides of a notch. |
| 9 | Name binding not unique; stale persisted `netId` — high | **accepted** | `collectCopperZones` takes `knownNetIds`; a stale id is unbound with `zone_net_stale`. The projection leaves a case-insensitively ambiguous `netName` unbound with `zone_net_ambiguous`. Tests added. |
| 10 | Store vs projection view-state forcing can diverge — blocker (medium confidence) | **accepted** | `applyLegacyBoardFillPolicy(viewSlice, netNames)` in `src/shared/pcb-areas/board-fill-policy.ts` (ground-net naming moved to `src/sdks/designer/ground-net.ts`); the projection and the canvas both apply it before deriving. Tests added. |
| 11 | Resolved minimum width has no stated enforcement — high | **rejected (clarified)** | The kernel enforces `minThicknessMm` with an open/close pass before island splitting (`copper-fill-geometry.ts`); §6 now says so. |
| 12 | Ordering not total (duplicate ids, `board:` prefix) — high | **accepted (already fixed by the reviewer pass)** | Duplicate ids drop every holder, `board:` ids are reserved, priorities normalised, warnings sorted (§3.1). |
| 13 | Isolated-island violation ids collide per zone — medium | **rejected** | The check emits one aggregate violation per zone (largest island as location); island identity never enters the id. §8a. |
| 14 | Pad hull cannot establish footprint exclusion — high | **accepted (contract)** | §4 placement extent = courtyard, else the axis-aligned bounding box of pads **and** footprint graphics — a declared superset. The user's "courtyard else pad hull" decision is superseded because the hull is not conservative; the predicate is unchanged (it takes the pre-resolved extent), S4 resolves it. |
| 15 | Dropping extra contours adds or removes copper — high | **accepted (already handled)** | Holes (contour strictly inside the outline) import the zone `enabled: false` with `zone_holes_unsupported`; second outlines drop with a warning (less copper). §8. |
| 16 | S1 distance rule vs intersection-only membership — medium | **rejected** | S1 §3 already defines island membership as positive-area intersection **or** edge distance ≤ ε (the packet quoted only the first half). |
| 17 | B3-9 `measuredMm` carries mm² — low | **out of scope** | Registered defect, owned by S5. |
| 18 | Complexity bounds understated — medium | **accepted (documented)** | §8a states the polygon–polygon and precedence bounds; S9 owns acceleration. |

Q1–Q14: Q1 documented limit (§8a); Q2 → #5 rejected; Q3 → #3; Q4 survives; Q5 → #1/#3; Q6 → #9; Q7 survives (a same-net trace touching a `"none"` pad is a real path — the kernel's island membership still lists the trace, never the pad); Q8 survives; Q9 → #14; Q10 → #8; Q11 → #9/#12; Q12 survives; Q13 survives; Q14 → the accepted rows above.

### 10.3 Reviewer-critical pass (before Astra run 2)

Ten findings on the kernel tier, all fixed with regressions: NaN/Infinity priority broke the total order; warnings were input-ordered; an in-memory `region: board` zone outranked board zones; `board:`-prefixed and duplicate ids; free pads never received a thermal knockout (`thruHoleThermal` was a silent no-op for them); empty-string net ids; `zoneRingValidity` strictness differed from `checkOutline`; `keepoutAffects` accepted a self-intersecting raw ring; negative `minAreaMm2` accepted; raw overrides on the effective record undocumented. A 4000-case randomised cross-check of `ringsOverlapPositiveArea` against clipper2 on concave rings found no mismatch.

## 11. Checklist (S3a exit gate)

- [ ] One contract (this file) — data model, region semantics, keepout predicate, precedence,
      overrides, consumers, import mapping.
- [ ] `collectCopperZones` / `collectKeepouts` are the only zone/keepout derivations; the seven
      duplicate pour-list assemblies are gone (census in the plan's verification section).
- [ ] `keepoutAffects` exists once, is unit-tested per object class × restriction × layer scope,
      and is the predicate S4 wires into DRC, the route gate and the fill.
- [ ] v1 rows upgrade deterministically; no legacy net-less row pours copper.
- [ ] KiCad rule areas import as keepouts; multi-layer zones split; every dropped token warns.
- [ ] 3D, canvas, Gerber, snapshot and DRC read the same effective zones.
- [ ] Gates at baseline; goldens byte-identical; Astra findings all classified.

## 12. Authoring (S3b)

S3b adds the writers. It introduces no legality semantics: every rule below is either data validity
(the same `zoneRingValidity` the derivation applies) or a lifecycle constraint on the record.

### 12.1 Board zones are persisted rows; the legacy fill toggle migrates

- A board zone is a `PcbZone` row with `region: { kind: "board" }` and `id === "board:<layer>"`. The
  id is derived from the layer and assigned by the executor, never chosen by a client; at most one
  board zone per copper layer follows from id uniqueness (two rows with the same id drop both —
  fail-closed, no copper). Its persisted `priority` is ignored (the derivation forces −1).
  `PcbViewState` no longer carries `copperFillLayers`, `copperFillPourNetIds` or
  `copperFillPadConnection`; `applyLegacyBoardFillPolicy` is gone.
- **Storage note.** `designer_pcb_entities.id` is a global primary key, so a zone or keepout row's id
  is a fresh uuid and the entity id (`board:<layer>` or a uuid) lives only in the payload; readers
  never depend on the row id, and update/delete resolve the row by payload id within the design.
  Snapshot `sourceId`s and DRC anchors (`{ kind: "net" }` for board zones) are therefore unchanged.
- **Migration** (`migrateLegacyBoardFill`, `pcb-store.ts`): lazy, on every entry point that can
  touch board settings (projection load, command dispatch, history replay), before any settings
  write — every settings writer re-serialises the parsed record, which would otherwise silently drop
  the unread legacy keys. It reads the RAW `board_settings` payload; when the legacy keys are present
  it inserts, for every stackup layer in `copperFillLayers` that has no `board:<layer>` row, a board
  row `{ enabled: true, netId: null, netName: <name of the current ground net>, padConnection:
  "solid" }` — the legacy policy poured "the net whose name matches `GND_NAMES`", so persisting that
  net's real name preserves it exactly; with no ground net the hint is `"GND"` (pours nothing,
  `zone_net_unresolved`, until such a net exists or the user picks one). It then strips the three
  keys from the raw payload and writes the raw record back (unknown fields survive). Idempotent; no
  revision bump; no history entry; off-stackup layers are dropped. A `pcb_set_view_state` patch that
  still carries the legacy keys (an old client) is ignored.
- The content digest now hashes board rows (they are persisted design data); a migrated board's
  digest rotates once.

### 12.2 Commands

| command | fields | validation (in order) |
|---|---|---|
| `pcb_add_zone` | `layer`, `net: { netId, netName }`, `region`, `name?`, `enabled?`, `priority?`, `padConnection?`, `clearanceMm?`, `minWidthMm?`, `thermal?`, `islandRemoval?` | layer on the stackup; board region → id `board:<layer>`, `PCB_ZONE_BOARD_EXISTS` if a row exists; polygon region → `zoneRingValidity(pointsMm) === "ok"` else `INVALID_PCB_ZONE(<reason>)`, id = uuid; `priority` finite integer ≥ 0 (default 0); `clearanceMm` / `minWidthMm` finite ≥ 0 or null; `thermal` members finite > 0; `islandRemoval.minAreaMm2` finite ≥ 0; `""` net id → null |
| `pcb_update_zone` | `zoneId` + any of the above as optional fields (`null` clears `clearanceMm` / `minWidthMm` / `thermal` / `islandRemoval`), `locked?: boolean` | `PCB_ZONE_NOT_FOUND`; a locked row accepts `locked: false` **on its own** and rejects it bundled with any other field (an unlock can never smuggle an edit past the gate); a board zone rejects `layer` and `region`; a polygon zone rejects a board region; `net` replaces both fields together; the same value checks |
| `pcb_delete_zone` | `zoneId` | not found / locked errors. The command deletes board zones too; the UI never offers it (the layers-panel toggle is a board zone's lifecycle control) |
| `pcb_add_keepout` | `layers`, `pointsMm`, `restrictions`, `name?`, `enabled?` | `layers` non-empty, copper, on the stackup, deduplicated; ring validity; `restrictions` is the full five-flag object (a missing flag is `false`) |
| `pcb_update_keepout` | `keepoutId` + optional fields, `locked?` | as for zones (including the unlock-only rule); `restrictions` replaces the whole object |
| `pcb_delete_keepout` | `keepoutId` | not found / locked |

Every field has a parser arm in `routes.ts` (a field without one is silently dropped over HTTP —
pinned by a full-field round-trip test). All six commands are undoable: `projection-world.ts`
carries `designer.pcb_zone` / `designer.pcb_keepout` components keyed by the payload id, and the
store's before/after snapshots and history replay include zones and keepouts.

**Net persistence rule** (net ids are ephemeral — `designer/AGENTS.md`): a named net is persisted as
`{ netId: null, netName }` and re-bound by name on every projection; an unnamed net as
`{ netId, netName: null }` (it goes stale with the net, `zone_net_stale`); "no net" as both null — a
polygon zone is then net-less copper (§3.2), a board zone pours nothing (`board_zone_no_net`).

### 12.3 Tools and surfaces

- **Zone tool (Z)** and **keepout tool (K)** reuse the board-shape sketch machinery (click-to-add
  vertex, typed length/angle, inference). The closed ring is pre-checked with `zoneRingValidity` —
  the same function the executor runs — and an invalid ring keeps the sketch open with the reason;
  the tool never has a ring rule of its own. Options while drawing: zone → layer (default: the
  active copper layer), net (default: the ground net by name, else no net), pad connection; keepout
  → layers (default: the active layer), restrictions (default: all five forbidden — an OpenPCB
  default, not a KiCad value).
- **Selection / hit-testing:** polygon zones and keepouts are selected by proximity to their ring
  (edge only — an interior hit would swallow every marquee start over a pour); board zones are never
  canvas-selectable. Hidden layers are neither hit, marquee-selected nor highlighted. Delete removes
  the selected unlocked polygon zones / keepouts and refuses board zones.
- **Vertex editing:** drag a vertex, insert a vertex on an edge, delete a vertex (never below
  three) — each commits `pcb_update_zone { region }` / `pcb_update_keepout { pointsMm }`.
- **Inspector:** every §2 field; layer/region fixed for board zones; all fields disabled while
  locked.
- **Layers panel:** the per-layer copper-fill control is the board zone: toggle = `enabled`
  (`pcb_add_zone` with a board region when no row exists), plus net and pad-connection pickers.
- **Rendering:** `ZoneOutlineLayer` draws every polygon zone's ring (solid when enabled, dashed ghost
  when disabled, §3.5); keepouts keep their hatched outline.

### 12.4 Stated limits

- Interior-click selection, whole-object drag-move and hole rings are not in S3b (holes → S5 with
  the import-bias flip; the other two are UI follow-ups).
- (Resolved in S4, §13.3.) `drc-context.ts`, `board-snapshot-pours.ts`, `gerber/writer.ts` and
  `pcb_cleanup_pour_traces` called `collectCopperZones` without `knownNetIds` during S3b, so a stale
  persisted `netId` poured there but not in the projection / canvas.

## 13. Legality integration (S4)

S4 makes every legality consumer read zones and keepouts through the same derivation and the same
predicate. It adds four DRC codes, threads the keepouts into every fill site, and gives the route
tool keepout awareness. It introduces no new geometry: every verdict below is `keepoutAffects`
(§4), `ringsOverlapPositiveArea` (§4) or the fill kernel's own output.

### 13.1 Codes

| code | class · default severity · waivable | fires when | anchors · layer · location |
|---|---|---|---|
| `KEEPOUT_VIOLATION` | `constraint` · error · waivable | `keepoutAffects(K, item)` for an effective (enabled, valid, on-stackup) keepout `K` and an item built from the DRC context: every trace (`layer`, polyline, width), every via and every pad (each on its DRC clamp layer set — a layer-invalid via or pad is on every valid layer, fail-closed; via copper diameter, pad world ring), every placement with a resolvable extent (§4). One violation per affected (item, keepout) pair, however many times the item crosses the keepout. | `[item anchor, { kind: "keepout", keepoutId }]` · a trace's layer, else the stackup-first layer common to the item and the keepout · the witness: the first item vertex strictly inside `K`, else the item point closest to `∂K` (trace); the centre (via, pad); the position (placement). Not location-hashed — the verdict is binary and the anchor pair is unique. |
| `ZONE_OVERLAP` | `constraint` · error · waivable | **(S5: equal-priority polygon pairs only — the §5 carve exists now; the board-plane and different-priority arms described below are history)** two effective **polygon** zones on the same layer with **different nets** whose rings overlap with positive area — **any priority until S5**, and **a board plane of another net under a polygon zone** likewise (the §5 precedence carve does not exist yet, so both pour the contested area today and the Gerber's later `LPC` antipads then open the zone's pads — Astra S4 #3; the messages say so; S5 narrows the code to equal-priority polygon pairs when the carve lands) (`ringsOverlapPositiveArea` on the canonicalised rings). Nets differ iff the `netId`s differ, with `null ≠ any id`; two net-less zones are the same "no net" (merging floating copper shorts nothing). Different priorities, the same net, different layers and board zones never report (§5: the fill carves them). Polygons that only touch, share an edge or sit closer than the clearance are legal (§5). | `[{ kind: "zone", zoneId: a }, { kind: "zone", zoneId: b }]` (sorted by the id hash) · the layer · the centre of the intersection of the two ring bounds (symmetric in a, b). One violation per unordered pair. |
| `ZONE_INVALID` | `structural` · error · **non-overridable, non-waivable** (like `BOARD_OUTLINE_INVALID`) | the derivation refused an **enabled** zone or keepout as authored: `zone_ring_invalid`, `keepout_ring_invalid`, `zone_layer_off_stackup`, `keepout_layer_off_stackup`, `zone_id_reserved`, `zone_id_duplicate`, `zone_board_id_mismatch` (§3.1 gate order decides which one reason is reported). A dropped keepout is a fail-open hazard — it stops protecting anything — so the code cannot be silenced. Disabled rows produce no warning and no violation (§3.5: intent). | `{ kind: "zone", zoneId }` or `{ kind: "keepout", keepoutId }` · the row's layer (first layer for a keepout) · the ring's first vertex when there is one. The message is the derivation's `detail`. A warning with no id (impossible today) anchors nothing and is skipped. |
| `ZONE_EMPTY_FILL` | `structural` · warning · waivable | (a) the derivation dropped an enabled zone for a **net** reason — `zone_net_unresolved`, `zone_net_stale`, `board_zone_no_net` — so it pours nothing; (b) an effective zone whose fill (`buildCopperFillIslandReport` with the same `pourParamsForZone(zone, rules, keepouts)` every consumer uses) returns **no island** — extent off the board, inside a cutout, consumed by clearances or by a `copperPour` keepout. | `{ kind: "zone", zoneId }` (board rows have ids since §12.1) · the zone's layer · (a) the ring's first vertex / the board outline's first vertex; (b) the same. |

Rules shared by all four:

- **DRC consumes the derivation; it never re-derives.** `DrcContext` keeps the warnings of the one
  `collectCopperZones` / `collectKeepouts` call it already makes (`copperAreaWarnings`, zones then
  keepouts, each in the derivation's sorted order). `ZONE_INVALID` and `ZONE_EMPTY_FILL` (a) are a
  mapping of `CopperAreaWarningCode` → code; the mapping is total over the union (a new warning code
  must be assigned to one of the two, or explicitly to neither with a reason).
- Violation ids follow `00-ground-truth.md` §6.3: code + sorted anchor keys + layer; none of the four
  is location-hashed. Presentation order is the check order; the id multiset is input-order
  independent (`drc-determinism`).
- `checks/keepouts.ts` and `checks/zones.ts` own the codes; `checks/copper-pour.ts` owns
  `ZONE_EMPTY_FILL` (b) because it already runs the fill per zone. A bounds test
  (`boundsMeet`) precedes every predicate call; the predicates are otherwise unchanged.

### 13.2 Warning-code mapping

| `CopperAreaWarningCode` | DRC result |
|---|---|
| `zone_ring_invalid`, `keepout_ring_invalid`, `zone_layer_off_stackup`, `keepout_layer_off_stackup`, `zone_id_reserved`, `zone_id_duplicate`, `zone_board_id_mismatch` | `ZONE_INVALID` |
| `zone_net_unresolved`, `zone_net_stale`, `board_zone_no_net` | `ZONE_EMPTY_FILL` |

The projection still carries the same warnings as strings (`PcbBoardPanel`); DRC is the legality
oracle, the panel is informational. Both come from the one derivation.

### 13.3 Fill-consumer parity

`pourParamsForZone(zone, designRules, keepouts)`, `boardPourSpecs(zones, designRules, keepouts)` and
`collectCopperZones({ zones, layerCount, knownNetIds })` have **no defaults** for the keepouts and
the known net ids: a consumer that assembles a pour must pass the effective keepouts of the same
projection and the ids of its current nets, or it does not compile. The seven fill sites —
projection ratsnest, DRC connectivity, DRC island check, snapshot pours, Gerber, `pcb_cleanup_pour_traces`,
the canvas and the 3D preview — therefore compute the same copper; a stale persisted zone net is
unbound (`zone_net_stale`) in every one of them. `BoardPourSpec` (the connectivity pour spec) declares
and forwards `excludePolygonsMm`; before S4 it silently dropped the field, so the ratsnest poured through
keepouts the canvas carved. Each backend site is pinned by a test that puts a
`copperPour` keepout inside a pour and asserts the hole (Gerber `LPC` region, snapshot island
rings, DRC island report, a covered-trace verdict that survives).

### 13.4 Routing

- **Obstacles (superset).** `buildRouteObstacles` turns every effective keepout with
  `restrictions.tracks` whose layers include the routing layer into one `ObstacleRectNm` — the
  bounding box of its ring (nm) inflated by `routeWidthMm / 2` (a keepout has clearance 0), id
  `keepout:<id>`. Auto-finish, walkaround and meander fitting avoid it; because it is a superset, a
  proposal may fail to find a path that exists, never propose one that enters the keepout (§4:
  "a conservative superset, never a subset").
- **Live check (exact).** `runLiveDrc` receives the effective keepouts and emits a
  `trace-keepout` violation for every pending segment for which
  `keepoutAffects(K, { kind: "trace", layer, pointsMm: [a, b], widthMm })` holds — the same predicate
  batch DRC runs, so a legal route beside a concave keepout is never falsely refused, and a route
  through one is blocked at commit exactly like a clearance conflict (the session-scoped override
  applies; batch DRC remains authoritative).
- **Via guard.** Before a smart via is placed (layer switch / `V`), the via disc — the diameter the
  preview draws, the span the session would commit, every copper layer when the span is unknown —
  is tested with `keepoutAffects` against every effective keepout with `restrictions.vias`; an
  affected via is refused with a HUD message and nothing changes.
- The `pads` and `footprints` restrictions have no live check (no part-drag legality exists); batch
  DRC reports them. Since S8 every copper command runs the reference verdict server-side
  (`07-live-parity-contract.md` §6) — `KEEPOUT_VIOLATION` is in its refuse set.
- `placementSideLayer(placement)` (`src/shared/rendering/pad-copper-layers.ts`) is the one
  resolution of a placement's outer copper layer, used by the predicate items, the route obstacles,
  the live DRC, the canvas and the snapshot.

### 13.5 Cloud boundary (decision 2026-09-07)

The `BoardSnapshot` wire contract is vendored from `cloud-auto-layout` and carries no keepouts; S4
does not extend it. The snapshot's pours subtract `copperPour` keepouts (§13.3), the builder keeps
warning that the autorouter ignores keepouts, and the apply-time DRC report (non-gating, as every
apply path) now surfaces `KEEPOUT_VIOLATION` for a cloud route. Sending keepouts to the service is
filed for a cloud session.

### 13.6 Stated limits

- Resolved in S7: circle pads reach `keepoutAffects` as the exact disc the §4 table names
  (`checks/keepouts.ts` passes the record's `disc`); non-circular pads keep the circumscribed ring.
- Net-class clearances enter the fill since S5; scoped rules since S6, only through a pour `pairKind` scope. `ZONE_OVERLAP`
  tests polygon overlap only and, since S5's precedence carve, reports equal-priority pairs only.
- Resolved in S5: one `buildCopperFillIslands` → `{ status: "ok" | "failed" }` for every consumer;
  a kernel bail is `ZONE_FILL_FAILED`, never `ZONE_EMPTY_FILL` (`04-copper-pour-contract.md` §8).
- `preview.bounds` is built from pad `widthMm` / `heightMm`, and so is a `custom` pad's ring
  (`pad-outline.ts` bounding rectangle) — the bounds contain the ring by construction (verified
  and pinned in S7).
- A trace whose points are all identical is a disc to batch DRC (`stadiumOverlapsRing` on a
  zero-length polyline) and nothing to the live check (it skips zero-length segments); such a trace
  is structurally invalid and reported by the width/structural checks, so the pair never reaches a
  committed route (Astra S4 note).
- `checkKeepouts` enumerates per keepout through the S9 grid (`08-broad-phase-contract.md` §4:
  `near(kind, keepoutBounds, 0)`, then the placements linearly); the live `keepoutItems` form indexes
  when its items are the context's. `keepoutAffects` itself is unchanged.
- A keepout dropped by the derivation for a reason that has no DRC mapping cannot exist (the mapping
  is total), but a keepout that is *disabled* affects nothing and reports nothing — by design.

### 13.7 Golden delta

Predicted **none** for `golden-small-2l` and `golden-cutouts-2l`: their `z1` net id `gnd` is in
`netNames`, so `knownNetIds` changes nothing, and they carry no keepouts. A third golden,
`golden-areas-2l`, is added to pin the four codes.

### 13.8 Astra ledger (S4)

| run | mode | effort | access | outcome |
|---|---|---|---|---|
| 1 (2026-09-07 22:42) | adversarial-verify | xhigh | repository-grounded (`-C` repo, reads restricted to the listed paths; S2 neutral scaffold) | 5 findings, all verified against source and accepted; a first launch was stopped after seconds (tool-timeout risk) and relaunched detached. |

| # | finding (Astra severity) | verdict | evidence / action |
|---|---|---|---|
| 1 | Two overlapping `copperPour` keepouts with opposite winding cancel under the non-zero fill rule — copper inside both, no DRC signal (blocker) | **accepted** | Probe reproduced 15.99 mm² of copper inside both squares. `collectKeepouts` now emits every ring CCW (`ensureCcwRing`) and `subtractKeepouts` normalises and unions the rings before subtracting; Vitest pins the pair. |
| 2 | `pcb_cleanup_pour_traces` deletes a trace whose only uncovered part is the bridge between two pour islands (the 99.9 % area test) — splits the net (blocker) | **accepted** | Probe reproduced (two islands, `isTraceCoveredByPour` → true). Coverage is now geometric: every trace stadium strictly inside ONE island's outer ring and meeting none of its holes; a bridge between islands can never be "covered". |
| 3 | A polygon zone of another net over a board plane reached no check (board zones were exempt) while the Gerber's later `LPC` antipads erase the zone's copper around its own pads — an open (blocker) | **accepted** | The exemption assumed the §5 carve, which is S5's. `ZONE_OVERLAP` now reports a board plane of another net under a polygon zone until S5 lands the carve (§13.1); Gerber emission order vs precedence stays S5's (§7). |
| 4 | Duplicate-id rows on different layers: `warningSite` hashed the first row's layer, so reversing the input changed the `ZONE_INVALID` id (medium) | **accepted** | Duplicate-id warnings carry no layer and sit at the board outline; permutation tests added. |
| 5 | An authored courtyard smaller than the part's pads became the whole extent — a pad inside a `footprints` keepout was missed (medium) | **accepted** | The extent is now the hull of the courtyard (or bounds) together with the placement's pad rings; a consistent footprint is unchanged. |

Also from the run: 150 trace/live/obstacle cases and 24 via-span cases found no live/batch disagreement; a fully collapsed trace (all points identical) is flagged by batch (disc) and skipped by live — documented in §13.6; `buildItems` did a linear placement lookup per pad (now a map).
