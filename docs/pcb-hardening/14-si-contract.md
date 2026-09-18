# 14 — Signal-integrity v1: routed length and diff-pair coupling (S14)

> Status: **BINDING** (S14 closed 2026-09-13; drafted the same day). Companion: `PROGRAM.md` S14 row,
> `../drc/OPEN_FINDINGS.md` "S14" (B8-1..B8-7), `drc-audit-b8.test.ts`.
> Ledgers: §12.0 (plan-critique, 26 findings) and §12.1 (Astra run 1, spec-attack, 15 findings)
> are folded into the text below; every "(critique #n)" / "(Astra #n)" marks where.

## 0. Scope

In scope: what "routed length" and "coupled length" MEAN and how they are measured —
`NET_LENGTH_OUT_OF_RANGE`, the new `NET_LENGTH_UNDEFINED`, `DIFF_PAIR_GAP`, `DIFF_PAIR_SKEW`,
`DIFF_PAIR_UNCOUPLED_LENGTH`; the junction locations the S1 connectivity sweep emits for them;
the ONE diff-pair identity; the route / tune HUD gauges as consumers. Resolves 00 §4 item 4, 01
§4's "contact locations for length walks", 06 §7's canonical-order note in `checks/length.ts`,
and the "scheduled, not sanctioned" private connectivity answers in the designer `AGENTS.md`.

Out of scope, with owners: impedance, propagation delay, crosstalk, real stack-up (per-layer
dielectric and copper, inner-layer elevations) — S15b (contract 15 §3, §4); tune meander generation, bundle lanes,
diff-pair routing — S17; ERC; the cloud snapshot (strips `diffPairGapMm`; `diffPairs` /
`lengthMatchGroups` enter only the content digest); the live gate — every code here is batch-only
(`DRC_STAGES`, never `LIVE_CODES`), recorded as a boundary.

## 1. Junctions — where the S1 model's contacts are (D1)

