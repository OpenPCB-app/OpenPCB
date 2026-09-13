# golden-si-2l

Eleventh DRC golden board (S14 WP5, SI contract 14 §9). Its one job is to
provoke every routed-length and differential-pair behaviour of contract 14 on
one board and to pin the resulting report: the path model's three reported
`undefined` reasons (`loop`, `multi-terminal`, `pour`), both length-group target
kinds, all three diff-pair measures, the two refusals the rule model owns
(`DRC_RULE_INEFFECTIVE` / `DRC_RULE_INVALID`), the explicit coupling window, and
the `_P` / `_N` identity together with the `VIP` / `VIN` decoy it must NOT pair.

Fabricator `custom`, 2-layer, 1.6 mm, outline a plain 150 × 120 rect centred on
the origin. 104 primitives, 24 violations across 10 codes, all ids unique —
clear of the golden suite's ≥ 80 primitive and ≥ 10 violation non-triviality
gates.

## Declarations

```
clearance: { traceToTraceMm: 0.05, traceToPadMm: 0.05, padToPadMm: 0.05,
             traceToViaMm: 0.05, viaToViaMm: 0.05, copperToBoardEdgeMm: 0.5 }
```

**The clearance block is the pivot of this fixture's readability.** Almost every
region here is a pair running at a 0.15 mm copper gap — under the 0.25 mm
default that is a `TRACE_TO_TRACE_CLEARANCE` / `TRACE_TO_PAD_CLEARANCE` row on
every single region, 50 of them, and the SI verdicts would be buried. The board
declares 0.05 mm instead, so the report contains ONLY the codes this golden is
about plus the three structural codes noted at the end. `minimums.clearanceMm`
stays absent as it does for every golden (the loader strips the new-board
default), the fabricator is `custom` so there is no fab tier, and there is no
`electrical` block, so no voltage or current constituent fires anywhere.

`boardThicknessMm` **1.6** is load-bearing: it is the length a through via
traversed outer-to-outer contributes to a path (contract 14 §2.5), and region E
measures exactly that.

Net classes — three of the four exist only to carry a `diffPairGapMm`:

| class | declaration | used by |
|---|---|---|
| `default` | — | every net except the four below |
| `dpa` | `diffPairGapMm: 0.15` | `c12p` (region M) |
| `dpb` | `diffPairGapMm: 0.2` | `c12n` (region M) |
| `dpc` | `diffPairGapMm: 0.15` | `c13p`, `c13n` (region N) |

All four declare `traceWidthMm` 0.2 and `clearanceMm` 0.05, so a class never
changes anything but the diff-pair target.

## The two numbers every region is built from

Every trace is 0.2 mm wide and every diff-pair terminal is a 0.3 × 0.3 mm pad,
so:

- **Pad clipping.** A trace ending at a pad centre has 0.15 mm of copper inside
  the pad, and copper inside a terminal is not routed length (§2.2). A straight
  `L` mm trace between two pads therefore measures `L − 0.3`.
- **The cap reach.** Where a partner trace ENDS at `x = c` and the member runs
  parallel 0.35 mm away (a 0.15 mm copper gap), the member's gap past the cap is
  `g(d) = sqrt(d² + 0.35²) − 0.2` at `d` mm beyond `c`. With the default window
  `G = 4·0.15 + 0.1 = 0.7` it stays coupled while `sqrt(d² + 0.1225) ≤ 0.9` →
  **`d ≤ sqrt(0.6875) = 0.829156`**. Regions C, D, F, H and N are that one
  number, counted once or twice; it is what every uncoupled measure on this
  board subtracts.

  **It contributes NO off-band length.** `wide` is measured only on
  near-parallel STRIPS since the 2026-09-13 amendment to §4.2 — the union, over
  partner segments whose folded direction angle is ≤ `COUPLING_ANGLE_DEG` = 15°,
  of the set where the member's perpendicular FOOT lands inside that partner
  segment and the perpendicular gap is in `(t + tol, G]`. Past a cap the foot
  falls off the end of the partner segment; at a jog or a branch the departing
  partner segment is 90° to the member. Both are DEPARTURES, not a pair routed
  at the wrong gap, so both are **coupled-but-not-wide**. This fixture is why:
  under the pre-amendment rule every partner end cap and every corner raised a
  ≈ 0.64 mm `DIFF_PAIR_GAP` ERROR row, five of them here, and regions C, D, F, H
  and N each carried one. They are gone, and their absence is now the thing
  those regions pin.

