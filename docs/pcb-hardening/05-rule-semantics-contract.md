# 05 — DRC rule semantics contract (Session 6)

Status: **S6 complete (2026-09-08)** — implemented; Astra spec-attack run 1 and two review
passes folded (§15); gates at close in `PROGRAM.md`.

This contract defines how every stored PCB rule resolves to the number a check compares against,
who consumes that resolution, and what happens to a rule that cannot be applied. It supersedes
the rule-model paragraphs of `docs/drc/OPEN_FINDINGS.md` §5.3, §5.6, §6.2, §6.3 and §6.4, which
are corrected to point here. Session sequence and gates: `PROGRAM.md`.

## 0. Scope

In scope: board design rules (`PcbDesignRules`), net classes, per-net class assignment, scoped
priority rules (`PcbDrcRule`), the clearance floor, pair kinds, layer and area scopes, severity
resolution, waivers and rule-class ignores, the consumers of all of the above (batch DRC, live
DRC, route obstacles, the via insert gate, copper pours, the cloud snapshot, KiCad import, the
assistant), and the migrations the change implies.

Out of scope, with the owning session: the geometry a rule is compared against (S2), zone and
keepout legality (S3a/S4), pour geometry (S5), check completeness beyond rule sourcing (S7), live
DRC coverage of vias / shorts / board edge (S8), scaling (S9), execution (S10), slot / annular /
aspect models (S11), DFM overlays (S12), electrical and SI thresholds (S13/S14). A scoped-rules
editor and a severity-override UI are filed, not built (user decision 2026-09-08).

## 1. Vocabulary

- **Constraint kind** — what a rule constrains: `clearance` (a pair of copper items) or one of
  the scalar kinds `trackWidth`, `viaDiameter`, `viaDrill`, `annularRing`, `holeToHole`,
  `edgeClearance`.
- **Tier** — where a value comes from. *Explicit*: a scoped rule that matched. *Implicit*: the
  board rule and the net classes. *Floor*: the absolute minimum below which nothing may resolve.
  *Fab-advisory*: the fabricator preset (`FAB_*` codes, warning, never relaxable, never part of
  resolution — a separate comparison).
- **Item** — a trace, pad (footprint or free), via or drilled hole as the DRC context builds it
  (`DrcTrace`, `DrcPad`, `DrcViaGeom`, `DrcHole`); a pour (zone fill) is an item only on the
  pour side of a pour pair.
- **Pair kind** — `DrcPairKind`: `traceToTrace | traceToPad | traceToVia | padToPad | padToVia
  | viaToVia | pourToTrace | pourToPad | pourToVia | pourToPour` (the four pour kinds are new in
  S6; `POUR_KINDS` names that subset).
- **Scope** — a predicate on a rule: `net`, `netClass`, `layer`, `area`, `pairKind`. Scopes on
  one rule are AND-combined; repeated scopes of the same kind union their sets.
- **Evaluation point** — the millimetre point at which an item's area membership is tested for
  one comparison (§4.4).
- **Resolved value** — `{ mm, rule }`: the number a check compares against and the rule that
  set it (`null` when the implicit tier or the floor set it).

