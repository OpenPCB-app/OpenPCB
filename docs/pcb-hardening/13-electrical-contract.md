# 13 — Electrical-rule contract (S13)

Status: **binding** (S13 closed 2026-09-12). Session S13 of `PROGRAM.md`. Owns B7-1
(`docs/drc/OPEN_FINDINGS.md`). Companion to `05-rule-semantics-contract.md` (rule resolution),
`06-batch-drc-contract.md` (the batch engine), `07-live-parity-contract.md` (the live gate) and
`11-dfm-contract.md` (the mask model this contract reads).

The program's principle for this session: no check claims more than its model proves, and
every electrical constant is sourced. This document states, for every electrical verdict, what
is measured, under which declared assumptions, from which pinned transcription, and what is
left unassessed.

## 0. Scope

In scope: the IPC-2221 conductor-spacing requirement by net voltage (`CREEPAGE_DISTANCE`), the
IPC-2221 current-versus-width estimate (`TRACE_CURRENT_WIDTH`), the rule tier of unassigned
copper (B7-1), the constants both checks read, the design-rule and net-class fields that carry
electrical data, and every consumer of the rule resolver that inherits the voltage term: the
pair judge, the copper-pour halo, the route-obstacle builder and the live gate.

Every earlier "S13" line is resolved here: 05 §0 (electrical thresholds out of that contract's
scope) and its regime note ("`CREEPAGE_DISTANCE` keeps `below()` (S13)" — §3.5 below); 06 §3
(the `electrical` row), 06 §4 (B7-1) and 06 §9; 07 §3 (electrical excluded from the live set),
07 §9 and the S8 ledger row registering B7-1; 00's electrical / ERC rows; OPEN_FINDINGS B7-1 and
§6.6.

Out of scope, with owners: signal integrity and length (S14, `14-…`); stack-up, per-layer
dielectric and plane layers (S15); ERC (schematic-only, reads no voltage); the rules UI for
voltage, current and the electrical block (backlog P12); the cloud snapshot, which strips
`voltageV` / `currentA` by contract (OPEN_FINDINGS §6.10) — there is no electrical parity
server-side, and this contract records that as a boundary, not a defect.

## 1. What is measured, and what is claimed

### 1.1 The conductor-spacing verdict

For a pair of copper items on one copper layer, the measured quantity is the straight-line
edge-to-edge copper gap on that layer, computed by the one gap module (`pair-gap.ts`, exact
rounded pads since contract 12 §1). It is compared with the IPC-2221 Table 6-1 value for the
pair's voltage differential (§2) and the pair's conductor column on that layer (§1.2).

The supportable claim, verbatim for labels and documentation:

> OpenPCB checks the modelled same-layer copper separation against the selected IPC-2221B
> Table 6-1 transcription, under the declared net-voltage assumptions, the applicable conductor
> column and the stated numerical tolerance. Undeclared voltages and excluded geometry are
> unassessed.

What the verdict does NOT establish (each a stated limit, §10): creepage along a real surface
path (slots, board edges, mask edges are never credited or debited); air clearance across a
routed edge between `F.Cu` and `B.Cu` (cross-layer pairs are not judged at all); insulation
coordination or dielectric withstand between layers; clearance to assembled component leads,
solder or hardware; the altitude column B3, the assembly columns A5–A7; whether the board's
solder mask qualifies as a "permanent polymer coating" (§1.2); the manufactured (as opposed to
nominal) gap. The straight-line gap is a lower bound of every surface or air path between the
two modelled copper sets, so for the modelled copper the verdict direction is false-fail — the
claim stops at "the modelled copper"; it never says "false-fail only" for the physical board.

### 1.2 Conductor columns

| Layer | Column | Condition |
|---|---|---|
| any `In*.Cu` | B1 — internal conductors | always |
| `F.Cu` / `B.Cu` | B2 — external, uncoated, sea level to 3050 m | default (`electrical.outerConductors` absent or `"uncoated"`) |
| `F.Cu` / `B.Cu` | B4 — external, permanent polymer coating, any elevation | `electrical.outerConductors === "coated"` AND neither item of the pair is exposed on that face (§1.3) |

Exposure is decided per item per face from the S12 mask model (11 §1) with ONE rule for every
item kind: an item is exposed on a face iff the union of ALL mask openings on that face overlaps
its copper (the `ensureMaskOpenings` broad phase over the item's shape). A pad's own opening
exposes it; a tented via is still exposed where a neighbouring pad's opening reaches its copper
(Astra run 1 #4 — tenting says only that the via contributes no opening, never that no other
opening covers it); a trace is exposed where any opening overlaps it. An exposed item is an
uncoated conductor whatever the board-level setting says, so a pair with an exposed side on an
outer layer is always judged in B2. Exposure is a property of the FINAL artwork: in the live
gate it is recomputed with the pending items' openings added and `replaces` removed (§4.4). This is the exposure rule Astra run 0
(§12.0) required: a global "coated" switch passes two 230 V pads 0.5 mm apart (B4 0.4 mm)
while the pads' openings make them uncoated conductors (B2 1.25 mm).

The B4 column is available only with the user's declaration. Whether a liquid-photoimageable
solder mask qualifies as an IPC-2221B permanent polymer coating depends on coverage, openings
and process qualification that OpenPCB cannot see; setting `"coated"` is the user's claim, and
the label of a B4 verdict says so ("coated per design rule").

### 1.3 The current verdict

For each trace item whose (effective, §4) net's class declares `currentA > 0`, the trace width
is compared with the IPC-2221 external / internal empirical width for that current, the
board's temperature rise and the copper weight of the trace's layer class (§5). The claim:

> OpenPCB compares each trace segment's width with the IPC-2221 empirical width estimate under
> the declared class current, the declared nominal copper weight and the declared temperature
> rise, assuming every segment of the net carries the full class current.

It does not establish actual temperature rise (adjacent heat sources, minimum finished copper,
heat spreading are unmodelled), via or pour ampacity, or current sharing between parallel paths.

## 2. The voltage model

- `PcbNetClass.voltageV` is the net's constant DC potential relative to the board reference,
  signed, in volts. Absent means undeclared.
- `PcbNetClass.voltageMinV` / `voltageMaxV` (new, optional, both or neither) declare the
  interval a varying potential occupies (AC, switching nodes, bipolar signals). When absent the
  interval is `[voltageV, voltageV]`. The store rejects `min > max` and any non-finite value
  (fail-closed at `parseNetClass`); the infinite-halo defence of 08 §4 stays as depth.
- The pair differential is `Δ = max(|a.min − b.max|, |a.max − b.min|)` volts. This is exact when
  the two potentials vary independently and conservative when they are correlated; it is the
  interval answer to Astra run 0's counterexample (two 300 V-peak nets 180° apart have Δ = 600 V,
  not 0 — signed peak subtraction was unsound).