## Regions, by row (all `F.Cu` unless noted, all `x` from −65 leftwards)

- **A — an on-target pair, the PASS control (y = −56).** `D1_P` / `D1_N`
  (`dp1`, `gapMm` 0.15, `gapTolMm` 0.05), two 10 mm traces 0.35 mm apart, each
  ending in a pad of `U1A` / `U1B`. Both paths measure 9.7 mm, the gap is
  exactly 0.15 mm over every millimetre of both, and the partners cover each
  other end to end, so there is no cap band at all. Skew 0, off-band 0,
  uncoupled 0 → **no violation**. Every other region is a departure from this
  one.
- **B — a diverging pair (y = −49).** `dp2`, `gapMm` 0.15, `maxUncoupledMm` 5.
  `D2_P` runs straight x −65…−45; `D2_N` runs from (−65, y + 0.35) to
  (−45, y + 1.35), so `g(x) = 0.15 + (x + 65)/20`.
  - **`DIFF_PAIR_GAP` 10.012 mm — the only one on this board.** The two
    segments fold to `atan(1/20) = 2.86°`, well inside the 15° gate, and each
    member's perpendicular foot lands on the partner over the whole overlap, so
    the strip rule applies to its full length. Both members land on the same
    number by two different routes:
    - N measured against P: P is horizontal, so the perpendicular gap is the
      plain vertical one, `0.15 + u/20`, off-band over `u ∈ (1, 11]` — 10 mm of
      x, `10·sqrt(1 + 0.05²) = 10.012492` mm of N's own steeper arc.
    - P measured against N: the perpendicular gap is that offset foreshortened
      by `cos(2.86°) = 20/sqrt(401) = 0.998752`, off-band over
      `u ∈ (1.009988, 11.022472]` = 10.012485 mm of P's arc.

    The code reports the MAX over the members, never their sum (§4.2 as
    amended) — this is the region that would double-report under the draft
    rule, and it is also the region that proves the strip rule still FIRES on a
    genuinely mis-gapped run.
  - **`DIFF_PAIR_UNCOUPLED_LENGTH` 8.861 mm** on `D2_N`. N's copper path is
    `sqrt(20² + 1²) − 2 × 0.1501 = 19.725` mm; it is coupled while `g ≤ 0.7`,
    i.e. over the first 11 mm of x = 10.864 mm of its own arc → 8.861 mm
    uncoupled, over the 5 mm the pair allows.
  - Skew is `|19.700 − 19.725| = 0.025` mm, inside the 0.5 mm default — no row.
- **C — the C1 hole: a partner in two fragments (y = −42).** `dp3`, `gapMm`
  0.15, `maxUncoupledMm` 1. `D3_P` runs straight x −65…−45; `D3_N` is two
  fragments, x −65…−58 and −52…−45, with a 6 mm hole between them and one pad
  at each outer end.
  - **`DIFF_PAIR_UNCOUPLED_LENGTH` 4.342 mm** on `D3_P`: the hole is
    `6 − 2 × 0.829156 = 4.341688` mm of P beside no N copper. Exact, not
    sampled — no per-segment-pair scheme sees a hole at all (B8-2b).
  - **No `DIFF_PAIR_GAP`.** The two fragment caps put P's gap through the whole
    `(0.2, 0.7]` window twice, but past a cap P's perpendicular foot is off the
    end of the fragment, so neither band is a strip: coupled, out of band, not
    wide (§4.2 amendment). Under the pre-amendment rule this region reported
    `2 × 0.635507 = 1.271` mm as an ERROR. `D3_N` contributes nothing either —
    its path is `undefined`, so it has no measured copper of its own.
  - N's two fragments hold one terminal each, so its path is `open` — reported
    by **`UNCONNECTED_NET`** (1 airwire) and NOT by `NET_LENGTH_UNDEFINED`
    (§2.7: `open` is connectivity's fact, not this rule's), and therefore no
    skew row. The two inner end caps are **`TRACK_DANGLING`** ×2.