Every number in this contract is millimetres in the DRC domain (traces are integer nanometres in
storage and converted once by the projection). Comparisons follow the epsilon policy of
`OPEN_FINDINGS.md` §5.1 with one S6 amendment (Astra run 1 #10): a clearance violation is
`gap < required − GEOM_EPS_MM` (0.5 nm of grace — the derived-float case `0.3 − (0.1 + 0.1)`
evaluates to `0.09999999999999998` and used to fail a 0.1 mm rule at exact physical equality;
a 1 nm deficit still fires, as probe P-A2 requires); minimums keep `below(v, limit)` with
`DRC_EPS_MM = 1e-6`; the short tier keeps `gap <= SHORT_EPS_MM` inclusive. One helper,
`clearanceViolated(gap, required)` in `tolerance.ts`, is the only place the clearance regime
is written; batch and live both call it.

## 2. Stored model

Verbatim from `src/sdks/designer/types.ts` after S6 (the S6 additions are marked):

```ts
PcbDesignRules.clearance = {
  traceToTraceMm, traceToPadMm, padToPadMm, traceToViaMm, viaToViaMm, copperToBoardEdgeMm,
  holeToBoardEdgeMm?,        // absent → 0.3 (DrcContext default)
  pourToCopperMm?,           // S6: absent → 0.5 (§6)
}
PcbDesignRules.minimums = {
  traceWidthMm, drillSizeMm, annularRingMm, viaDiameterMm, viaDrillMm,
  holeToHoleMm?,             // absent → 0.25
  clearanceMm?,              // the floor; absent → 0; new boards 0.1 (§12)
}
PcbNetClass = { id, name, traceWidthMm, clearanceMm, viaDiameterMm, viaDrillMm, color,
  defaultViaProtection, diffPairGapMm?, voltageV?, currentA? }
PcbDrcRule = { id, name, enabled, priority, scopes: DrcRuleScope[], constraint, severity?, comment? }
DrcRuleScope = { kind: "net"; netIds } | { kind: "netClass"; netClassIds } | { kind: "layer"; layers }
  | { kind: "area"; polygonMm } | { kind: "pairKind"; pairKinds }
DrcRuleConstraint = { kind: "clearance"; mm } | { kind: <scalar>; minMm }
PcbBoardSettings: designRules, netClasses, perNetClassAssignments?, drcRules?, drcSeverityOverrides?
PcbViewState: drcIgnoredRuleClasses?, drcWaivedViolationIds?
```

### 2.1 Validity — what is rejected, what is reported

A rule row is **structurally invalid** when any of the following holds. `pcb_set_design_rules`
refuses the whole command with `INVALID_DRC_RULE(ruleId, reason)` (nothing is dropped silently
on save); a persisted row that is invalid (older data, direct writes) is reported by batch DRC as
`DRC_RULE_INVALID` (§10) and excluded from resolution.

| Reason | Definition |
|---|---|
| `malformed` | missing / non-string `id` or `name`, unparseable `constraint`, negative value, a scope with the wrong shape |
| `duplicate_id` | another ENABLED rule in the array has the same `id` (the first enabled occurrence in array order is kept; every later enabled one is invalid; disabled rows are absent and own nothing) |
| `area_polygon_invalid` | an `area` polygon with fewer than 3 distinct points, `|area| < DEGENERATE_AREA_MM2` (S2), or a self-intersecting ring (`ringSelfIntersects`, inclusive) |
| `area_limit` | the rule's area scope would be the 32nd distinct area polygon in the compiled set (§4.6 — 31 usable mask bits) |
| `scope_kind_not_allowed` | a `pairKind` scope on a scalar-kind rule (§5.2) |

A rule is **partially ineffective** (reported as `DRC_RULE_INEFFECTIVE`, warning; the rule
stays active for whatever still resolves) when a `net` scope names a net id that does not exist
in the projection, a `netClass` scope names a class id that is not in `board.netClasses`, or a
`layer` scope names a layer that is not a copper layer of the stackup (`unknown_net`,
`unknown_net_class`, `unknown_layer`). The same code with reason `value_clamped` reports a
clearance value below the floor or a scalar value below the board minimum: the rule is still
effective — it matches first and resolves AS the floor / minimum, shadowing lower-priority rules
(Astra run 1 #7 showed a below-floor relaxation that still turns a failing board into a passing
one) — but the author's number is not the one applied, which they must see. A disabled rule is
neither invalid nor ineffective; it is simply absent.

One silent drop remains, deliberately: a persisted row the STORE's parser cannot shape as a rule
at all (no string `id` / `name`, an unparseable `constraint`, a scope of the wrong shape) is
dropped on READ, exactly as before S6 — it has no id to report a `DRC_RULE_INVALID` against, and
no board has been observed carrying one. Every row that parses reaches the resolver, so
`duplicate_id`, `area_polygon_invalid`, `area_limit` and `scope_kind_not_allowed` are all reported
rather than dropped. The UPDATE path has no silent drop at any level: `pcb_set_design_rules`
validates the payload with the store parser AND the compiler and refuses the whole command with
`INVALID_DRC_RULE` before anything is written. Revisit the read-path drop if a real board ever
hits it.

`drcSeverityOverrides` entries with an unknown code or value are dropped on parse (unchanged);
`perNetClassAssignments` entries whose class id no longer exists are dropped on persist
(unchanged). Both are recorded here so the behaviour is documented, not silent.

## 3. Net-class resolution

`netClassIdOf(netId)` — one function (`net-class-resolver.ts` `resolveNetClassId`), used by
every consumer:

1. `perNetClassAssignments[netId]`, if it names a class that exists.
2. Name heuristic on the net's display name, fully anchored: `GND_NAMES`
   (`/^(GND|GROUND|AGND|DGND|EARTH|VSS|VEE)$/i`) → class `gnd` if present; `POWER_NAMES`
   (`/^(VCC|VDD|VBAT|VBUS|VIN|VOUT)$/i`) or `POWER_VOLTAGE` (`/^[+-]\d+(\.\d+)?V\d*$/i`) →
   class `power` if present.
3. **The default class** — `defaultNetClassId(board)` = `netClasses[0]?.id ?? "default"`,
   exactly today's chain (Astra run 1 #8: preferring a class named `default` would silently
   change existing boards whose first class is another one). One helper; the array-order
   fallback no longer appears anywhere else (`command-executor.ts` `effectiveNetClassId`, the
   canvas' default-class lookup and `classIdForName` all call it). The stored array order is
   therefore semantic: the first class is the default, and no UI reorders classes.

A null net has no class: `netClassIdOf(null) = ""`, class clearance 0, no scope matches.

The `netClassId` stored on a trace or via is a creation-time hint for the route tool's width /
via defaults. **No legality consumer reads it** — batch DRC, live DRC, the router's clearance
and the pour all resolve the class from the net (audit B1-2 / B3-2 extended to the frontend in
S6: the pending trace's class for clearance is `netClassIdOf(session.netId)`, not
`session.netClassId`).

`NETCLASS_TRACE_WIDTH` / `NETCLASS_VIA_*` keep their intent gate: they fire only for nets whose
class came from step 1 or 2, never from the default class (a class's nominal width is not a
minimum for an unclassed net).

## 4. Clearance resolution

### 4.1 Algorithm

For a pair `(a, b)` of items on layer `L` with pair kind `K` and evaluation points `p_a`, `p_b`:

```
explicit := first rule r in ORDER(enabled clearance rules) such that
              (K ∉ POUR_KINDS ? (no pairKind scope or K ∈ r.pairKinds)
                              : (r has a pairKind scope and K ∈ r.pairKinds))   // §6
          and (no layer scope     or L ∈ r.layers)
          and (no net scope       or a.net ∈ r.netIds or b.net ∈ r.netIds)
          and (no netClass scope  or class(a) ∈ r.netClassIds or class(b) ∈ r.netClassIds)
          and (no area scope      or inside(p_a, r.area) and inside(p_b, r.area))
implicit := max(board[K], classClearance(a.net), classClearance(b.net))
value    := explicit ? explicit.mm : implicit          // an explicit rule MAY relax
mm       := max(value, floor)                          // floor = minimums.clearanceMm ?? 0
rule     := explicit ?? null   // a clamped rule still matched first and shadowed the rest (§2.1);
                               // its severity applies; the message says "clamped to the floor" 
```

`ORDER` = priority descending, ties by array index ascending (stable). `board[K]` per pair kind:

| `K` | board field |
|---|---|
| `traceToTrace` | `traceToTraceMm` |
| `traceToPad` | `traceToPadMm` |
| `traceToVia` | `traceToViaMm` |
| `padToPad` | `padToPadMm` |
| `padToVia` | `traceToViaMm` — there is no pad-to-via board field; documented, not new |
| `viaToVia` | `viaToViaMm` |
| `pourToTrace` | `max(pourToCopperMm ?? 0.5, traceToTraceMm)` (§6) |
| `pourToPad` | `max(pourToCopperMm ?? 0.5, traceToPadMm)` |
| `pourToVia` | `max(pourToCopperMm ?? 0.5, traceToViaMm)` |
| `pourToPour` | `pourToCopperMm ?? 0.5` (zone–zone, §6) |

### 4.2 Scope semantics

| Scope | Matches a pair when | Matches a scalar item when (§5) |
|---|---|---|
| `net` | EITHER item's net id is in the set (Altium one-sided scope: "InNet('A')" against Any) | the item's net id is in the set |
| `netClass` | EITHER item's resolved class id is in the set | the item's resolved class id is in the set |
| `layer` | the evaluated layer `L` is in the set | any copper layer the item occupies is in the set (via: its resolved span; through-hole pad: every valid layer; free hole: every valid layer) |
| `area` | BOTH evaluation points are inside the SAME one of the rule's area polygons (§4.4) | the item's geometry overlaps the polygon's open interior (`stadiumOverlapsRing` for a trace segment, `ringsOverlapPositiveArea` for a pad ring, `discOverlapsRing` for a via disc, and for a drilled hole its drill disc or slot stadium — Astra run 1 #5: an NPTH has no copper) — a superset match, conservative for a tightening rule |
| `pairKind` | `K` is in the set; a pour kind matches ONLY through an explicit `pairKind` scope (§6) | never — a `pairKind` scope on a scalar rule is `scope_kind_not_allowed` (§2.1) |

Repeated scopes of one kind on one rule **union** their sets (a rule scoped to `net {A}` and
`net {B}` targets A or B); a second `area` scope adds a second polygon and the rule matches when
both points lie in any one of them. There is no conjunctive reading (Astra run 1 #6).

"Either" for `net` / `netClass` is deliberate and applies to relaxations too: a rule scoped to
net A relaxes A against everything, including a net whose class demands more. The class tier
does not survive an explicit match — that is what "first match wins, may relax" means, and it
is how Altium's first-match model behaves. A designer who wants a class to stay protected
writes a higher-priority rule scoped to that class. (Astra question 2 attacks this reading.)

`inside(p, polygon)` is a closed set at `GEOM_EPS_MM`: ray-cast inside (`pointInPolygon`) or
within `GEOM_EPS_MM` of the ring (`pointToRingEdgeDistance ≤ GEOM_EPS_MM`).

### 4.3 Layers

Trace pairs have one layer, the trace's. A pad–pad, pad–via or via–via pair shares one or more
copper layers; the geometric gap does not depend on the layer, only the rule can. Resolution:
iterate the shared layers in stackup order (`F.Cu, In1.Cu, …, B.Cu`), resolve on each, and
collect the **violated** layers `V = { L : clearanceViolated(gap, req_L) }`. If `V` is empty the
pair is clean. Otherwise ONE violation is emitted for the pair as an aggregate: `layer` = the
first layer of `V` in stackup order, `requiredMm` = `max_{L∈V} req_L`, and the severity input
is the **most severe** over `V` of (the rule severity of `L`'s rule when that rule set the value,
else the code default) — so a warning-tier rule on F.Cu can never hide an error-tier rule on
B.Cu (Astra run 1 #4). A waiver on the aggregate waives the pair on every layer (stated). With
uniform rules every shared layer is violated together and the first shared layer is reported —
exactly what the check reports today, so ids (which hash the layer) are unchanged by
construction.

### 4.4 Evaluation points and the two-hotspot trap

Today every pair is resolved once at representative points (trace midpoint, pad centre, via
centre). With an `area` rule that relaxes, this is a false pass: two traces whose closest
approach lies inside the area at 0.10 mm (relaxed rule 0.10) and whose second approach lies
outside the area at 0.20 mm (board rule 0.25) are reported clean, because the single resolution
at the closest pair picks the relaxed value and the outside approach is never compared against
0.25.

A single closest point per segment pair is not enough either: one non-parallel segment pair
whose closest approach lies inside the relaxing area can have a second, farther approach outside
it (Astra run 1 #1 — left endpoints at 0.125 inside, right endpoints at 0.1875 outside, one
segment pair, no second pair to iterate).

S6 rule: **the requirement is evaluated on regions of constant scope membership.** Pads, vias
and holes evaluate at their centre (constant). A trace segment is split at every crossing with
every area polygon's ring (`splitParamsAgainstRing`, S2) into sub-segments on each of which the
area mask is constant (evaluated at the sub-segment midpoint; a point on a ring belongs to the
inside — closed set — and a genuine relaxation that leaks past its area boundary is caught by
the first outside sub-segment, by continuity). Trace pairs are then judged per sub-segment pair:

```
for each sub-segment u of a (in index order), sub-segment v of b:
  req    := clearance(K, L, {a.net, mask(u)}, {b.net, mask(v)}).mm   // constant over (u, v)
  gap    := dist(u, v) − (a.halfWidth + b.halfWidth)                 // segmentClosestPoints
  if clearanceViolated(gap, req): witness (u, v, p, q, gap, req)
report ONE violation per pair: the witness with the largest deficit req − gap (ties: the
smallest (u, v) in index order under the CANONICAL orientation — the item with the smaller
sorted anchor key is `a`, so swapping the input arrays cannot move the tie, Astra run 1 #9);
location = midpoint(p, q), measuredMm = gap, requiredMm = req; severity input = the most severe
over every violating witness (as §4.3).
```

Trace–pad and trace–via run the same loop over the trace's sub-segments against the pad ring /
via disc (`segmentToRingClosestPoints`, new; the via disc reduces to the sub-segment's closest
point to the centre). Pad–pad, pad–via and via–via evaluate once at the centres. When the
compiled set has **no** area rules, or when neither item's bounds meet any area polygon's
bounds, the mask is constant over the pair and every pair keeps today's single-resolution fast
path; the result is identical because `req` is then constant over the pair. The added cost is
confined to pairs that meet an area polygon (Astra run 1 #15 — recorded for S9).

Prefilter: the AABB gap test uses `clearanceBound(K, a.net, b.net)` =
`max(implicit(a, b), maxEnabledClearanceRuleMm, floor)` — an upper bound of any value the
resolution can return for that pair, so no candidate is discarded before evaluation.

### 4.5 Null nets

An item with a null net (unassigned pad, orphan trace) matches no `net` / `netClass` scope, has
class clearance 0, and is still subject to the board rule, `layer` / `area` / `pairKind`
scopes and the floor. The short tier is unchanged: it fires only between two different *known*
nets.

### 4.6 Area limit

Area polygons are registered in `ORDER` of the rules that carry them and addressed by a bit
mask with 31 usable bits (the sign bit is never used, so no wraparound); the 32nd distinct
polygon makes its rule `area_limit`-invalid (§2.1) rather than global. A rule with several
`area` scopes owns several bits and matches when both evaluation points share any one of them
(§4.2).

## 5. Scalar constraints

### 5.1 Algorithm — the same shape, a per-kind floor

```
explicit := first rule r in ORDER(enabled rules of kind k) whose item scopes match (§4.2)
value    := explicit ? explicit.minMm : boardMin[k]
mm       := max(value, boardMin[k])      // tighten-only IS "the floor is the board minimum"
rule     := explicit ?? null             // clamped rules stay attributed (§2.1), message says so
```

| `k` | `boardMin[k]` | applies to | check / code | message |
|---|---|---|---|---|
| `trackWidth` | `minimums.traceWidthMm` | every trace | `manufacturability.ts` → `TRACE_WIDTH_MIN` | names the rule when one set the value |
| `viaDiameter` | `minimums.viaDiameterMm` | every via | `VIA_DIAMETER_MIN` | |
| `viaDrill` | `minimums.viaDrillMm` | every via | `VIA_DRILL_MIN` | |
| `annularRing` | `minimums.annularRingMm` | every via (THT pad rings: S11, B2-6) | `ANNULAR_RING_MIN` | |
| `holeToHole` | `minimums.holeToHoleMm ?? 0.25` | every hole pair the check visits; `net` / `netClass` match if EITHER hole's net qualifies, `area` needs BOTH holes | `board.ts` → `HOLE_TO_HOLE` | |
| `edgeClearance` | `clearance.copperToBoardEdgeMm` | every copper item (trace, via, pad); `HOLE_TO_BOARD_EDGE` keeps the board rule (S11) | `board.ts` → `COPPER_TO_BOARD_EDGE` | |

A hole's scope geometry is its drill disc (or slot stadium), never its copper (§4.2).
`DRILL_SIZE_MIN` (`minimums.drillSizeMm`) has no scalar rule kind and stays board-only; the
via insert gate (`buildPcbViaForInsert`) resolves `viaDiameter`, `viaDrill` and `annularRing`
through the same function so a tightening rule refuses the via the way the board minimum does.

### 5.2 Why first-match and not max-of-all

Two readings of "tighten-only" exist: the most specific matching rule decides (first match), or
every matching rule tightens (maximum). Both agree that nothing goes below the board minimum.
S6 chooses first match so that scalar and clearance rules share **one** precedence model; a
designer who wants two tightenings to compound writes the tighter one at the higher priority.
(Astra question 5.)

## 6. Pour clearance

A copper pour is the pour-side item of the pair kinds `pourToTrace`, `pourToPad`, `pourToVia`
(the obstacle kind decides) and `pourToPour` (another zone's polygon). Three rules make the
pour a well-defined, fail-closed consumer:

1. **Only an explicitly pour-scoped rule reaches a pour.** A scoped clearance rule matches a
   pour kind only through a `pairKind` scope that names it; a rule with no `pairKind` scope
   matches every copper–copper kind and no pour kind. This keeps S5's invariant ("scoped rules
   stay out") for every existing rule (Astra run 1 #14) and makes relaxing a fill an explicit
   act.
2. **Area scopes never relax a pour.** A pour has no single evaluation point — its copper is
   wherever the fill ends up, inside or outside an area (Astra run 1 #2). The pour-side value is
   therefore `max(clearance(K, L, a, b) with both masks 0, clearance(K, L, a, b) with both masks
   taken at the obstacle point)`: an area relaxation around the obstacle is not applied (the
   masks-0 term is at least the un-relaxed value), an area tightening around the obstacle is
   applied to the whole halo (conservative). An exact clipped-halo implementation (relaxed halo
   inside the area, full halo outside) is filed, not built.
3. **Zone–zone is `pourToPour`**, symmetric by construction:
   `c(Z, Z') = max(Z.clearanceMm ?? 0, Z'.clearanceMm ?? 0, clearance("pourToPour", L, {net Z},
   {net Z'}).mm)` with masks 0 (Astra run 1 #3). Board value `pourToCopperMm ?? 0.5`.

For a zone `Z` with net `N` on layer `L` and an obstacle `M` of kind `k ∈ {trace, pad, via}`:

```
c(M) = max( Z.clearanceMm ?? 0,                                       // the zone author's own minimum
            clearance(pourTo<k>, L, {N, mask 0}, {net(M), mask 0}).mm,
            clearance(pourTo<k>, L, {N, mask(p_M)}, {net(M), mask(p_M)}).mm )
```

The zone tier's former board component `max(0.5, traceToTrace, traceToPad, padToPad,
traceToVia)` becomes the per-kind implicit tier of §4.1 through `pourToCopperMm` (absent = 0.5 —
the constant the kernel has always used; its provenance is KiCad's zone-clearance default,
**needs verification**). NPTH and edge halos keep `copperToBoardEdgeMm` (S5 §5, S11).

Behaviour change (release note): today every obstacle gets the maximum over all four board
clearances; per kind, a board whose `traceToPadMm` is below `traceToTraceMm` (both above 0.5)
now pours closer to pads than before, following the pad rule the way a trace does. No existing
scoped rule changes any fill (rule 1).

`ZonePourNets` carries the resolver's inputs; `pourParamsForZone` builds `clearanceForItem(kind,
netId, pointMm)` from the same `createRuleResolver` batch DRC uses. There is no pour-local
clearance formula after S6.

## 7. Severity

```
severity(code, ruleSeverity) =
  overrides[code]        if overrides has code and code ∉ NON_OVERRIDABLE
  ruleSeverity           else if the rule that SET the value carries a severity
  DEFAULT_SEVERITY_BY_CODE[code]
```

Checks emit facts (code, anchors, measured, required, optional `ruleSeverity`); the engine
decides severity. For an aggregate over several violating witnesses or layers (§4.3, §4.4) the
check passes the most severe input among them, so aggregation never downgrades. `DrcViolationDraft` has no `severity` and no `waivable`; `NON_OVERRIDABLE`
(`severity.ts`) is the single list that both refuses overrides and marks a violation
non-waivable: `NET_SHORT_CIRCUIT`, `VIA_LAYER_SPAN`, `PAD_LAYER_MISMATCH`,
`BOARD_OUTLINE_INVALID`, `ZONE_INVALID`, `ZONE_FILL_FAILED`, `DRC_RULE_INVALID`. An `"ignore"`
override drops the violation unless the code is non-overridable.

`HOLE_TO_BOARD_EDGE` carried two severities under one code (breach = error, near miss =
warning). S6 splits it: a drill or slot that is not inside the board region is
**`HOLE_OFF_BOARD`** (error, dfm, parallel to `COPPER_OFF_BOARD`); a hole inside the region but
closer than `holeToBoardEdgeMm` stays `HOLE_TO_BOARD_EDGE` (warning).

## 8. Waivers and ignores

Two mechanisms, two scopes, both unchanged in kind:

| Mechanism | Lives on | Scope | Effect |
|---|---|---|---|
| `drcSeverityOverrides` (`code → severity | "ignore"`) | board settings | the design (collaborators share it) | §7 |
| `drcIgnoredRuleClasses` | view state | this user's view | a whole rule class is not emitted |
| `drcWaivedViolationIds` | view state | this user's view | the violation is emitted with `waived: true` and left out of the summary |

Non-overridable codes survive all three. `runDrc` defaults the three from the projection
(`board.drcSeverityOverrides`, `viewState.drcIgnoredRuleClasses`, `viewState.drcWaivedViolationIds`)
when the caller passes none, so the HTTP routes, the SDK (assistant, MCP) and the cloud apply
path produce the same report for the same projection; an explicit option still wins (tests).

Waiver ids are the v2 scheme `${code}-v2-${fnv1a64(…)}` (`OPEN_FINDINGS.md` §6.3). An id that
does not match `^[A-Z_]+-v2-[0-9a-f]{16}$` is pruned when the view state is read or patched:
a v1 id cannot be mapped forward (the v1 hash omitted layer and location and the code has been
deleted), so pruning is the only honest migration. The `{ id, comment, waivedAt }` shape and the
"one-shot v1→v2 remap" described in §6.3 never existed; §6.3 is corrected. Waiver drift (§5.6 —
a waived pair stays waived while its geometry degrades within the 0.1 mm bucket) is a recorded
limit.

## 9. Consumers

| Consumer | Reads | Resolution | Divergence from batch (explicit) |
|---|---|---|---|
| Batch DRC (`drc-context.ts`, `checks/*`) | `createRuleResolver(board, netNames)` | §4, §5, §6, §7 | — (reference) |
| Live DRC (`live-drc.ts`, the route commit gate) | the same resolver, built once per projection | trace–trace and trace–pad: every (pending segment, neighbour segment / pad) pair under the §4.4 split-and-resolve procedure (Astra run 1 #11), pending class from the net (§3), plus the short tier (`gap <= SHORT_EPS_MM` between different known nets refuses the commit — Astra run 1 #12) | checks only those two pair kinds and no edge / via checks — S8 scope. Trace–trace: the clearance and short verdicts equal batch's exactly (R2 probe: `distanceMm` / `requiredMm` = batch `measuredMm` / `requiredMm`, with and without an area rule). Trace–pad: the REQUIREMENT equals batch's; the GAP is still measured against the un-rotated pad AABB on the placement's side layer (B5-LIVE-ROT-PAD / B5-LIVE-TH-PAD-SIDE, S8), so a through-hole pad on a top-side part is invisible to a B.Cu route until S8 |
| Route obstacles (`route-obstacles.ts`) | the same resolver | each obstacle inflated by `clearance(K, L, {pending net, p_M}, {obstacle net, p_M})` with `K` by obstacle kind (`traceToVia` for vias — today they use the trace value) | a search heuristic: both area points sit at the obstacle, so a relaxation applies whenever the obstacle is inside the area. It never decides legality — the live gate does (S16 may refine) |
| Via insert gate (`buildPcbViaForInsert`) | `scalar(viaDiameter / viaDrill / annularRing, via)` | §5 | no neighbour clearance at insert (S8) |
| Copper pour (`pour-params.ts`) | the same resolver | §6 | — |
| Cloud snapshot (`board-snapshot.ts`) | `clearance` WITHOUT `pourToCopperMm`, `minimums` WITHOUT the floor (both stripped — the vendored `SnapshotDesignRules` schema declares neither and is byte-stable), stripped net classes, resolved class per net | the cloud router sees the implicit tier only | scoped rules, the floor and the pour rule are not in the wire contract; apply-time DRC (desktop, batch) re-validates — recorded boundary (cloud session) |
| KiCad import | `.kicad_pro` `net_settings.classes[]` (+ `nets` v6 / `netclass_patterns` v7-8 / `netclass_assignments` v9), `board.design_settings.rules` | §12.3 | `.kicad_dru` custom rules are not imported — warning `kicad_custom_rules_ignored` |
| Assistant / MCP | `designer_run_drc` → the SDK → batch | §8 defaults | no rule tools (filed) |
| Design-rules dialog | clearances (+ `pourToCopperMm`), minimums (+ the floor), class width / clearance, per-net assignment; resends `electrical` untouched | — | no scoped-rules UI (decision), no override UI (filed) |

## 10. Codes

| Code | Class | Default severity | Overridable / waivable | Emitted by | Anchors | Location hashed |
|---|---|---|---|---|---|---|
| `DRC_RULE_INVALID` | structural | error | no / no | `checks/rules.ts` | `{ kind: "rule", ruleId }` | no |
| `DRC_RULE_INEFFECTIVE` | structural | warning | yes / yes | `checks/rules.ts` | `{ kind: "rule", ruleId }` | no |
| `HOLE_OFF_BOARD` | dfm | error | yes / yes | `checks/board.ts` | the hole | no (single item) |

`DRC_RULE_INVALID` is non-overridable for the same reason as `ZONE_INVALID`: a dropped tightening
rule is fail-open, and the user must see it. The `rule` anchor is added to every exhaustive
anchor switch (`violation-id.ts` `anchorKey`, `drc-labels.ts` `resolveAnchorLabel`).

## 11. Determinism

- Rule order is total (priority, array index); the compiled set is a pure function of the
  board settings. Area masks are derived from rule order.
- The resolver memoises on `(K, L, netA, netB, maskA, maskB)`; with no area rules the masks are
  0 and the memo degenerates to today's `(K, L, netA, netB)`.
- Witness search runs in the canonical pair orientation (smaller sorted anchor key first);
  sub-segment iteration and the deficit tie-break are index-ordered in that orientation, so the
  reported witness — and with it the 0.1 mm location bucket in the violation id — is the same
  whichever order the input arrays arrive in (Astra run 1 #9). Ids hash the code, sorted anchor
  keys, the layer and (for pair codes) that bucket. Reordering the input arrays changes presentation order only (§5.2 of
  `OPEN_FINDINGS.md` unchanged).
- `problems` are reported in rule-array order, then reason order.

## 12. Migrations and release notes

1. **Scalar scoped rules now enforce.** A board with stored `trackWidth` / `viaDiameter` /
   `viaDrill` / `annularRing` / `holeToHole` / `edgeClearance` rules gains violations it never
   had; the rules were persisted-but-inert before.
2. **Area rules evaluate at the closest points.** Pairs that passed through the two-hotspot trap
   now fail. Ids of existing area-relaxed violations may change (the location bucket follows the
   reported segment pair).
3. **Rule severity applies**; `DEFAULT_SEVERITY_BY_CODE` is the default. Existing behaviour is
   unchanged except `HOLE_TO_BOARD_EDGE` breaches, which are now `HOLE_OFF_BOARD` (new ids; a
   waiver on the old id is pruned as stale only if it was a v1 id — v2 ids that no longer match
   are kept, as always). A stored `drcSeverityOverrides.HOLE_TO_BOARD_EDGE` is copied to
   `HOLE_OFF_BOARD` on read when the latter has no entry, so an ignored breach stays ignored
   (Astra run 1 #13); the copy persists on the next settings write.
3a. **Clearance comparison gains 0.5 nm of float grace** (§1): pairs at exact physical equality
   whose derived double lands a few ulps short no longer fail; every other verdict is unchanged
   (probe ladder P-A0..P-A2 re-run).
4. **Reports agree across entry points** — the assistant's `run_drc` now honours
   `drcSeverityOverrides`.
5. **Floor `minimums.clearanceMm = 0.1` on new boards** (`createDefaultPcbBoardSettings`);
   existing boards, the golden fixtures and the DRC test fixtures keep the field absent (= 0).
   The read path never invents it; the update path preserves it when a payload omits the key.
6. **`electrical` survives a design-rules dialog save** (it was reset to the defaults on every
   save); `pourToCopperMm`, `holeToBoardEdgeMm` and the floor are preserved the same way; `null`
   clears an optional key.
7. **Pour clearance per obstacle kind** (§6); only rules with an explicit pour `pairKind` scope
   reach pours (no existing rule does); `pourToCopperMm` is editable.
8. **Live DRC and the router honour the neighbour's class, scoped rules and the floor** — a route
   next to a 0.8 mm-class pad is refused at 0.8 (it was accepted at the board rule and flagged
   by batch afterwards).
9. **Stale waiver ids are pruned** (§8).
10. **Malformed rules are refused on save** instead of dropped; persisted invalid rules are
    reported (§2.1).
11. **KiCad import** maps project minimums and per-net class assignments (§12.3) and warns on
    `.kicad_dru`.

### 12.3 KiCad mapping (verified on a KiCad 8 project file, 2026-09-08)

`board.design_settings.rules` → `min_clearance` → `minimums.clearanceMm` (KiCad's own default
is 0); `min_track_width` → `minimums.traceWidthMm`; `min_via_diameter` →
`minimums.viaDiameterMm`; `min_through_hole_diameter` → `minimums.drillSizeMm` and
`minimums.viaDrillMm` (KiCad has one drill minimum); `min_via_annular_width` →
`minimums.annularRingMm`; `min_hole_to_hole` → `minimums.holeToHoleMm`;
`min_copper_edge_clearance` → `clearance.copperToBoardEdgeMm`. `min_hole_clearance`
(hole-to-copper) has no OpenPCB field (S11). The board's per-kind clearances take the `Default`
net class clearance (KiCad's working clearance for unclassed nets) — the floor stays the
project's `min_clearance`, which reproduces KiCad's "class clearance, floored by the board
minimum" semantics. Per-net assignments: `classes[].nets` (v6) and `netclass_patterns`
(v7/8, `{ pattern, netclass }`, exact names only — a wildcard pattern warns
`kicad_netclass_pattern_unsupported`) → `perNetClassAssignments` by net name after net
creation; `netclass_assignments` (v9) is mapped when it is a plain `netName → className`
object (**needs verification** — every v9 file in the corpus has it empty).

## 13. Stated limits

- `clearance.copperToHoleMm` (S7) is a board field read by `copperToHoleClearanceMm`, not a
  resolver path — no hole pair kind exists for scoped rules (S11).
- Scoped rules, the clearance floor and `pourToCopperMm` do not reach the cloud auto-layout
  (wire-contract boundary — the snapshot strips the two keys; the desktop apply path
  re-validates).
- `annularRing` rules apply to vias only; THT pad rings and slots are S11 (B2-5, B2-6).
- `holeToHole` net / class scopes never match an NPTH (null net) — only `layer` / `area` scopes
  and the unscoped rule reach it.
- The router's obstacle inflation is a heuristic (§9); the live gate covers trace–trace and
  trace–pad only (S8 widens it).
- Waiver drift within the 0.1 mm location bucket (§8).
- No UI for scoped rules or severity overrides; no assistant rule tools.
- `padToVia` has no board field of its own.
- Area scopes never relax a pour; an area tightening around an obstacle widens its whole halo
  (§6 rule 2) — the exact clipped-halo fill is filed.
- Per-sub-segment evaluation is `O(n·m·(R+V))` for the pairs that meet an area polygon (S9).

## 14. Golden delta

Predicted before regeneration and **verified 2026-09-08** (id-set diff before regenerating, then
hashes): `golden-small-2l` (`dd7514…`), `golden-areas-2l` (`cfd996…`), `golden-pours-2l`
(`73b350…`) byte-identical (no scoped rules; the pours fixture's board clearances are at or below
0.5, so per-kind `pourToX` equals the old maximum); `golden-cutouts-2l` (`c611f7…` → `e5afb6…`)
changed by exactly one id: the `hole_slot` breach `HOLE_TO_BOARD_EDGE` error became
`HOLE_OFF_BOARD` (summary 23 / 31 unchanged). `golden-rules-2l` (`773252…`) is new.
New `golden-rules-2l` pins scoped clearance (relax in a BGA area with the two-hotspot trap —
the violation lands outside the area at `x ≈ −33.506`, required 0.25, measured 0.140 —, tighten
by class, a layer-scoped rule over a THT pair, the mixed-severity via pair as one error), the
`trackWidth` and `edgeClearance` scalar kinds (the other four are pinned by
`drc-scalar-rules.test.ts`), an invalid and two ineffective rules (`unknown_net`,
`value_clamped`), a pour next to a 0.8 mm class with a `pourToPad`-scoped rule, the floor, and
the three new codes (18 errors; codes `DRC_RULE_INVALID` 1, `DRC_RULE_INEFFECTIVE` 2,
`TRACE_WIDTH_MIN` 1, `TRACE_TO_TRACE_CLEARANCE` 2, `VIA_TO_VIA_CLEARANCE` 1,
`PAD_TO_PAD_CLEARANCE` 1, `COPPER_TO_BOARD_EDGE` 1, `HOLE_OFF_BOARD` 1, plus the fixture's
incidental `UNCONNECTED_NET` / `TRACK_DANGLING` / `VIA_DANGLING`).

## 15. Astra ledger

Run 1 — spec-attack, xhigh, prompt-only, 2026-09-08 (≈25 min; 27k tokens). 15 findings; every
one verified against the contract and the source; 14 accepted into the sections above, 1
recorded as a limit. Nothing rejected.

| # | Finding (Astra) | Verdict | Where |
|---|---|---|---|
| 1 | One closest point per segment pair misses a second hotspot of the same pair (blocker) | accepted — split segments at area-ring crossings; regions of constant membership | §4.4 |
| 2 | Obstacle-point pour evaluation extends a relaxation outside its area | accepted — area scopes never relax a pour (max of masks-0 and obstacle masks); exact clipped halo filed | §6 |
| 3 | Zone–zone has no pair kind / evaluation point | accepted — `pourToPour`, masks 0, symmetric formula | §6, §4.1 |
| 4 | Max-clearance / max-deficit aggregation loses severity | accepted — aggregate takes the most severe violated witness / layer; waiver covers the aggregate | §4.3, §4.4, §7 |
| 5 | Area-scoped hole-to-hole rules cannot match copper-less holes | accepted — hole scope geometry = drill disc / slot | §4.2, §5.1 |
| 6 | Repeated scope kinds have no Boolean definition | accepted — union; area = both in the same one of the rule's polygons | §4.2 |
| 7 | "Ineffective" mislabels effective (clamped, shadowing) rules | accepted — ineffective = unknown references; clamps reported as `value_clamped`, rule stays active | §2.1 |
| 8 | Default-class change breaks existing boards | accepted — keep `netClasses[0]`; one helper, no semantic change | §3 |
| 9 | Witness order not canonical (tie between equal minimisers; anchor order moves the id) | accepted — canonical orientation by sorted anchor key; index tie-break after the split | §4.4, §11 |
| 10 | Bare double subtraction rejects exact physical equality | accepted — `clearanceViolated = gap < required − GEOM_EPS_MM`, §5.1 amended | §1, §12 |
| 11 | The gate's candidate domain unstated | accepted — every (pending segment, neighbour segment / pad) pair, same procedure | §9 |
| 12 | Gate excludes the short tier → not parity | accepted — the gate refuses shorts; parity claim scoped to clearance + short | §9 |
| 13 | Hole-code split changes suppression under an `"ignore"` override | accepted — override copied on read | §12 |
| 14 | Global relaxations newly weaken pours (S5 conflict) | accepted — pour kinds require an explicit `pairKind` scope | §6 |
| 15 | Sub-segment products are a performance cliff | recorded limit — bounds-based fast path; S9 | §4.4, §13 |

**R1 (reviewer-critical on WP2, 2026-09-08)** — 10 findings, all verified by probe: the
trace–trace fast path was not run in the canonical orientation (a parallel partial overlap's tie
resolved to a different end when the trace array was reversed — pre-existing, now fixed and
pinned for `TRACE_TO_TRACE_CLEARANCE` and `NET_SHORT_CIRCUIT`); the multi-layer aggregate
reported the strictest layer instead of the first violated one (fixed, §4.3 tested); the
`HOLE_TO_BOARD_EDGE` → `HOLE_OFF_BOARD` override copy was still missing (WP3); zone–zone
resolved at the other zone's centroid with masks — asymmetric under an area-scoped `pourToPour`
rule (`clearancePour` gained a point-less, net-preserving obstacle form; WP3 uses it); a disabled
row owned its id (fixed — duplicates are detected among enabled rows); the clamped-rule message
named the rule as if its number applied (one `ruleSuffix` helper now says "clamped to the floor
…"); the golden `.md` and `netClasses[0]` sites were stale (fixed / WP3, WP4); two resolvers
were compiled per DRC run (WP3 reuses the context's); P-A2 had no probe row (added, plus a
direct `clearanceViolated` boundary pin at 4e-7 / 6e-7). `CREEPAGE_DISTANCE` keeps `below()`
(S13).

**R2 (reviewer on WP3 + WP4, 2026-09-08)** — 7 findings, all verified by probe: the fail-closed
rule validator was fed the raw command payload (a partial `designRules` plus a `drcRules` array
threw inside `compileRuleSet`; fixed — validation now runs against the values the store will
persist, so validation and persistence cannot disagree); the snapshot shipped `pourToCopperMm`
and the floor undeclared on the byte-stable cloud wire (fixed — both stripped, §9 / §13); §14
over-claimed "every scalar kind" (two are in the golden, four in `drc-scalar-rules`; corrected);
the parity test lacked the live-gate leg and its scoped relaxation sat below the floor (fixed —
four legs, relaxation observable); the `clearanceBound` sizing comments overstated the bound and
the live-preview broad-phase kept a hardcoded 5 mm halo that a scoped rule can exceed (fixed —
one `maxClearanceBoundMm` per projection); the live row's parity sentence was broader than the
code (corrected: trace–pad keeps the AABB / side-layer gap until S8); the KiCad commit-time
unknown-net / unknown-class warnings had no test (added). Confirmed correct: pour composition and
zone–zone symmetry, the eight five-argument `pourParamsForZone` call sites, the census greps,
the via gate, HTTP = SDK reports, the store fallbacks, the golden's two-hotspot witness outside
the area.

Astra also confirmed as surviving: the floor clamp, either-item relaxation semantics (a policy,
stated), first-match-then-board-minimum for scalars (with the shadowing caveat now documented),
priority + array index as a total order, protected-code suppression, null-net handling, unit
consistency (1e-6 mm = 1 nm; GEOM_EPS = 0.5 nm; short = 100 nm; bucket = 0.1 mm). Its "needs
verification" list (KiCad precedence and `min_clearance` default, the 0.5 mm zone default,
Altium conventions, finite-value validation, the 32nd area bit) is carried as such; the area
cap is applied before shifting (31 usable bits) to avoid the signed-bit ambiguity it noted.
