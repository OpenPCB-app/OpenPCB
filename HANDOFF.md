# Handoff — PCB correctness-hardening program, Session 12b (exact-arc geometry)

Session 2 · 2026-09-11

## Goal

One physical PCB model that connectivity, geometry, zones, pours, routing, DRC, manufacturing checks
and export all consume (`docs/pcb-hardening/PROGRAM.md`). This session delivered **S12b — exact-arc
geometry** (contract `docs/pcb-hardening/12-exact-geometry-contract.md`, binding) and closed it in the
working tree, uncommitted. S12 was committed at the start of this session as `262e4e4`.

## Original plan

`~/.claude/plans/resume-implementation-snappy-ullman.md` (approved 2026-09-11): decisions D1–D9,
WP0–6, the four user decisions (polygon pads → S12c; exact editor gate; canonical arc — refined to
derived-at-read after Astra run 1 #11; `outline.minWebMm` rule only). Operating model as
`PROGRAM.md` "Standing instruction": plan mode (3 scouts + Opus plan-critique + an Astra
`brainstorm` on the design) → contract → Astra spec-attack → `impl-critical` work packages →
`reviewer-critical` → Astra adversarial-verify → gates → docs; never commit / push / stash.

## Done so far (and why)

- **§1 rounded shapes** — every pad carries `rounded` (convex core ⊕ disc); `pair-gap.ts`,
  `touch.ts` (all three pad predicates), `checks/keepouts.ts` and `checks/board.ts` measure on it;
  closes the connectivity false-contact limit (06 §5). `disc` and `ring` stay for the pour, the
  copper-shape unit, the artwork, the broad phase. Radii summed first (byte identity for circles);
  `r === 0` delegates to today's primitives (byte identity for rect / trapezoid / custom).
- **§2 canonical contour + exact kernel** — `canonical-contour.ts` (start-radius circle, authored
  end projected, chained, explicit closing segment; DERIVED, never persisted), `exact-arcs.ts`,
  `exact-ring.ts`, `exact-contour.ts`, `exact-simplicity.ts`; the annulus arm of `flattenOutline` is
  gone; ellipse outlines stay chords everywhere.
- **§3 validity** — `checks/outline.ts` and the editor's `validateContour` share one exact
  simplicity predicate (S2 #8 closed end-to-end); nesting rule (e) new; `outlineInvalid` counts only
  `BOARD_OUTLINE_INVALID` (R2 #1 — the budget note had downgraded the commit gate).
- **§4 certified interval** — `BoardRegion.outerBias` / `exact` / `boundMm` (lazy getters — never
  spread a region); `checks/board.ts` both bodies: certified PASS / FAIL keep today's inner measure,
  exact only on ambiguity; per-item exact budget (Astra 2 #2); fallback from both builds (Astra 2 #3).
- **§5 `OUTLINE_MIN_WEB`** — `material-web-kernel.ts`: necks, contact-run residuals, ring-pair exact
  distances (Astra 2 #1), pre-quantisation area (Astra 2 #4); `OUTLINE_WEB_UNCHECKED` never silent;
  `outline.minWebMm` design rule (absent ⇒ silent; no fab row published).
- **§6 Gerber Profile arcs** — `export/gerber/arcs.ts`: G75 iff arcs, one quantised centre, integer
  I/J, ≤ 90° pieces validated after quantisation, no centre repair, chord fallback + warning for a
  degenerate ring; `gerber-outline-parity.test.ts`.
- **Dead ends ruled out:** the "witness edge is an arc" second-chance trigger (Astra 0 broke it
  twice); pairwise primitive distance as the web definition (subdividing a convex arc manufactures
  a web); persisting the canonical endpoint (not a fixed point on the nm grid); a bisector centre
  repair in the writer (a 1 nm mismatch moves it ≈ 7 mm); "≥ 2 distinct rings" as the residual rule
  (missed a finger between two arms of one cutout); the opening alone for short throats (erased
  before classification).
- **Goldens:** `golden-arcs-2l` new (37 violations, attributed); `census` one `BOARD_OUTLINE_INVALID`
  id moved (exact contact witness); the other seven byte-identical.

## How to resume

1. Run the `handoff` skill with "resume".
2. Read `docs/pcb-hardening/PROGRAM.md` (S12b bullet, S12c row), contract 12, `src/modules/designer/AGENTS.md`
   "## DRC", the memory file `pcb-hardening-program.md`.
3. Verify the tree is still the S12b working tree (`git status --short | wc -l` ≈ 79, HEAD
   `262e4e4`) and re-run the cheap gates: `cd src/core/backend && bun test drc- pcb-geometry- gerber-`
   and `npx tsc -b --force 2>&1 | grep -c "error TS"` (44, repo root only).
4. Next (all need the user's word): commit S12b on `master`; the S11 shared-tags follow-up; then
   S12c (polygon pads) in plan mode; the mechanical split of `checks/board.ts` / `manufacturability.ts`
   with the five S12 files after S12c.

## Open questions

- When to commit S12b (never auto-commit; message suggestion in `TODO.md` "Now — handoff").
- Whether the user has tagged `../shared` (S11 fields) — S12c depends on it.
- CAM acceptance of the ≤ 2√2 nm Gerber arc radius residual — verify on a real fab upload.

## Pointers

- Tasks → `TODO.md` ("Now — handoff" block) · Snapshot → `CURRENT_STATE.md` · Session scratch →
  `/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/5cf59798-7b89-4741-9c64-204100af5304/scratchpad/s12b/`
  (briefs, Astra packets / outputs, r1 / r2 probes, gate logs; temporary).