- **D — a jog: coupled → uncoupled → coupled (y = −35).** `dp4`, `gapMm` 0.15,
  `maxUncoupledMm` 2. `D4_P` runs straight x −65…−44 (20.7 mm path); `D4_N`
  leaves at x = −58, runs 2.65 mm above P for 7 mm, and comes back at x = −51
  (26.0 mm path: `7 + 2.65 + 7 + 2.65 + 7 − 0.3`).
  - **`DIFF_PAIR_UNCOUPLED_LENGTH` 11.200 mm** on `D4_N`, the worse member: its
    top run is 2.65 mm from P, far outside `G` = 0.7, so all 7 mm are
    uncoupled, and each vertical leg is coupled only while its height `h`
    satisfies `0.15 + h ≤ 0.7` → 0.55 mm, leaving `2.65 − 0.55 = 2.1` mm each.
    `7 + 2 × 2.1 = 11.2`. (P's own uncoupled run is the
    `7 − 2 × 0.829156 = 5.342` mm between the corners — smaller, so N carries
    the marker.)
  - **No `DIFF_PAIR_GAP`**, and this is the region that shows BOTH halves of
    the 15° gate. P's two corner bands are cap-shaped — the foot leaves N's
    horizontal segment at the corner — so they are not strips; N's two vertical
    legs are 90° to P and are excluded by the angle gate outright; and N's top
    run, the only genuinely parallel partner stretch, sits 2.65 mm away, outside
    `G`. Pre-amendment this reported `max(2 × 0.635507, 2 × 0.5) = 1.271` mm.
    A jog is an uncoupled fact and a skew fact, not a gap fact.
  - **`DIFF_PAIR_SKEW` 5.300 mm** = `26.0 − 20.7`. A detour that long is a skew
    fact as much as a coupling one, and the region reports both.
- **E — a through-via transition, skew alone (y = −28).** `dp5`, `gapMm` 0.8,
  `gapTolMm` 0.2, **`couplingMaxGapMm` 1.0**, `maxUncoupledMm` 50,
  `maxSkewMm` 0.5. `D5_P` runs F.Cu x −65…−57, drops through via `v5a`
  (⌀ 0.8 / drill 0.4) to B.Cu for 4 mm, and returns through `v5b` at x = −53;
  `D5_N` is a flat 20 mm F.Cu trace 1.0 mm away (a 0.8 mm copper gap, which
  keeps the Ø 0.8 via barrels 0.5 mm clear of it).
  - **`DIFF_PAIR_SKEW` 1.600 mm** — exactly the B8-5 number:
    `P = 20 − 4 × 0.4 (barrel discs) − 2 × 0.15 (pads) + 2 × 1.6 (board
    thickness) = 21.3`, `N = 20 − 0.3 = 19.7`. A layer change costs the board
    thickness and refunds the copper inside the four barrel discs.
  - The pair is deliberately given a 0.2 mm tolerance against a 1.0 mm window,
    so the band `[0.6, 1.0]` fills the whole window and neither `tight` nor
    `wide` can be non-empty: **no `DIFF_PAIR_GAP`**. With `maxUncoupledMm` 50
    the 4 mm of P on the far face reports nothing either. The region measures
    skew and nothing else.
  - **S14 WP3 / R2 edit:** the tolerance was 0.3 mm when this fixture was
    written, a band `[0.5, 1.1]` OVERHANGING the window. The rule model now
    refuses a table whose band does not fit inside its own coupling window at
    either end (a band reaching past `G` means copper exactly on target is not
    coupled, so a perfect pair would read as one long uncoupled run), so that
    table produced a `DRC_RULE_INVALID` and judged nothing — case E lost the
    skew row it exists to pin. 0.2 mm is the largest tolerance this 1.0 mm
    window admits and it keeps every property this entry claims; the expected
    report is unchanged, byte for byte.
