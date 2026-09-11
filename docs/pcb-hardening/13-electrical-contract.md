# 13 — Electrical-rule contract (S13)

Status: **draft** (binding once S13 closes). Session S13 of `PROGRAM.md`. Owns B7-1
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

Exposure is decided per item per face from the S12 mask model (11 §1): a footprint or free pad
is exposed on a face where it has a mask opening (every pad has one on the faces it exists on,
unless the artwork model says otherwise); a via is exposed on a face unless tented there
(`PcbViaProtection`, `viaTouchesLayer`); a trace is exposed on a face iff a mask opening on that
face overlaps its copper (the `ensureMaskOpenings` broad phase over the trace's stadium). An
exposed item is an uncoated conductor whatever the board-level setting says, so a pair with an
exposed side on an outer layer is always judged in B2. This is the exposure rule Astra run 0
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
- Two nets of one class have Δ = 0 by construction. Conductors at different potentials (mains
  L and N, the two rails of a bipolar supply) need two classes or an interval that covers both.

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

Layered aggregate (05 §4.3, amended): per constituent, the reported layer is the first layer in
stackup order where that constituent is violated and the requirement is the strictest violated
layer's value for that constituent. The voltage constituent's column differs per layer (B1
inner, B2 / B4 outer), so the strictest voltage layer is the outer one whenever an outer layer
is shared — the pre-S13 `strictestSpacing` rule, now inside the judge.

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

`pcb-connectivity/effective-nets.ts` builds, over the DRC copper items (traces, pads, vias —
never pour copper), the contact graph under the bridge model's predicate: two items touch when
their gap on a shared copper layer is `≤ SHORT_EPS_MM` (1e-4 mm), measured by the `pair-gap.ts`
kernels; a via or a through pad joins every layer it exists on. Candidates come from the grid
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

A component with two or more labels in which no single null member touches two nets directly
is a chain short — the S7 stated limit (06 §9), closed here. It emits one `NET_SHORT_CIRCUIT`
anchored on the component's null members (sorted by anchor key) plus one net anchor per label
(sorted by net id), located at the smallest marker among the null members' contact points, with
`measuredMm = 0` and `requiredMm` = the largest ordinary requirement among the component's
cross-net pairs. The direct case keeps the pre-S13 bridge emitter and its ids. A component
cannot be both: a null member touching two nets directly is the direct case, and the chain
draft is emitted only when no member is.

### 4.4 Live

The board map is built once in `buildDrcItems`, after the grid and before any check, over every
board null item; it is immutable for the context's life. `checkPendingCopper` builds a per-call
overlay at its top — before `netClassItems` — from the board map and the pending items' touches
(board × pending through the grid, pending × pending), keyed by item object (a pending trace
that `replaces` a board trace shares its id; `replaces` can also delete a board null item's
connection). The overlay is never stored on the context.

Every existing null item whose effective net changed because of the pending copper is
rejudged against all its pairs in the overlay's tiers, and every resulting draft is attributed
to the pending copper and refused with it — the 07 §4 rule for a bridge that grew because of the
pending copper, generalised. Batch on the committed geometry and live on the same final geometry
therefore derive the same components and the same verdicts (07 §1 clause 1). Whether a net-set
shrink (a `replaces` that removes a connection) must also rejudge is decided by that clause:
it must, and the overlay recomputes affected items in both directions.

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
The defaults 10 °C and 1 oz are policy defaults and every message names the values used.

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
- Golden deltas, attributed per cause in each golden's `.md`: (a) regime 1e-6 → 5e-7 (no row
  expected to move); (b) effective nets (rows that gain a class tier, rows that vanish as
  same-tier pairs); (c) chain shorts (new rows); (d) pour carve on boards with declared voltages
  (no golden declares one except `census`, which has no zone near its HV trace — verified at
  WP0); (e) exposure (none — no golden sets `outerConductors`). `golden-electrical-2l` is new.
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
- Effective nets ignore pour copper and use the bridge tolerance (1e-4 mm) while connectivity
  uses 5e-7 mm — owner S18.
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

### 12.1 Astra run 1 (spec-attack) — pending
### 12.2 R1 — pending
### 12.3 R2 — pending
### 12.4 Astra run 2 (adversarial-verify) — pending