- The store never turns a malformed declaration into silence: two finite endpoints are
  persisted as given (an inverted pair reaches the DRC and is reported), a lone or non-finite
  endpoint on an update keeps the stored declaration (a rejected write), on a create it is
  dropped (Astra run 2 #2 — the first draft substituted `{}` and erased a live requirement).
- Undeclared nets (no class, or a class without a voltage) are ASSUMED at the reference
  potential, interval `[0, 0]`. This is an assumption, stated wherever the verdict is shown:
  pairs with an undeclared side are judged under it, not assessed. An explicit `voltageV: 0` is
  the same assumption.
- Applicability: the voltage constituent (§3) exists for a pair only when at least one side
  declares a voltage (a class with `voltageV` or an interval). Pairs where neither side declares
  carry no voltage constituent — the opt-in gate of the pre-S13 check, kept so that boards
  without voltages are byte-identical. When a declaring pair has Δ = 0 the 0–15 V row applies.
- Same-net pairs never carry a voltage constituent (a conductor has no spacing requirement to
  itself; a nonzero-voltage zone never carves a moat around its own net).
- Two DISTINCT nets whose classes declare the same constant potential have Δ = 0; two distinct
  nets whose class declares an interval are independent potentials and get the interval formula
  (a class `[−300, 300]` gives Δ = 600 V between two of its nets — Astra run 1 #1; class
  membership never establishes correlation). Conductors at different constant potentials (mains
  L and N, the two rails of a bipolar supply) need two classes.
- Declared potentials are compared at 1 µV precision: `Δ` is rounded to the nearest 1e-6 V
  before band selection, so decimal declarations whose float difference lands a few ulp above a
  band edge (−9.95 and −39.95 → 30.000000000000004) select the band their decimal difference
  names (Astra run 1 #10). No geometric epsilon is borrowed.
- Invalid electrical input is never assessed silently: a non-finite or inverted interval, an
  endpoint whose magnitude exceeds `MAX_DECLARED_VOLTAGE_V` (1e6 V — a finite float pair such as
  ±1e308 overflows the differential; R1 #2), a non-positive `tempRiseC` or copper weight, a
  `currentA` that is not a finite positive number, or a current / copper weight / rise beyond
  its accepted magnitude interval `[1 / cap, cap]` (`MAX_DECLARED_CURRENT_A` 1e6,
  `MAX_COPPER_WEIGHT_OZ` 1e3, `MAX_TEMP_RISE_C` 1e4 — finite inputs past a cap overflow the width
  formula to `NaN`, Astra run 2 #4, and a tiny positive weight would overflow it the other way;
  the sixteen corners of the accepted box evaluate finite, so the formula's non-finite-result
  guard is unreachable from board data), that escaped the store is reported by the
  `rules` check as `DRC_RULE_INVALID` (error, non-overridable, one row per field, the detail
  naming the field and whether the class still carries a requirement) and the affected
  constituent is absent for that run — the pre-S13 helper answered a `NaN` differential with the
  2.5 mm fallback and a zero rise with a 0 mm width (Astra run 1 #9, #12); both paths are closed.

## 3. The voltage term is a constituent of the resolver

### 3.1 Resolution

`resolveWithMasks(pairKind, layer, a, b, …)` (rule-resolver, 05 §4) returns

```
ResolvedValue = {
  mm,                     // max(ordinaryMm, voltage?.mm ?? 0)
  rule,                   // the explicit rule that set the ordinary value, or null
  ordinaryMm,             // max(explicit-or-implicit value, floorMm) — today's `mm`
  voltage: null | { mm, diffV, column: "B1" | "B2" | "B4", exposed: boolean }
}
```

`voltage` is present iff §2's applicability holds for the pair's tier nets (§4). `voltage.mm =
ipc2221SpacingMm(diffV, column)` with the column from §1.2 for `layer`. The memo key
(`pairKind|layer|netA|netB|maskA|maskB`) is unchanged: voltages are class-level and the column
is a function of the layer and of the two items' exposure — exposure enters the key only when
`outerConductors === "coated"` (two bits).

The voltage term is not relaxable: an explicit scoped clearance rule may set the ordinary
value below the implicit tier (05 §4.1) but never below the floor or the voltage term. 05 §4.1
is amended accordingly. There is no scoped constraint kind for voltage; a board that wants a
looser spacing than the table lowers the declared voltage or removes it, which is visible in
the data, never silent in a rule.

### 3.2 Consumers by construction

Every consumer reads `.mm`, so each inherits the term with no second derivation:

| Consumer | Site | Effect |
|---|---|---|
| Pair judge | `clearance-judge.ts` `layered` / `traceTrace` … | §3.3 — two constituent verdicts |
| Copper pour | `pour-params.ts` `clearancePour` → halo per obstacle | HV copper is carved at the IPC spacing; a same-net zone is unaffected (`pour-params.ts:146`) |
| Route obstacles | `route-obstacles.ts` `requiredAt` | obstacle rects widen per (route net, obstacle net) |

The term is a function of the pair's TIER nets (§4) and of the two items' exposure (§1.2), and
those are not in the resolver's arguments today (Astra run 1 #2, #3): the pour's obstacle
builder (`collectBareCopper` → `clearanceForItem`, `zonePourNets`) and the route-obstacle
builder pass the ORIGINAL item net, and `zoneClearanceResolver` memoises per (kind, net). So:
(a) `zonePourNets` computes the effective-net map itself from the copper records it already
holds (the §4.1 kernel is pure and takes records plus an optional candidate finder; outside the
DRC context a bounds scan over the null items serves), so every pour — DRC, canvas, 3D, export,
snapshot — carves the same copper; (b) every obstacle carries `tierNetId` and `exposed` and the
pour's memo key includes both; (c) the router resolves obstacles by their tier net — over the committed copper PLUS the
session copper it is handed (`input.extra`), through the same per-call overlay the gate builds,
so a session item that extends a named net carries that net's requirement (Astra run 2 #3) —
and, for a route whose own net is null (an unassigned route in progress), by the conservative bound
`max over every declared class of the voltage term for that obstacle` — the route walks
farther than it might need, never closer than it must. Exposure outside the DRC context is
CONSERVATIVE: the fill input and the router carry no mask model, so on a coated board every pour
obstacle and the route itself count as exposed on outer layers (B2) — the pour carves at least
as far as the judge requires and the router keeps at least the judge's distance, never less;
the judge alone applies B4, on the artwork.
| Live gate | `legality.ts` → the same judge | §3.6 |

The pour's obstacle-collection halo and the judge's per-pair prefilter must cover the term
(§3.4); both are gates of the implementation, not assumptions.

### 3.3 Constituent verdicts in the judge

A candidate carries both constituents. `summarize` aggregates each independently:

- Ordinary: `clearanceViolated(gap, ordinaryMm)` → the pair-kind code (`TRACE_TO_TRACE_CLEARANCE`
  …), exactly as before S13 — byte-identical rows and ids.
- Voltage: `clearanceViolated(gap, voltage.mm)` → `CREEPAGE_DISTANCE`, its own row with its own
  id (sorted anchors + layer, not location-hashed — unchanged), its own waiver and severity.

A pair below both requirements produces two rows, as it did before S13. A waiver of one row
never hides the other constituent (Astra run 0: "one row" must not mean "one surviving
reason"). `FAB_CLEARANCE` keeps its else-branch on the ordinary constituent only.

Layered aggregate (05 §4.3, amended): the ordinary constituent keeps 05 §4.3 (first violated
layer in stackup order, strictest violated requirement). The voltage constituent reports the
STRICTEST layer — the first layer in stackup order attaining the largest voltage requirement —
exactly the pre-S13 `strictestSpacing` rule, so every pre-S13 `CREEPAGE_DISTANCE` id (which
hashes the layer) is preserved (Astra run 1 #11). Its column differs per layer (B1 inner, B2 /
B4 outer), so that layer is the outer one whenever an outer layer is shared.

Applicability before the maximum:

- Pads of one footprint: the short tier and the voltage constituent apply; the ordinary and fab
  constituents do not (the library owns geometric spacing inside a footprint, the board owns
  voltages). The `exactShape` guard that skips inexact (`custom` / `trapezoid`) same-footprint
  pairs lets the voltage constituent through on the bounding rectangle (a superset of the pad —
  false-fail direction, stated), so the pre-S13 coverage of those pads is kept.
- Same tier net (§4): no ordinary, fab or voltage constituent. The short tier and the bridge
  record keep the original nets.
- Null-net touches: unchanged from 06 §4 — banked, never a constituent.

### 3.4 Bounds

- The batch loops pass ORIGINAL nets to the judge's `farApart` (the S9 oracle is frozen), so a
  pair with a null side is prefiltered with `maxClearanceBoundMm` — the board's widest
  requirement, already the halo the grid admitted the pair under — instead of the null tier.
- The judge's exact prefilter `clearanceBound(pairKind, netA, netB)` folds
  `ipc2221SpacingMm(Δ(netA, netB), "B2")` (B2 is the widest column for any layer the pair can
  share; B4 ≤ B2 row by row). Without it every HV pair wider than the ordinary bound is dropped
  before resolution (plan-critique #1).
- The clearance broad-phase halo `maxClearanceBoundMm` folds `maxCreepageBoundMm` (the widest
  B2 value over every declared interval, implicit 0 V included). A non-finite voltage that
  escaped the store keeps the infinite halo: a full scan is correct, only slow.
- The pour's obstacle-collection halo covers the term for every obstacle category (gate of
  WP3, verified before the goldens are re-baselined).

### 3.5 Comparison regime

Every constituent uses the clearance regime, `clearanceViolated(gap, required) = gap < required
− GEOM_EPS_MM` (5e-7 mm). The pre-S13 creepage check used the minimums regime (`below`, 1e-6
mm); verdicts with a gap in `[required − 1e-6, required − 5e-7)` flip to FAIL. 05's regime table
and its "keeps `below()` (S13)" note are amended; no pinned test sits in that band. Voltage band
boundaries are in volts, continuous (`Δ ≤ maxV` selects the band); no geometric epsilon is
borrowed.

### 3.6 Live gate

`CREEPAGE_DISTANCE` joins the refuse set `REFUSE_CODES` (07 §6) — it comes out of the same judge
the live gate calls, so live and batch agree by construction; `refusedViolations` filters by
code, waiver and outline dependence, never by effective severity, so a `CREEPAGE_DISTANCE`
downgraded to warning still refuses a commit, exactly as a downgraded clearance does.
`TRACE_CURRENT_WIDTH` joins `LIVE_CODES` as a warning through the per-item form `currentItems`
dispatched after `netClassItems`. 07 §3's exclusion line is retired.

## 4. Effective nets for unassigned copper (B7-1)

### 4.1 Derivation

`pcb-connectivity/effective-nets.ts` is a pure kernel over copper records (traces, pads, vias —
never pour copper) with an optional candidate finder (the DRC grid; a bounds scan otherwise),
so the DRC context, the live gate and `zonePourNets` derive ONE map. It builds the contact graph
under the bridge model's predicate: two items touch when their gap on a shared copper layer is
`≤ SHORT_EPS_MM` (1e-4 mm), measured by the `pair-gap.ts` kernels; a via or a PLATED through
pad joins every layer it exists on; an UNPLATED pad (an NPTH ring, S11 `plated: false`) has no
barrel, so its copper is one node PER FACE and a contact on one face never reaches the other
(Astra run 2 #1 — plating is read from the record, never inferred from geometry). A contact whose either side is an inexact pad (`exactShape === false`,
a `custom` / `trapezoid` bounding rectangle) is a POSSIBLE contact, not a proven one: it never
joins components and never establishes a chain short (Astra run 1 #7 — a bounding rectangle
supports a possible spacing violation, never electrical equivalence); the pre-S13 direct-bridge
banking of such a touch is unchanged. Once two items are proven in one component, no further
gap test between members of that component is run (union-find early exit — Astra run 1 #13). Candidates come from the grid
with a `SHORT_EPS_MM` halo (the full loop in `"exhaustive"` mode, 08 §3). A union-find over the
items gives connected components; the label set of a component is the set of named nets of its
members, collected from an immutable snapshot before any assignment.

| Labels | Result for the component's null-net members |
|---|---|
| exactly one | `effectiveNetId` = that net |
| none | stays null (a net-less conductor) |
| two or more | stays null; the component is a conflict (§4.3) |

The tolerance is deliberately the extension's (06 §4), not connectivity's `CONNECT_EPS_MM`
(5e-7): the two already disagree — copper 50 nm apart is "not connected" for the ratsnest and
"one conductor" for the S8 extension. S13 keeps the extension's tolerance because the effective
net refines the extension; the divergence is recorded in §10 with S18 as owner.

Pour copper is excluded for two reasons: the bridge model excludes it (06 §4), and including it
is circular — the pour is carved with the resolver's halos, which depend on tier nets, which
would depend on the pour. A null item connected to a net only through a pour keeps the null
tier (§10).

### 4.2 Consumers and keepers

`tierNetOf(item) = effectiveNetId ?? netId` is read by: the clearance and voltage constituents
(the six judge sites and `clearanceBound`), the current verdict (§5) and the net-class dimension
checks (their intent gate evaluated on the effective net: an explicit assignment or a name match
of the net the copper extends). The original null net is kept by: the anchors of every draft,
the short tier (`differentKnownNet`), `recordBridge` and the bridge pass. Enumeration in the
clearance loops stays on the original net — their same-net filters run before `emit`, which is
the only place a (null, named) touch is banked; `emit` suppresses the ordinary, fab and voltage
constituents after that branch when the two tier nets are equal.

Consequences: the B7-1 fixture reports `TRACE_TO_TRACE_CLEARANCE` with `requiredMm = 2` in batch
and live; a null item merely close to other copper of the net it extends is a same-tier pair and
reports nothing (a false FAIL against its own conductor, removed); a null trace extending a
3 A / 230 V net is judged for width and spacing.

### 4.3 Chain shorts

A component with two or more labels is a conflict. The direct bridge emitter (06 §4) keeps its
drafts and ids for every null member that touches two or more nets directly. When the union of
the direct drafts' net sets inside the component is NOT the component's whole label set — no
member touches two nets directly (the S7 "chains" limit, 06 §9, closed here), or a further net
reaches the component only through a chain (Astra run 1 #6: `A–X–B` direct plus `Y` bringing
C) — one additional `NET_SHORT_CIRCUIT` is emitted for the component, anchored on its null
members (sorted by anchor key) plus one net anchor per label (sorted by net id), located at the
smallest NULL-member marker (trace mid, pad / via centre — the meaning `recordBridge` already
gives "marker"; a contact-point witness would depend on which union event proved the component
and so on candidate order; the named members are the anchors' net side, not the location's), with `measuredMm = 0` and `requiredMm` = the largest ordinary
requirement among the component's cross-net pairs. Direct-draft coverage is computed from the
kernel's own proven contacts, never from a possible (inexact-pad) touch the judge may bank —
the judge can name a net the component does not, which suppresses nothing. The report of a
conflict component therefore always names every net of the component.

### 4.4 Live

The board map is built once in `buildDrcItems`, after the grid and before any check, over every
board null item; it is immutable for the context's life. `checkPendingCopper` builds a per-call
overlay at its top — before `netClassItems` — from the board map and the pending items' touches
(board × pending through the grid, pending × pending), keyed by item object (a pending trace
that `replaces` a board trace shares its id; `replaces` can also delete a board null item's
connection). The overlay is never stored on the context.

The AFFECTED set of existing items is every existing item whose tier net changed, whose
component's label set or membership changed (a conflict growing from {A, B} to {A, B, C} moves
no scalar tier — Astra run 1 #6), or whose exposure changed because a pending opening now
reaches its copper or a replaced opening no longer does (Astra run 1 #5). Pairs are rejudged for
the items whose TIER NET or EXPOSURE moved (a pair verdict reads two tiers, two exposures and
geometry only, so a component-only change cannot move it and rejudging such an item would only
re-report — and refuse — the board's pre-existing rows, R1 #1); a component whose label set or
membership changed is served by the chain-short delta instead. Every such item is rejudged in
the overlay's tiers and exposure: its pairs (through the grid, honouring `replaces`), AND — for
the items whose TIER NET itself moved (a per-item verdict is a pure
function of the tier and the item's own geometry, so a component-only change would re-report a
board-wide warning as the route's) — the per-item forms that read the tier net: the current
verdict and the net-class dimension checks (Astra run 1 #8); every resulting draft is attributed to the pending
copper and refused by the same code-based policy (a newly discovered warning stays a warning)
— the 07 §4 rule for a bridge that grew because of the pending copper, generalised. The overlay
is a complete recomputation over the final geometry (board minus `replaces` plus pending), never
a union-only update, so a shrink re-tiers correctly. Batch on the committed geometry and live on
the same final geometry therefore derive the same components and the same verdicts (07 §1
clause 1). Cost: contact work is bounded by the null items' candidates with the union-find early
exit, and the rejudge by the components the pending copper reaches (a re-tiered item is always
an unassigned one, so nothing larger than "every unassigned board item" can ever be affected);
nothing is skipped, so no clean verdict is ever returned for work not done (Astra run 1 #13;
the rejudge budget of the first draft guarded nothing and was removed, R1 #5). A null route
in progress resolves its obstacles with the board-widest bound (§3.2 c) and may look
unroutable on a high-voltage board until a net is assigned — over-blocking, never
under-blocking.

### 4.5 Determinism

Labels are collected from the sorted snapshot; the union-find visits items in anchor-key order;
chain drafts are sorted like every other draft. Reversing any input array leaves the components,
the effective nets and the report byte-identical (06 §7).

## 5. Current versus width

For each trace item with a class current on its tier net:

```
requiredWidthMm = requiredTraceWidthMm(currentA, tempRiseC, copperOz(layer), isInternal(layer))
```

with `tempRiseC = electrical.tempRiseC ?? 10`, `copperOz = electrical.innerCopperWeightOz ??
electrical.copperWeightOz ?? 1` on inner layers and `electrical.copperWeightOz ?? 1` on outer
layers. `TRACE_CURRENT_WIDTH` (warning) when `below(widthMm,
requiredWidthMm)` holds (minimums regime, unchanged — this is a width minimum, not a spacing).
The defaults 10 °C and 1 oz are policy defaults and every message names the values used. The
formula is evaluated only for finite, strictly positive current, rise and copper weight; any
other input is a `DRC_RULE_INVALID` row (§2) and no trace of that class is judged — the pre-S13
helper returned a 0 mm requirement for a zero rise or weight, which every trace passed (Astra
run 1 #9).

Assumptions, stated in the message and the docs: every segment carries the full class current
(parallel paths are not modelled — conservative under the formula); copper weight is the
nominal, declared value (not minimum finished thickness); the inner weight applies to every
inner layer.

Not judged (§10): via barrels (the barrel area `A = π·t·(d + t)` with plating thickness `t` is
recorded for a future session; treating it as an internal trace is an unverified thermal
substitution, and no plating thickness is sourced); pour necks (`COPPER_CONNECTION_WIDTH`
stays a declared design rule); pads.

## 6. Constants

### 6.1 Sources

All values are secondary transcriptions of IPC-2221B Table 6-1 and the IPC-2221 conductor
formula; IPC-2221B itself is paywalled and has not been read. Two independent transcriptions
were fetched on 2026-09-11 and agree row for row:

1. KiCad 8 `pcb_calculator/calculator_panels/panel_electrical_spacing_ipc2221.cpp`, commit
   `942661fc10e172febf9d9990de2471d4b1020618` (the pre-IPC-2221C table, seven columns B1, B2, B3,
   B4, A5, A6, A7, with the note "For voltages greater than 500V, the (per volt) table values must
   be added to the 500V values … 0.25 mm + (100V x 0.0025)"). Saved in the session scratch as
   `s13/sources/kicad-942661f-ipc2221.cpp`.
2. smpspowersupply.com/ipc2221pcbclearance.html (Lazar Rozenblat), "IPC-2221B PCB Trace Spacing /
   Clearance by Voltage", columns B1, B2, B4, with worked values above 500 V (1000 V: 1.5 / 5 /
   2.33 mm) that confirm the "500 V value plus slope times excess" rule.

KiCad's later commit `3ff0b3cc57dd043ac6b159611d85a01374df7a88` transcribes IPC-2221C (Dec 2023)
with different values (B2 0.6 → 0.64 mm in the 31–150 V bands, B4 0.13 → 0.3 mm, 0.4 → 0.8 mm,
0.8 → 1.6 mm, an eighth column). OpenPCB pins edition B; sources are never mixed. The current
formula's constants (k = 0.048 external / 0.024 internal, b = 0.44, c = 0.725) match KiCad 8
`panel_track_width.cpp` at the same commit. The obsolete citation of `DRC_AUDIT_REPORT.md` is
removed.

### 6.2 Table 6-1 (IPC-2221B, mm)

| Voltage (V, DC or peak, `Δ ≤ max`) | B1 internal | B2 external uncoated ≤ 3050 m | B4 external, permanent polymer coating |
|---|---|---|---|
| 0–15 | 0.05 | 0.1 | 0.05 |
| 16–30 | 0.05 | 0.1 | 0.05 |
| 31–50 | 0.1 | 0.6 | 0.13 |
| 51–100 | 0.1 | 0.6 | 0.13 |
| 101–150 | 0.2 | 0.6 | 0.4 |
| 151–170 | 0.2 | 1.25 | 0.4 |
| 171–250 | 0.2 | 1.25 | 0.4 |
| 251–300 | 0.2 | 1.25 | 0.4 |
| 301–500 | 0.25 | 2.5 | 0.8 |
| > 500 | 0.25 + 0.0025·(V − 500) | 2.5 + 0.005·(V − 500) | 0.8 + 0.00305·(V − 500) |

Bands are stepped, never interpolated; a differential of 15.5 V falls in the 16–30 band (`Δ ≤
maxV` with `maxV` = 15, 30, 50, 100, 150, 170, 250, 300, 500). The `eda-standards` reference
`design-rules.md` previously collapsed 251–500 V into one row at 0.25 / 2.5 / 0.8; the sourced
table above replaces it. The above-500 V rule is distinguishable from the alternative reading
`slope × V` only in B1 and B4 (600 V: B1 0.5 mm versus 1.5 mm); B2 tests cannot tell them apart
(`2.5 + 0.005·(V − 500) = 0.005·V`), so the unit test pins B1 at 600 V.

### 6.3 Conductor formula

`A(mil²) = (I / (k · ΔT^0.44))^(1/0.725)`, `width(mil) = A / thickness(mil)`, `thickness = oz ×
1.378 mil` (1 oz/ft² ≈ 35 µm ≈ 1.378 mil; 1 mil = 0.0254 mm exactly; the reference's 1.4 mil
understates the width by ≈ 1.6 % and is corrected). Copper weight is areal mass; the mapping to
finished thickness is nominal (§5).

## 7. Report contract

- Codes: `CREEPAGE_DISTANCE` (error, class `electrical`, overridable, id = code + sorted anchors
  + layer, not location-hashed — unchanged), `TRACE_CURRENT_WIDTH` (warning, class
  `electrical`), `NET_SHORT_CIRCUIT` reused for chain shorts. No new code.
- Labels: `CREEPAGE_DISTANCE` → "IPC-2221 conductor spacing (voltage)"; `TRACE_CURRENT_WIDTH` →
  "Trace narrower than the IPC-2221 width for its class current".
- Messages name the column, Δ, the exposure decision when B4 was possible, and the defaults used.
- Byte identity is claimed only for inputs the migration cannot touch (Astra run 1 #11): a
  board with no null-net copper touching named copper, no pair violating both constituents, no
  declared voltages. Everything else is an enumerated migration, attributed per cause in each
  golden's `.md`: (a) regime 1e-6 → 5e-7 (no row expected to move); (b) effective nets (rows
  that gain a class tier, rows that vanish as same-tier pairs — B7-1 itself changes ordinary
  reports on boards without voltages); (c) chain and component-wide shorts (new rows); (d) both
  constituents reported where the pre-S13 check suppressed the voltage row under a dominating
  ordinary rule (new rows; waivers of the ordinary row no longer hide the IPC breach); (e) pour
  carve on boards with declared voltages (no golden declares one except `census`, whose zones
  lie 14 mm from its HV trace — verified 2026-09-11); (f) exposure (none — no golden sets
  `outerConductors`). `CREEPAGE_DISTANCE` ids are preserved (§3.3 strictest layer).
  `golden-electrical-2l` is new.
- Determinism: 06 §7 unchanged; §4.5.

## 8. Consumers

The pair judge and the six clearance loops; `checkElectrical` (current only after S13);
`checks/netclass.ts`; `legality.ts` (overlay, rejudge, refuse set, live codes); the pour
(`pour-params.ts`, `copper-fill-geometry.ts`); the router (`route-obstacles.ts`); the store
(`parseNetClass`, `parseDesignRules`); the frontend labels; the `eda-standards` skill.

## 9. Tests

`drc-audit-b7` B7-1 live plus the five Astra layouts (chain A–X–Y–C tiers; A–X–Y–B chain short;
X on an A trace and a B pour → tier A, stated; X on an A pour only → null, stated; a null via on
A at `F.Cu` and B at `B.Cu` → direct short); the close-to-own-net false FAIL removed; a live
rejudge of an existing null item; reversal. `drc-electrical.test.ts` rewritten on the judge:
both constituents on one pair, waiver independence, intra-footprint (exact and inexact pads),
same-net zone, exposure per item on a coated board, the 600 V B1 test, interval Δ, boundary
probes at `required − 5e-7 ± 1e-9` for both constituents. Resolver: an explicit rule below the
voltage term resolves to the term. `drc-broad-phase-oracle`: grid ≡ exhaustive with components
and constituents. `drc-legality-parity`: every electrical case batch ≡ live. Pour and router:
an HV zone carves at the IPC spacing, a same-net HV zone does not moat itself, a route obstacle
rect widens per route net. Round trips for `voltageMinV` / `voltageMaxV`, `outerConductors`,
`innerCopperWeightOz`. Goldens as §7.

## 10. Stated limits

- Cross-layer voltage pairs, the routed-edge path between `F.Cu` and `B.Cu`, creepage credit or
  debit for slots and edges, columns B3 / A5–A7, assembled conductors — not modelled.
- Solder-mask qualification for B4 is the user's declaration.
- Undeclared voltages are assumed at reference potential.
- Effective nets ignore pour copper, treat inexact-pad contacts as possible only, and use the
  bridge tolerance (1e-4 mm) while connectivity uses 5e-7 mm — owner S18.
- A gap that lands within float error of `required − 5e-7` can flip with a rigid translation of
  the board (06 §5's regime; Astra run 1 #10) — the epsilon policy is recorded, not changed.
- The contact pass and the live rejudge are quadratic on a dense cluster of null copper
  (≈ 172 ms per gate call for 500 coincident unassigned traces, R1 #7); slow, never clean. The
  route-obstacle builder now pays the same overlay per call that carries session copper.
- An unplated pad's tier is per face in the component model, but its scalar `tierNetOf` is set
  only when every face agrees (else untiered — over-reports); the judge's DIRECT null-net bridge
  (06 §4) is still per anchor across faces, so an unplated pad whose two rings touch two nets is
  banked as one short although no barrel joins them — pre-existing, owner S18.
- A per-layer tier (`tierNetOf(item, layer)`) would be the fully general answer for split
  pads — a judge-wide signature change, not taken here.
- Via, pour-neck and pad ampacity; parallel-path current sharing; minimum finished copper.
- The cloud snapshot carries no electrical data; server-side DRC has no electrical parity.
- IPC-2221B values are secondary transcriptions; primary verification is pending.

## 11. Amendments

`PROGRAM.md` (S13 row, Astra column, exit gate, decisions bullet); `00-ground-truth.md`
(electrical row); `01-connectivity-contract.md` (tolerance note); `04-copper-pour-contract.md`
(the halo carries the voltage term); `05-rule-semantics-contract.md` (§4.1 relax rule, §4.3
per-constituent aggregate, §4.5 tier nets, regime table); `06-batch-drc-contract.md` (§3 row,
§4 B7-1 and chains closed, §5 regime, §9); `07-live-parity-contract.md` (§3 live set, §4
overlay and rejudge, §6 refuse set, §9); `08-broad-phase-contract.md` (creepage enumeration
retired, bounds folded); `11-dfm-contract.md` (mask exposure consumer); `docs/drc/OPEN_FINDINGS.md`
(B7-1 closed, §6.6 rewritten, the S7 chain limit closed); `TODO.md`; `src/modules/designer/AGENTS.md`;
`CLAUDE.md` tree (`effective-nets.ts`); the hardening skill's `scope-and-invariants.md`;
`../.claude/skills/eda-standards/references/{design-rules,trace-width}.md` and `SKILL.md`;
`README.md`; the memory file.

## 12. Ledgers

### 12.0 Plan-critique (Opus, 20 findings) and Astra run 0 (brainstorm, xhigh, prompt-only), 2026-09-11

Astra run 0 — all folded: signed AC-peak subtraction unsound (→ §2 intervals); direct-adjacency
effective nets incomplete, pending-only live judging misses violations between two existing
items (→ §4 components, §4.4 rejudge); one row per pair defeats waivers (→ §3.3 constituents);
a global coated switch is a false pass on exposed pads (→ §1.2 exposure); via ampacity from
barrel area is an unverified thermal substitution (→ §5, no `VIA_CURRENT`); the 5e-7 regime
for every spacing constituent (→ §3.5); KiCad 8's transcription supports the code's rows and the
above-500 V rule, IPC-2221C differs (→ §6); narrower claims (→ §1). Plan-critique — all folded:
per-pair `clearanceBound` (§3.4); enumeration on the original net (§4.2); the overlay off the
context, keyed by object (§4.4); the board pass is its own walk (§4.4); code from the strictest
candidate per constituent (§3.3); intra-footprint inexact pads (§3.3); `shortTierOnly` →
constituents (§3.3); the infinite halo (§3.4); the pour obstacle halo (§3.4); the fab
else-branch (§3.3); refusal ignores severity overrides (§3.6); overlay before `netClassItems`
(§4.4); labels are frontend; `maxClearanceBound` uses null nets (§3.4); grep census excludes
`dist/`.

### 12.1 Astra run 1 (spec-attack, xhigh, prompt-only with executed probes), 2026-09-11

13 findings, all verified against source and accepted: #1 same-class intervals (§2 — the
interval formula applies to distinct nets whatever the class); #2 the pour and router pass
original nets (§3.2 — the kernel is pure, `zonePourNets` derives the map, obstacles carry tier
net + exposure, a null route uses the conservative bound); #3 `zoneClearanceResolver` memo
aliases exposure (§3.2 — key includes tier net and exposure); #4 tenting is not coverage (§1.2
— one union-of-openings rule for every kind); #5 live exposure changes (§4.4 — affected set
includes exposure changes from pending openings and `replaces`); #6 a direct short hiding a
chain (§4.3 — component-wide draft whenever the direct drafts do not cover the label set; §4.4
label-set changes are affecting); #7 bounding-rect contacts as proven shorts (§4.1 — possible
contacts never join components); #8 per-item forms in the rejudge (§4.4); #9 zero rise / weight
→ 0 mm width (§2, §5 — `DRC_RULE_INVALID`, constituent absent); #10 float boundaries (§2 — Δ at
1 µV; §10 — the geometric regime recorded); #11 byte-identity overstated (§7 — enumerated
migrations; §3.3 — the voltage row reports the strictest layer so ids survive); #12 `NaN`
voltage passes at the 2.5 mm fallback (§2 — rejected and reported before comparison); #13 quadratic contact / rejudge cliff (§4.1 early exit; §4.4 nothing skipped, never clean; §10 records the dense-cluster cost). Held:
the interval differential, B2 ≥ B1 / B4 in every band, the current formula and 1.378 mil,
constituent waiver independence, complete recomputation handling `replaces` shrink and
multilayer vias.
### 12.2 R1 (`reviewer-critical`, executed probes) — WP3 part, 2026-09-12

Four findings, all fixed: #1 (high) `zoneExclusions` resolved zone↔zone spacing with no
`exposed`, so a coated board carved two pours at B4 0.4 mm while every obstacle used B2 —
`pourExposedOn(layer)` is now the one conservative expression for both paths (§3.2); #2
(medium-high) store-accepted ±1e308 endpoints overflowed Δ to `Infinity` and the table's guard
threw out of batch, live and `clearanceBound` — `MAX_DECLARED_VOLTAGE_V` and a null-returning
`voltageDeltaV` (§2); #3 (low) the `DRC_RULE_INVALID` detail claimed "no requirement" beside a
real creepage row — per-field wording with the class-level consequence appended; #4 (low) an
update with a non-positive `tempRiseC` dropped the stored value and relaxed the width check to
the 10 °C default — the store keeps the stored value on an invalid update. Held: every false-pass
hunt (inner/outer, coated + exposed side, intervals, an explicit 0.05 mm rule between 230 V and
0 V → 1.25 mm on all ten pair kinds, same-class intervals, same-potential classes), the
exposure model incl. the tented-via case, the 5e-7 regime, both rows on a shorted HV pair,
pre-S13 `CREEPAGE_DISTANCE` ids on multilayer pairs (executed against a `HEAD` worktree),
grid ≡ exhaustive and reversal on a mixed board, every invalid-input row, the table at every
band edge, live ≡ batch for the null extension, the pending-via exposure change and the
`replaces` shrink. The WP2 part of R1 is §12.2b below.

### 12.2b R1 (`reviewer-critical`, executed probes) — WP2 part, 2026-09-12

Seven findings: #1 (major) the live rejudge ran over every item whose component signature
changed and re-reported, then refused, the board's pre-existing pairs — pairs are now rejudged
for re-tiered or exposure-changed items only (§4.4); #2 (major) the router tiered the obstacle
side but not the route's own side, so an unassigned route extending a 2 mm-class net was offered
a path the gate refuses — a null route now resolves with the conservative bound over every class
for the ordinary term as well as the voltage term (§3.2 c); #3 (medium) a `replaces` that
removed a member of a pre-existing chain short re-reported it as the route's — the board-side
identity now ignores replaced members on both sides; #4 (low) the chain draft's location is the
smallest NULL-member marker — §4.3 amended to say so; #5 (low) the rejudge budget was inert —
resolved in the fix round; #6 (info) the null-side `farApart` bound must fold the voltage
halo — WP3 did (`maxClearanceBound` folds `maxCreepageBound`, verified by R1's WP3 part); #7
(info) a dense cluster of 500 coincident unassigned traces costs ≈ 172 ms per gate call — a
§10 limit. Held: 20 determinism combinations (five layouts × reversal × grid / exhaustive), live
≡ batch on pending × pending chains and a pending via bridging two layers, the same-tier return
cannot swallow a short or a bank, `farApart`'s null-side bound is the grid halo, inexact pads
never join a component, the context spread is safe, duplicate drafts collapse by id.
### 12.3 R2 (`reviewer-critical`, executed probes) — WP4 + WP5, 2026-09-12

Nine findings, all disposed: #1 (medium) the current verdict skipped a class flagged for a
VOLTAGE field — narrowed to the `currentA` problem (§5); #2 (medium) the re-tier rejudge of
the current verdict was unpinned — regression added to `drc-audit-b7` (§4.4); #3 the
`CREEPAGE_DISTANCE` message now states the exposure decision when B4 was possible and the
undeclared-net assumption when one side declares nothing (§7); #4 the gate's dispatch-order
comment amended; #5 the parity harness's tier clause cannot hide a breach (over-credit,
under-credit and unchanged rows each fail a clause) but cannot credit a label-set-only chain
change either — recorded as a harness limit; #6, #7 golden `.md` wording; #8 the
`trace-width.md` quick-reference tables recomputed from the formula (they disagreed with it by
up to 35 %); #9 a stackup-invalid layer is judged at the inner copper weight (false-fail,
pre-S13 behaviour, noted). Held: every hand-recomputed golden region (A–M), grid ≡ exhaustive
and reversal on `golden-electrical-2l`, the census migration walk (no delta, all six causes),
the live gate's refusal policy incl. `ignore` and an `error` override on a warning code, the
per-item form's inner / outer widths by hand, the invalid-input rows for `currentA` 0 / −1 /
NaN / Infinity.
### 12.4 Astra run 2 (adversarial-verify, xhigh, repository-grounded, executed probes), 2026-09-12

Four verified findings, all accepted and fixed: #1 (high) an unplated pad's copper was one
node across both faces, so an unassigned back-side trace inherited a front-side net's tier
through non-conducting copper and its same-layer 1.25 mm breach vanished — unplated pads are
one node per face (§4.1); #2 (high) an inverted interval update erased both endpoints at the
store and with them a live requirement, with no row anywhere — finite endpoints persist as
given and are reported by the DRC, a lone / non-finite one keeps the stored declaration (§2);
#3 (medium) session copper handed to the router through `input.extra` fell back to its own null
tier (0.25 mm) while the gate refused the route at 1.25 mm — the router resolves over the
committed + session overlay (§3.2 c); #4 (medium) finite store-accepted extremes (1e225 A on
1.7e308 oz) overflowed the width formula to `NaN`, which passed silently — magnitude caps and a
non-finite-result guard (§2, §5). Astra's own validation: 255 existing tests green, 48
additional boundary / degenerate / grid-vs-exhaustive / reversal probes with no id drift.