- **F — duplicate copper (y = −21).** `dp6`, `gapMm` 0.15, `maxUncoupledMm` 5.
  `D6_P` runs x −65…−45 between two pads; `D6_N` is TWO IDENTICAL 10 mm trace
  records between the same two pads.
  - **`NET_LENGTH_UNDEFINED` (loop)** on `D6_N`: two coincident edges between
    the same pair of nodes, so neither is a bridge and the terminals do not
    share a bridge-only component (§2.4, Astra #8). A conservative verdict on a
    data defect — and consequently **no skew row**.
  - **`TRACE_OVERLAP`** co-reports the same fact as geometry (10.000 mm).
  - The partner is still measured: **`DIFF_PAIR_UNCOUPLED_LENGTH` 9.021 mm** on
    `D6_P`. P's path is 19.7 mm (x −64.85…−45.15); N's copper ends at x = −55
    and its cap reaches 0.829156 mm past it, so P is coupled to x = −54.170844
    (10.679 mm) → `19.7 − 10.679 = 9.021`.
  - **No `DIFF_PAIR_GAP`**: the single cap band (`0.635507` mm pre-amendment)
    is a departure past the end of N's copper, not a strip.
- **G — a dangling stub (y = −14).** `dp7`, all defaults but `gapMm` 0.15.
  `D7_P` runs x −65…−45 with a 3 mm stub dropping from x = −55; `D7_N` is the
  matching straight run. The stub is a non-terminal leaf, pruned from the
  measured subtree (§2.4), so P and N both measure 19.7 mm: **no skew row, no
  uncoupled row, no gap row** — the pre-S14 sum-of-polylines model reported
  10 mm of skew for exactly this shape (B8-4). The only row is
  **`TRACK_DANGLING`** on `t7ps`, which is the code that owns branch copper.
- **H — a 3-terminal member (y = −7).** `dp8`, `gapMm` 0.15,
  `maxUncoupledMm` 1. `D8_N` has a third pad 2.65 mm above the run, reached by
  a 2.3 mm branch at x = −55, so its topology is `tree`.
  - **`NET_LENGTH_UNDEFINED` (multi-terminal)** with the `diffPair` anchor: a
    tree total cannot establish endpoint skew (§4.2, Astra #5) → **no
    `DIFF_PAIR_SKEW`**.
  - The uncoupled measure is still judged over the subtree:
    **`DIFF_PAIR_UNCOUPLED_LENGTH` 1.600 mm**. N's path is
    `19.7 + (2.3 − 0.15) = 21.85` mm; the branch is coupled only while
    `0.15 + h ≤ 0.7` → 0.55 mm → `21.85 − 19.7 − 0.55 = 1.6`.
  - **No `DIFF_PAIR_GAP`**: the branch leaves at 90°, so the angle gate drops
    it before the strip is even computed (pre-amendment it reported the
    `0.05 < h ≤ 0.55` band, 0.500 mm). P's whole path runs at exactly 0.15 mm
    beside N's main run and contributes nothing either way.
- **I — a `longest` length group (y = 0).** Group `LongestA`, tolerance 1 mm,
  members `LA1` (20.3 mm trace → 20.0 mm path), `LA2` (19.8 → 19.5) and `LA3`
  (10.3 → 10.0), each between two free pads. The target is the longest DEFINED
  member, 20.0 mm (self included, §3). `LA2` is 0.5 mm short — inside the
  tolerance, no row. `LA3` is 10.0 mm short → **`NET_LENGTH_OUT_OF_RANGE`**.
  A `longest` group can never report too-long, which is why region J exists.
- **J — an `absolute` length group (y = 5).** Group `AbsoluteB`, target 15 mm,
  tolerance 1 mm. `LB1` measures 20.0 mm (over by 5) and `LB2` measures 9.0 mm
  (short by 6) → **two `NET_LENGTH_OUT_OF_RANGE` rows, one in each direction**
  — the `tooLong` branch of the check, which only an `absolute` target reaches.
- **K — a pour-only path (y = 9…13).** Zone `z_pz` on `F.Cu`, net `pz`,
  polygon x −65…−53 × y 9…13, and two 1 × 1 mm free pads of the SAME net at
  (−63, 11) and (−55, 11). There is no trace: the two terminals share an S1
  component only because the pour island joins them, and a pour island is never
  a path edge (§2.6) → **`NET_LENGTH_UNDEFINED` (pour)**, anchored on the net
  and on group `PourC` (absolute 10 mm ± 1). The group's target is then never
  applied, because it has no defined member left to measure — which is exactly
  the "the rule is never silently inert" clause of §3. The pour connects the
  pads for connectivity purposes, so there is no `UNCONNECTED_NET` row here.
- **L — a pair with no target anywhere (y = 17).** `dp11` declares no `gapMm`,
  and both nets sit in `default`, which declares no `diffPairGapMm`.
  - **`DRC_RULE_INEFFECTIVE`** naming the pair (`rule` anchor
    `diffPair:dp11`). The pre-S14 check invented a 1.0 mm coupling window here;
    Decision 6 removed it, so the whole coupling block is skipped and there is
    no `DIFF_PAIR_GAP` or `DIFF_PAIR_UNCOUPLED_LENGTH` row even though the two
    runs are 2 mm different in length.
  - Skew is still judged: `D11_P` 20.0 mm vs `D11_N` 18.0 mm →
    **`DIFF_PAIR_SKEW` 2.000 mm**. "No target" silences the gap verdicts, not
    the length one.
- **M — two classes that disagree on the gap (y = 22).** `dp12` declares no
  `gapMm`; `c12p` is in `dpa` (`diffPairGapMm` 0.15) and `c12n` is in `dpb`
  (0.2). Two rules over one pair → **`DRC_RULE_INVALID`** and **nothing else is
  judged for this pair at all** (§4.2, Astra #14). The geometry is a clean,
  on-target 10 mm pair, so the absent rows are the point: a member is never
  measured against a rule its own class never stated. The asymmetric form of
  the same refusal — one class declaring a gap and the other silent — is the
  resolver's unit test, not this fixture.
- **N — an auto-detected pair (y = 27).** `LVDS0_P` / `LVDS0_N` have NO
  explicit `diffPairs` row: the `_P` / `_N` suffix table pairs them (§5), and
  both nets are in class `dpc`, whose `diffPairGapMm` 0.15 they AGREE on, so
  the inferred pair gets a real target. P runs 10 mm (9.7 mm path), N runs 8 mm
  (7.7 mm path) →
  - **`DIFF_PAIR_SKEW` 2.000 mm**, and no `DIFF_PAIR_GAP`: N's single end cap
    is a departure, not a strip (`0.635507` mm pre-amendment).
  - That row carries the `diffPair` anchor `{c13p, c13n}`. The anchor is what
    proves the inference ran — a pair that failed to resolve would leave the
    same geometry completely silent.
- **O — the `VIP` / `VIN` decoy (y = 32).** Nets `VIP` (10 mm) and `VIN`
  (13 mm), both in `default`, both with free-pad terminals, no explicit row.
  Under the pre-S14 bare `P` / `N` suffix rule they would have been paired and
  would have produced a SECOND `DRC_RULE_INEFFECTIVE` (no class declares a gap)
  plus a 3.0 mm `DIFF_PAIR_SKEW`. The report carries exactly ONE
  `DRC_RULE_INEFFECTIVE` — region L's — and no skew row on these nets.
  **The absence is the verdict** (B8-6, Decision 4).
- **P — an explicitly narrowed coupling window (y = 37).** `dp14`, `gapMm` 0.2,
  `gapTolMm` 0.05, **`couplingMaxGapMm` 0.3**, `maxUncoupledMm` 5. The two
  20.3 mm traces run 0.6 mm apart centre to centre = a constant 0.4 mm copper
  gap.
  - Under the DEFAULT window `G = 4 × 0.2 + 0.1 = 0.9` the whole run would have
    been coupled and the region would report nothing. The explicit 0.3 mm
    window puts `0.4 > G`, so no millimetre is coupled and the entire 20.0 mm
    path is uncoupled → **`DIFF_PAIR_UNCOUPLED_LENGTH` 20.000 mm**.
  - **No `DIFF_PAIR_GAP`**, and here it is the WINDOW, not the 15° gate, that
    empties the set: the two traces are exactly parallel and each foot lands on
    the partner, so the strip is computed — but `wide` is `{0.25 < g ≤ 0.3}`
    and `tight` is `{g ≤ 0.15}`, and a constant 0.4 mm gap is in neither. Region
    P is therefore the one place on this board where a parallel run is silent
    for a reason the amendment did not introduce. And the table is not rejected,
    because `t − tol = 0.15 ≤ G = 0.3` (R1 #8) — the LEGAL narrowing, next to
    the illegal one the unit tests own.

Rows are 5–7 mm apart in y and every region's leftmost copper starts at
x = −65, far beyond any halo this board can demand (the widest is `dp5`'s 1.0 mm coupling window plus
half widths), so no region can reach into another. The only vertical excursions
are region D's 2.65 mm jog, region G's 3 mm stub and region H's 2.3 mm branch,
each of which still leaves ≥ 4 mm to the neighbouring row.

## Every violation, by code

| code | n | where, with the arithmetic |
|---|---|---|
| `DIFF_PAIR_GAP` | 1 | B 10.012 only — the one near-parallel strip on the board, `max` over two members that compute 10.012485 (P) and 10.012492 (N). C, D, F, H and N are the §4.2 amendment's five deletions: cap and corner transition bands are coupled-but-not-wide |
| `DIFF_PAIR_SKEW` | 4 | D 5.300 (`26.0 − 20.7`), E 1.600 (`21.3 − 19.7`, two through vias), L 2.000 (`20.0 − 18.0`), N 2.000 (`9.7 − 7.7`) |
| `DIFF_PAIR_UNCOUPLED_LENGTH` | 6 | B 8.861 on `D2_N`, C 4.342 on `D3_P` (`6 − 2 × 0.829156`), D 11.200 on `D4_N` (`7 + 2 × 2.1`), F 9.021 on `D6_P`, H 1.600 on `D8_N`, P 20.000 on `D14_N` (the whole path, window narrowed to 0.3) |
| `NET_LENGTH_OUT_OF_RANGE` | 3 | I `LA3` 10.0 vs a `longest` target of 20.0; J `LB1` 20.0 and `LB2` 9.0 vs an `absolute` 15.0 ± 1 — over and short, one each |
| `NET_LENGTH_UNDEFINED` | 3 | F `D6_N` (loop, duplicate records), H `D8_N` (multi-terminal, 3 pins), K `PZ` (pour, the island is the only connection) — the three reported reasons; `open` and `terminals` stay silent by contract |
| `DRC_RULE_INEFFECTIVE` | 1 | L, `dp11` — no `gapMm` and no class `diffPairGapMm` |
| `DRC_RULE_INVALID` | 1 | M, `dp12` — `dpa` says 0.15, `dpb` says 0.2, the pair says nothing |
| `TRACE_OVERLAP` | 1 | F, the two coincident `D6_N` records (10.000 mm) — the DFM twin of that region's `loop` |
| `TRACK_DANGLING` | 3 | C's two fragment caps (`t3n1`, `t3n2`) and G's stub (`t7ps`). Regions C and G are the two places this fixture deliberately leaves copper with a free end; every other trace ends in a pad, which is what gives every other net a routed length at all (§2.1) |
| `UNCONNECTED_NET` | 1 | C, `D3_N` — the 6 mm hole leaves one airwire. DRC derives its own ratsnest, so the fixture needs no `computeRatsnest` flag |

Summary: **3 errors / 21 warnings / 24 violations**. `DIFF_PAIR_GAP` is the
only error code this board raises; the corpus keeps provoking it from here AND
from `golden-census-2l`'s 2 mm parallel run at a 0.5 mm gap against a 0.2 mm
target, which the 15° gate leaves untouched.

## What this fixture does NOT cover

- The `via` and `unresolved` undefined reasons (§2.7). `via` needs an inner-layer
  traversal or a non-through via — a 4-layer stack-up, which this board is not —
  and `unresolved` is a kernel limit that no hand-written board reaches. Both are
  pinned in `net-path.test.ts` (contract 14 §9).
- The identity refusals that are not a class disagreement: an ambiguous base
  name (`CLK_P`, `clk_p`, `CLK_N` → `DRC_RULE_INEFFECTIVE` on
  `diffPair:auto:<base>`) and two explicit rows over one net set with different
  parameters (`DRC_RULE_INVALID`). Both are resolver unit tests — putting them
  on a board would add nets that exist only to be refused.
- The one-sided class disagreement (one class declares `diffPairGapMm`, the
  other is silent) — same refusal as region M, same row, so the board carries
  the symmetric form only.
- A `t − tol > G` table, which the rule model rejects (R1 #8). Region P is the
  legal narrowing; the illegal one is a unit test.
- The `tight` half of `DIFF_PAIR_GAP` (`g < t − tol`). No region here runs
  CLOSER than its target — every region B message reads `0.000 mm too tight` —
  because a sub-target pair gap on this board would also be a
  `TRACE_TO_TRACE_CLEARANCE` row and the region would stop measuring only what
  it is about. `tight` is gate-free (no 15° strip test) and is pinned in
  `coupled-span.test.ts`.
- The route / tune HUD consumers (§6), which run the same path model over a
  pour-free connectivity result in the frontend.