`computeConnectivity(items, { epsMm?, junctions?: boolean })`. Junctions are emitted only on
request (default off; `dangling`, `connectivity`, `copper-pour` pay nothing — critique #17). The
hook is the `copperTouch` site of the per-layer sweep; components and contact records are
untouched, so every existing S1 result is byte-identical with the option on or off.

A **contact component** is a maximal run of touching (segment, segment) pairs between two copper
items on one layer — or between NON-ADJACENT segments of one trace (Astra #1) — two touching
segment pairs belong to one component only when their contact spans OVERLAP on BOTH traces (the
sublevel intervals at radius `hwA + hwB + eps` intersect on each side); index adjacency alone fused
two distinct crossings on adjacent partner segments into one junction (R1 #3). One item pair may produce several components (a trace crossed
twice by another: two junctions; Astra #1). Each component yields ONE junction whose parameters
are arc-length positions (mm) on each trace side:

- `point` — the centrelines intersect inside the component: the intersection parameters (exact).
  Otherwise the point of minimum centreline distance (unique for non-parallel segments); for
  parallel / collinear runs the MIDPOINT of the contact interval on the lexicographically smaller
  trace and its closest point on the other (canonical). A near-parallel merge at angle θ over a
  band of length b locates the join within the band; the path length is then uncertain by at most
  `b · (1 − cos θ)` (≤ 0.04 mm for a 20° merge of 0.2 mm traces) — stated limit (§10). No
  `overlap` kind and no parallelism test (Astra #12): overlapping copper is `TRACE_OVERLAP`'s fact
  (DFM contract 11 §5.7), the path model does not re-derive it.
- `self` — a trace's own end cap on its body (`capTouchesOwnBody`, the existing witness) or two
  non-adjacent segments of one trace touching (Astra #1): the same `point` rule on one trace.
- **Terminal contacts** (trace–pad, trace–via) — see §2.2.

The witness is computed by the SAME primitives the boolean uses (`polylineToPolylineClosestPoints`,
`pointToPolylineDistance` with its best segment, the rounded-shape gap): the boolean is
`witness !== null`. There is no second oracle (critique #7). Hygiene: one record per unordered item
pair per layer per component (a multi-layer pad / via pair visited once per shared layer is
collapsed), sorted by `(a, b, layer, sA[0])` before freeze; zero-length polyline segments are
skipped as sources (the records boundary does not sanitise `pointsMm`, critique #25).

## 2. The net path model (D2) — `src/shared/pcb-connectivity/net-path.ts`

### 2.1 Terminals
A terminal is a LOGICAL PIN (`CopperPadAnchor` — every copper item of one pin is one terminal,
as `ratsnest.ts` unions them; critique #3) or a free pad. A MULTI-LAYER unplated pad is never a
terminal: its per-face items are null-net (13 §4) and never join a named component. A drilled
single-layer (`smd` / `conn`) free pad keeps its net (10 §2.4) and IS a terminal (R1 #10).

### 2.2 Terminal attachment and interior clipping
For every S1-approved trace–terminal contact the trace's centreline is partitioned by the two
sublevel sets of the terminal's exact copper `C` (pad `rounded` = convex core ⊕ disc; via =
barrel disc), per segment ONE closed interval each (§4.1's primitive):
`INSIDE = {s : dist(P(s), core) ≤ r}` and `TOUCH = {s : dist(P(s), core) ≤ r + hw + eps}`.
- Every `INSIDE` interval is CLIPPED out of the path (copper inside a terminal is not routed
  length — Decision 1) and both of its boundary parameters attach to the terminal with zero-weight
  edges. A trace may enter and leave the same terminal several times, and a terminal may sit in
  the MIDDLE of a trace — each interval is clipped, so a pin the trace passes through becomes an
  interior node, never a length (Astra #3).
- If `INSIDE` is empty but `TOUCH` is not (the copper overlaps, the centreline never enters —
  Astra #2), the trace attaches at the point of minimum centreline distance to `C` (the midpoint
  of the `TOUCH` interval when that distance is constant); nothing is clipped.
- An end cap touching without either set being non-empty cannot occur: the S1 predicate IS the
  `TOUCH` condition.
- One trace may meet one terminal in SEVERAL disconnected contact components (a trace that runs
  past a via twice); every component is resolved on its own — a TOUCH-only component is never
  dropped because a sibling component has INSIDE spans (Astra run 2 #1).

### 2.3 Graph
Per net: nodes = every trace cut (0, L, every junction and attachment parameter), one node per
(via, span layer), one per terminal. Cuts on a trace are clustered by sorting and starting a new
cluster whenever `value − clusterStart > CONNECT_EPS_MM` (bounded diameter, canonical
representative = the cluster start; Astra #13). Edges = consecutive cuts along a trace (weight =
exact arc length between the parameters, a nonnegative float), barrel edges between adjacent span
layers of a via (weight per §2.5), zero-weight junction / attachment edges. Pour islands are not
edges (§2.6).

### 2.4 Uniqueness and the measured subtree
1. Contract every zero-weight edge (a via dropped on a pad at a trace end is a pad–via–trace
   triangle — one node; critique #1).
2. Compute bridges (DFS lowlink, O(V + E)). Parallel edges keep their identity (two coincident
   trace records are two edges, neither a bridge; Astra #7).
3. **Unique ⟺ every terminal lies in ONE component of the bridge-only forest** (Astra's surviving
   statement). Otherwise `loop`. Rings hanging off one node and fold-backs are not on any
   terminal-to-terminal route and do not spoil uniqueness; a ring THROUGH two path nodes, a full
   duplicate record (both its ends attach to the same two terminals) and a partial duplicate whose
   two ends reach copper through TWO DIFFERENT contact components do. A partial duplicate lying
   entirely on one trace is one contact component → one junction → a pruned branch (B8-1b).
4. The measured set is the MINIMAL SUBTREE of that forest component spanning the terminals:
   iteratively prune non-terminal leaves; count each retained edge once. No shortest-path or
   shortest-walk search anywhere (Astra #7, #15). Copper outside the subtree — dangling branches,
   hanging rings, a partial duplicate touching at one component — is `branchLengthMm` (reported in
   messages, never summed; `TRACK_DANGLING` / `TRACE_OVERLAP` own it).

`topology` = `chain` when exactly two terminals, `tree` when ≥ 3 (fly-by chains and T's get one
number: the tree total — Decision 3).

### 2.5 Vias
A via node per span layer, joined by barrel edges. The ONLY defined barrel length is a
THROUGH via traversed OUTER-TO-OUTER: the retained barrel edges must be the whole `F.Cu ↔ B.Cu`
span, and their sum is `boardThicknessMm` exactly (no stack-up assumption). Any retained barrel
that enters or leaves at an inner layer, and any non-through via (`blind | buried | micro` — no
inner-layer elevation exists; S11 already refuses them at export), makes the path `undefined
(via)` (Astra #4, critique #13). A barrel whose remaining span is a pruned branch costs nothing.

### 2.6 Pours
A pour island of the net is not an edge, but it CAN bypass the path. The island's CONTACT SET
with the measured subtree is the union, over retained edges, of the arc-length spans where the
edge's copper touches the island (ring edges as segment targets at radius `hw + eps`, plus spans
whose centreline lies inside the island) together with one contact per pad / via member of the
subtree at its node, projected onto the subtree as a point set. The island BYPASSES iff that set
has two or more CONNECTED COMPONENTS (spans that touch, or meet at a shared node, are one) →
`undefined (pour)` (Astra #6; R1 #1 — item granularity was wrong: a trace maps to ≥ 2 cut nodes).
Islands that touch each other are grouped FIRST and their contact sets merged — two overlapping
islands from different zones bypass a route jointly exactly as their union would (Astra run 2 #5).
A segment lying wholly inside an island (no boundary crossing) is a contact span in full, so
collinear subdivision of an enclosed stretch never splits one contact into two (Astra run 2 #4).
A plane stitched at one place, or an island lying along one continuous stretch of the route,
leaves the path defined. A net whose terminals are joined ONLY by a pour is `undefined (pour)`.

### 2.7 Result
```
NetPath =
  | { kind: "defined"; lengthMm; copperLengthMm; viaLengthMm; viaCount;
      terminals: PinRef[]; topology: "chain" | "tree"; branchLengthMm;
      segments: PathSegment[] }           // { layer, pointsMm, s0, s1, traceKey, halfWidthMm } in walk order
  | { kind: "undefined"; reason: "open" | "terminals" | "loop" | "pour" | "via" | "unresolved" }
```
`unresolved` — the terminals share an S1 component yet no path edge joins them and no island
bypasses: an S1-approved contact the junction model could not locate (a kernel limit — reported,
never passed; R1 #6). `computeNetPaths` REFUSES a connectivity result computed without
`{ junctions: true }` (throws) rather than misreporting it.
`open` — terminals in different components (silent; `UNCONNECTED_NET` owns; a layer-invalid
pad / via lands here and already carries `PAD_LAYER_MISMATCH` / `VIA_LAYER_SPAN`). `terminals` —
0 or 1 pin (silent). `loop` / `pour` / `via` — reported (§3, §8).

## 3. Length (D3)

`NET_LENGTH_OUT_OF_RANGE` measures `lengthMm` (`copperLengthMm + viaLengthMm`) of a DEFINED path
against the group target; `longest` = the longest DEFINED member (self included, as today; the
HUD's "longest other" is the same helper with an `exclude` argument — §6). `NET_LENGTH_UNDEFINED`
(class `constraint`, severity warning, anchors `{net}` + `{lengthGroup}` or `{diffPair}`) for a
`loop | pour | via | unresolved` member — the rule is never silently inert (05 §0). The
`NET_LENGTH_OUT_OF_RANGE` id is unchanged from the polyline-sum era (anchors `net` +
`lengthGroup`, `measuredMm` never hashed), so an existing waiver CARRIES OVER onto the path-model
fact — recorded (R2 #4a; the draft claimed a new id); the semantic change is a release-note event
(TODO.md).

## 4. Coupling (D4)

### 4.1 The primitive
For a straight source segment `M(s)`, `s ∈ [0, ℓ]`, and a convex target `T` (a segment, a point
— a degenerate segment is a point target, never skipped, Astra #10 — or a pad core), the set
`{s : dist(M(s), T) ≤ R}` is EMPTY, a point or ONE closed interval, because the distance from a
point moving linearly to a convex set is convex in `s` (Astra: survived). It is solved in closed
form (perpendicular strip band ∪ the two endpoint discs; `R < 0` → empty). This ONE primitive
(`pcb-geometry/segment-sublevel.ts`) serves §2.2 and everything below.

### 4.2 Definitions, per member `M ∈ {P, N}` with a DEFINED path
`g_M(s)` = min over the PARTNER'S COPPER TRACES on the same layer (every trace item of the
partner net — not its path, so an open or looped partner still lets `M` be measured; vias are not
copper to couple to) of `dist(M(s), seg) − (w_M + w_seg)/2`, actual widths. With `t` = `gapMm` →
class `diffPairGapMm` (both members' classes must agree when the pair has no explicit `gapMm`,
else the pair is a `DRC_RULE_INVALID` row and nothing is judged — Astra #14), `tol` = `gapTolMm`,
`G` = `couplingMaxGapMm` (new explicit `PcbDiffPair` field; default `4·t + 0.1` — TODAY'S window,
kept so nothing moves unexplained and documented as DEFINITIONAL, not physical; Astra #9 restored
it after rev 2 had dropped the maximum-gap verdict):
- `coupled_M = {s : g_M(s) ≤ G}` — union of per-(M-seg, partner-seg) intervals from §4.1.
- `tight_M = {s : g_M(s) < t − tol}` (gate-free — a clearance-like fact).
- `wide_M` = the union, over (M-seg, partner-seg) pairs whose FOLDED direction angle is ≤
  `COUPLING_ANGLE_DEG = 15°` (today's constant; anti-parallel folds to parallel; decided by the
  direction-invariant `dot² ≥ cos²(15°)·|a|²|b|²`, never by `atan2` folding — reversing a
  segment's points cannot change the verdict, Astra run 2 #3), of the STRIP
  interval `{s : the perpendicular foot of M(s) lies within the partner segment AND
  perpendicular distance − halfSum ∈ (t + tol, G]}` — affine in `s`, exact. Cap and corner
  transition bands (a partner ending, a jog departing) are coupled-but-not-wide: they are
  departures, not a pair routed at the wrong gap (amendment 2026-09-13, from the `golden-si-2l`
  authoring — every partner end cap produced a ≈ 0.64 mm `DIFF_PAIR_GAP` error row). A point can
  therefore be coupled, out of band and not wide. `coupled` / `tight` stay gate-free, so the
  uncoupled measure does not move. The kernel realises
  `tight` as the closed set `{g ≤ t − tol − eps}` under the `below()` regime — identical in measure,
  differing only at exact equality (R1 #7). A table with `t − tol > G` is rejected by the rule
  model as `DRC_RULE_INVALID` (its tight band lies outside the coupling window; R1 #8).
- **`DIFF_PAIR_GAP`** fires iff `offBand_P > 0` or `offBand_N > 0`, where `offBand_M =
  measure(tight_M ∪ wide_M)` on that member's own arc length. `measuredMm` = `max(offBand_P,
  offBand_N)` — the same off-band stretch seen from both members is reported ONCE (the message
  states both figures; the worse member carries the marker, ties → the smaller net id). Exact from
  interval endpoints; no lower-envelope maximum is needed (critique #2); the message states the minimum copper gap
  (complete for a MIN of convex pieces: perpendicular feet, endpoints, interior intersections) and
  the first boundary point where `g` leaves the tolerance band, which is the reported location.
- **`DIFF_PAIR_UNCOUPLED_LENGTH`**: `uncoupled_M = copperLengthMm_M − measure(coupled_M)` (2D
  copper only, never via z — critique #14); reports `max(uncoupled_P, uncoupled_N)` with that
  member as anchor. Symmetric in P / N by construction (critique #8).
- **`DIFF_PAIR_SKEW`** = `|lengthMm_P − lengthMm_N|` (through-via z included), judged ONLY when
  both members are `chain`s: tree totals cannot establish endpoint skew (Astra #5) — a `tree`
  member gets `NET_LENGTH_UNDEFINED` with the `diffPair` anchor and reason `multi-terminal` for
  the skew verdict, while its uncoupled measure is still judged over the subtree.
- No angle gate on `coupled` / `tight`. A same-layer P / N crossing is a short (clearance's); a
  perpendicular approach contributes at most `2·(G + halfSum)` of coupled measure per approach —
  bounded per event, not board-wide (Astra: survived, quantified); pruned stubs contribute
  nothing. The 15° gate applies to `wide` only (above).
- No target → no coupling verdicts (skew only) plus a `DRC_RULE_INEFFECTIVE` row naming the pair;
  today's 1.0 mm fallback window is removed as an invented constant (Decision 6). Without an
  explicit `gapMm`, ONE member's class declaring `diffPairGapMm` while the other's does not is a
  disagreement (`DRC_RULE_INVALID`, nothing judged) — the pair's intent is not inferred from one
  side (WP3 deviation 4). `maxUncoupledMm` 15 and `maxSkewMm` 0.5 keep today's defaults in the same
  constants object (`DIFF_PAIR_DEFAULTS`).
- Boundaries use the ONE comparison regime: `below(g, limit)` at `DRC_EPS_MM`, i.e. the 06 §5
  grace — a gap within float error of a limit may still flip under rigid translation (Astra #11);
  the policy is recorded, not changed (13 §3.5 precedent).
- Candidate enumeration: partner segments are prefiltered by a sorted-bounds sweep with halo
  `max(G, t + tol) + eps + halfSum`, the sweep axis chosen per layer so that two long parallel
  runs sharing an x-extent are not scanned quadratically (Astra run 2 #8); the kernel is
  O((p + q) log(p + q) + k) per pair, `k` = near pairs (Astra #15). The SI check builds each
  member's `CoupledPath`s from the path segments' OWN `traceKey` / `halfWidthMm` — never by
  matching endpoints back to trace items (Astra run 2 #2).

## 5. Identity (D5)

`src/shared/drc/diff-pair-resolver.ts` owns ONE suffix table: `_P/_N`, `_+/_-`, trailing `+/-`
(bare `P/N` removed — it paired `VIP` / `VIN`; Decision 4). Matching is case-insensitive on the
suffix; partner-NAME generation is case-preserving (`lvds0_p → lvds0_n`). Explicit
`board.diffPairs` rows win; two explicit rows over the same unordered net set with DIFFERENT
parameters are a `DRC_RULE_INVALID` row (Astra #14); an inferred pair whose base name has more
than one positive or negative candidate (`CLK_P`, `clk_p`, `CLK_N`) is REJECTED and reported as
ineffective rather than resolved by insertion order. Two functions: `resolveDiffPairs(explicit,
netNames)` (board state) and the pure `diffPairPartnerName(name)`; the frontend `tools/diff-pair.ts`
re-exports the latter, and the bundle partner pick consults `resolveDiffPairs` first. The
`diffPair` anchor is canonicalised with `pNetId < nNetId` ordering inside the key (Astra #14) —
every `DIFF_PAIR_*` id on a stored board whose row has `pNetId > nNetId` therefore MOVES once
(existing waivers on such rows expire; release-note event, R2 #4b). A self-referential explicit
row (`pNetId === nNetId`) and two explicit rows over different net sets sharing one net are
`DRC_RULE_INVALID` (a net belongs to at most one pair; R2 #7): a shared net rejects EVERY row that
claims it (one report per shared net), an identical duplicate row dedupes silently, a duplicate
with different parameters keeps the first row and refuses the later one; a refused row still
CLAIMS its nets — on EVERY rejection path, self-referential rows included (Astra run 2 #7) — so a
broken explicit table never falls back to name inference with default parameters. A conflict's
`DRC_RULE_INVALID` anchor is derived from the canonical conflict identity (sorted row ids + the
shared net), never from row order (Astra run 2 #6).
The bundle tool's partner index (`buildDiffPairIndex`) consults `resolveDiffPairs` first and falls
back to the name function ONLY for a net with no `netNames` row — a base the resolver refused as
ambiguous stays refused in the frontend.

## 6. Consumers

`checks/length.ts`, `checks/signal-integrity.ts` read `ctx.netPaths()` (lazy memo over
`connectivity({ junctions: true })`). The frontend hook `use-net-path-lengths.ts` runs the same
`net-path.ts` over `buildBoardCopperItems` → `computeConnectivity(items, { junctions: true })`
(no pours; `computeBoardConnectivity` has no junction option) for the route / tune gauges
(`PcbCanvas.tsx` targets + committed lengths, `route-hud-model.ts` / `tune-hud-model.ts`); a
pour-bypassed or open path falls back to the committed polyline sum with `pathDefined: false`,
rendered as "≈" (the open net is the NORMAL mid-route state). Gauge total = path length of the
net + the in-flight session polyline (Route: `committedMm + sessionLengthMm`; Tune:
`pathLengthMm + (proposal − baseline)`) — the in-flight segment is a plain-polyline
approximation (S16 / S17). The auto-finish proposal length (`PcbCanvas.tsx` ≈6649) measures a
proposed polyline, not a net, and stays `polylineLength`. `length-target.ts` is the ONE
target helper (`exclude` for the gauge). With `exclude` the "≥ 2 defined members" floor is waived —
the gauge compares the session net against the longest OTHER member even when it is the only
other one, which the batch check (self-inclusive, needing two) would not yet judge; a stated,
one-directional divergence (R1 #9). Bundle pitch keeps `traceWidthMm + diffPairGapMm`.

## 7. Determinism

Items in canonical key order; each unordered pair witnessed once in key order; cuts clustered
canonically (§2.3); the subtree walked from the lexicographically smallest terminal key, per-edge
arc lengths summed in walk order (recorded — the last-digit shift versus today's `polylineLength`
re-baselines only `golden-census-2l`); interval unions sorted by start; the report sorted by
`(code, id)` as 06 §6. Swapping P / N leaves every id, `measuredMm` and `locationMm` byte-identical; the message's
member order and the `diffPair` anchor PAYLOAD (`pNetId` / `nNetId`, retained as stored —
`violation-id.ts`) follow the board's orientation (R2 #6). Reversing every input array is
byte-identical (`drc-audit-b8` B8-3, `net-path.test.ts`). Splitting one polyline record into
several records with the same geometry is NOT byte-identical — the arc prefix sums restart per
record — and agrees to ≈ 2 ulp (Astra run 2 #1's split fixture, `toBeCloseTo(…, 12)`);
determinism is a claim about input ORDER, not about record decomposition (stated).

## 8. Report contract

| Code | Class / severity | Anchors | `measuredMm` |
|---|---|---|---|
| `NET_LENGTH_OUT_OF_RANGE` | constraint / warning | net + lengthGroup | path length (mm) |
| `NET_LENGTH_UNDEFINED` (new) | constraint / warning | net + lengthGroup or diffPair | — (message carries the reason) |
| `DIFF_PAIR_GAP` | signal-integrity / error | diffPair (canonical) | max over members of the off-tolerance coupled length (mm) |
| `DIFF_PAIR_SKEW` | signal-integrity / warning | diffPair | \|L_P − L_N\| (mm) |
| `DIFF_PAIR_UNCOUPLED_LENGTH` | signal-integrity / warning | diffPair + net (the worse member) | uncoupled length (mm) |
Messages name the two terminals, the via count, `branchLengthMm` when non-zero, and the reason
for an undefined path. Locations are exact centreline points (id-safe: none of these codes hash
the location).

## 9. Tests
`drc-audit-b8` B8-1..B8-6 live (with pads); `net-path.test.ts` (T, X, double crossing, self
crossing, non-parallel approach, body-only pad contact, mid-trace pad, full duplicate → loop,
partial duplicate → branch, ring off one node → unique, ring through two nodes → loop, via-in-pad
triangle, through-via outer-to-outer = 1.6, through via to an inner layer → `via`, blind via →
`via`, 3 terminals → tree total, pour hanging off one node → defined, pour bridging two nodes →
`pour`, open, two copper shapes of one pin = one terminal, unplated pad not a terminal, cluster
diameter, reversal + swap byte identity, S1 results byte-identical with `junctions` on / off);
`coupled-span.test.ts` (parallel offset, diverging, converging, jog, the C1 hole, perpendicular
approach bound, point target, overlapping partner segments not double-counted, swap symmetry,
boundary at `limit ± 1e-9`, a brute-force sampling oracle at 1e-4 mm on random pairs);
`drc-si` / `drc-length` rewritten with pads; `drc-s7-review-fixes` / `drc-review-fixes` re-fixtured;
resolver (rejected ambiguity, conflicting explicit rows, case-preserving partner names); Vitest
for the HUD hook (`use-net-path-lengths.test.ts`, `tools/diff-pair.test.ts`); goldens:
`golden-si-2l` NEW (104 primitives, regions A–P, 24 violations / 10 codes — 3 errors / 21
warnings; every SI / length code and both rule codes provoked; attributed per region with the
closed-form arithmetic), `golden-census-2l` re-fixtured (pads on `dp_p` / `dp_n` / `lg1`, a
looped `lg2`) and re-baselined 87 → 85 with attribution, the other nine byte-identical.

## 10. Stated limits
- Copper inside terminals AND inside via barrel discs is not routed length (KiCad counts both):
  a through via on a path contributes `boardThicknessMm` minus nothing, but the trace copper
  inside its disc on each layer is clipped (B8-5: two Ø 0.8 vias → +3.2 − 4 × 0.4 = +1.6 mm).
- A via is "through" by its RESOLVED SPAN (`F.Cu … B.Cu` over the whole stackup), not by
  `viaType`: the copper items carry no type; a mislabelled type is `VIA_LAYER_SPAN`'s.
- Contract 06 §5's regime table lists SI / length under "bare `<` / `>`"; §4.2 here uses `below()`
  at `DRC_EPS_MM`. 06 §5 is amended when this contract goes binding (WP6).
- A near-parallel merge locates its junction within the contact band: ≤ `b·(1 − cos θ)` length
  uncertainty; overlapping copper is reported by `TRACE_OVERLAP`, not modelled as a conductor.
- Two identical trace records are a `loop` (Astra #8: a conservative verdict on a data defect,
  co-reported by `TRACE_OVERLAP`).
- Inner-layer via traversal and every non-through via → `undefined (via)` until S15b supplies
  elevations. Contract 15 §4.6 binds how: a board with a valid declared stack-up uses ONE additive
  axial metric for all its vias (through vias included); a board without one keeps §2.5 verbatim.
- Uncoupled and coupled measures are 2D; via barrels neither couple nor count as uncoupled.
- Skew is defined for chains only; tree members report `multi-terminal`.
- The HUD omits pours and approximates the in-flight segment.
- Float boundaries follow the 06 §5 grace regime.
- A pair that DEPARTS (a cap, a corner, a jog leg, a stub leaving at an angle) is never a
  `DIFF_PAIR_GAP` fact; `DIFF_PAIR_UNCOUPLED_LENGTH` owns departures (§4.2 `wide` on strips only).
  The `tight` half stays gate-free, so a too-close departure still reports.
- A GAP message names an unmeasured member (open / looped / via partner) as `n/a`, never as a
  figure (R2 #8). Each `coupledSpans` call computes both members and one side is discarded —
  redundancy, measured nil at 400 traces (R2 #9).
- `t + tol > G` and `t − tol > G` are both `DRC_RULE_INVALID` (R2 #5).
- `bandExitMm` is the first point of the walk where `g` is off-band inside the coupled set; a
  member that STARTS off-band reports its walk start (R1 #11).
- The R1 witness-refactor invariant: every touch predicate compares `distanceMm <= reachMm`
  unsubtracted — `d − h <= eps` differs by an ulp at the boundary and would move S1 verdicts.

## 11. Amendments
- 2026-09-13 (WP3): `DIFF_PAIR_GAP` `measuredMm` is the MAX over members, not the sum over both
  arc-length domains (the draft's "∪" across two parametrisations double-reported one stretch).
- 2026-09-13 (WP5 authoring): `wide` is measured on near-parallel strips only (§4.2); `coupled`
  and `tight` unchanged.
- 2026-09-18 (S15): §0 and §10 repoint the stack-up / elevation IOU to S15b; contract 15 §3 binds how
  any later SI capability extends this contract (the junction graph is the input, never the `NetPath`
  scalars; join, never rename; broadside coupling and stitched copper get new measures / variants).
- 2026-09-13 (R1): §1 merge rule, §2.1 single-layer unplated pads, §2.6 contact-set rule, §2.7
  `unresolved`, §4.2 `t − tol > G` invalid, §6 `exclude`, §10 additions.

## 12. Ledgers

### 12.0 Plan-critique (Opus `reviewer-critical`, 26 findings), 2026-09-13
Blockers: #1 zero-weight cycles (via-in-pad) → contraction before the bridge test; #2 incomplete
extremum candidates → `DIFF_PAIR_GAP` redefined as an off-tolerance MEASURE (no envelope maximum);
#3 per-shape terminals / unplated faces → logical pins, unplated never terminals. High: #4 `open`
stays silent (recorded, connectivity owns); #5 trace-only fixtures go silent → every S14 fixture
carries pads, `drc-s7-review-fixes` / `drc-review-fixes` owned by WP3; #6 crossing measure → a
same-layer P/N crossing is a short, bound stated; #7 no second oracle → witness variants of the
same primitives; #8 GAP symmetry → both members; #9 six HUD sites + `longest` semantics → one hook
+ `length-target.ts`. Medium: #10–#18 (WP ordering, `index.ts`, summation order, via z-model →
through outer-to-outer only, 2D uncoupled, entry-point attach → clipping, frontend partner
function kept pure, opt-in junctions, multi-terminal → tree total). Low: #19–#26 (counts, sort
before freeze, per-layer duplicates, self junctions, cluster rule, zero-length segments, waiver
carry-over) — all folded.

### 12.1 Astra run 1 (spec-attack, xhigh, prompt-only; Astra read repo docs read-only), 2026-09-13
Verdict: "fails completeness — a connectivity witness is not a complete description of where
copper touches". 15 findings; every one verified against the proposal / source: **accepted 13**
(#1 interior self-contacts + multiple contacts per pair; #2 body-only pad attachment; #3 clip
every interior interval; #4 inner-layer via traversal undefined; #5 skew for chains only; #6 pour
bypass rule; #7 bridge-only forest + minimal subtree, no walk; #9 maximum-gap verdict restored via
`couplingMaxGapMm`; #10 point targets; #11 the 06 §5 regime recorded; #12 no parallelism test at
all (junction = canonical point of the contact component); #13 bounded cluster diameter; #14
symmetric class-gap rule, ambiguity rejection, canonical anchor; #15 no NP-hard walk, swept
candidates), **1 recorded as a bound** (#8 coincident duplicate records stay `loop`, a data
defect co-reported by `TRACE_OVERLAP`), **0 rejected**. Survived: the one-interval claim, the
minimum-gap candidate set, symmetric unions, the perpendicular bound, forest-component uniqueness.

### 12.2 R1 (`reviewer-critical`, executed probes) on WP1 + WP2, 2026-09-13
11 findings. Fixed in WP1 (fix round): #1 pour bypass at item granularity → the contact-set rule
(§2.6); #2 vacuous determinism fixture; #3 index-adjacent merge fusing two crossings → overlap
rule (§1); #4 `self` cap junction at the far-end witness → §1 point rule; #5 unfiltered O(n²)
`traceSelf` → bounds sweep; #6 silent `pour` without junctions → throw + `unresolved` (§2.7).
Rule model (WP3): #8 `t − tol > G` → `DRC_RULE_INVALID`. Recorded: #7 closed tight set (§4.2),
#9 `exclude` asymmetry (§6), #10 single-layer unplated pads are terminals (§2.1), #11 `bandExitMm`
at the walk start (§10). Accepted surface: S1 byte-identity over 200 random boards and 283 200
ordered pairs against HEAD's predicate; every §2.2 / §2.4 / §2.5 / §4 probe listed in §9.

### 12.3 R2 (`reviewer-critical`, executed probes) on WP3–WP5 + the gate wiring, 2026-09-13
9 findings, verdict fix-required. Fixed: #1 OPEN_FINDINGS gate line + B8 closure (docs); #2
census attribution numbers (1.850, 40 / 39 codes); #3 the tune gauge's `Math.max(0, …)` clamp
contradicting batch on a single-trace net (WP4); #5 `t + tol > G` invalid (WP3); #7 self /
shared-net explicit rows invalid (WP3); #8 `n/a` for an unmeasured member (WP3). Recorded: #4a
waiver carry-over on `NET_LENGTH_OUT_OF_RANGE` (§3), #4b `DIFF_PAIR_*` id migration (§5), #6 §7
wording, #9 redundancy. Accepted surface: every verdict path (class gaps equal / one-sided /
disagreeing, no target, `loop | tree | via` members, open partner), swap and reversal identity,
resolver table incl. `VIP`/`VIN`, `parseDiffPairs` over HTTP, `connectivity()` unperturbed by
`netPaths()`, `wide` vs an independent 5e-4 oracle (3.96e-4 worst), all eleven goldens re-derived
byte-exact, `runDrc` 98 ms with / without a length group at 400 traces.

### 12.4 Astra run 2 (adversarial-verify, xhigh, repository-grounded, executed probes), 2026-09-13
8 findings, every one reproduced by Astra with a `bun --eval` probe; all 134 S14 tests passed at
the time. **All 8 accepted and fixed**: #1 repeated trace–via contacts collapsed to the first
(20.7 mm for a 9.8 mm route — TOUCH-only components dropped when a sibling had INSIDE spans;
§1 / §2.2, WP1); #2 the SI check matched source widths by endpoints, so a pruned narrow trace's
width suppressed `DIFF_PAIR_GAP` entirely (8.964 mm too tight reported as 0) — `PathSegment` now
carries `traceKey` + `halfWidthMm` (§2.7, WP1 + WP3); #3 the 15° `wide` gate flipped under
point reversal at the exact boundary (trigonometric folding) — direction-invariant squared-dot
predicate (§4.2, WP2); #4 collinear subdivision inside an island manufactured a false `pour`
(§2.6, WP1); #5 two overlapping islands jointly bypassing a route were judged one at a time —
islands are grouped by contact before the component count (§2.6, WP1); #6 the shared-net
`DRC_RULE_INVALID` id followed row order (§5, WP3); #7 a rejected self-pair row did not claim
its net, so name inference ran on it (§5, WP3); #8 the coupling sweep was quadratic when
x-extents overlap with zero candidates (448 ms at 6 000 vertices; 0.5 ms rotated 90°) — the
sweep axis is chosen per layer (§4.2, WP2). Also from the run: B8-3's byte-identity fixture was
vacuous (`gapTolMm 10` > the window → invalid pair, empty arrays) — re-fixtured. `netPaths()` on
a 5 000-item board with one 3 000-point net: ≈ 29 ms.
