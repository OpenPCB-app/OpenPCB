# golden-small-2l

The original S0 golden: 7 placements, 25 traces, 4 vias, 2 free holes, 2 free pads, 1 zone on
`jlcpcb_2l`. It has no attribution history of its own before S12; every earlier delta is in
`docs/pcb-hardening/06-batch-drc-contract.md` §10.

## S12 — copper-shape hits on pre-existing geometry (contract 11 §5)

Re-baselined 2026-09-11; no fixture change. Both codes are new and both hits are true:

- `COPPER_SLIVER` +1 — trace `t22` (net `s5`) is 0.03 mm wide and 6 mm long, a `TRACE_WIDTH_MIN`
  probe: copper thinner than the 0.1 mm web with no second lobe is a sliver, not a neck
  (`≈ 0.030 mm thick, 6.0 mm long` at (9, −16)). The double report with the width rule is the
  recorded §5.1 behaviour.
- `TRACE_OVERLAP` +3 — same-net (`vcc`) duplicate runs the S1 item model could not see (01 §4
  #7): `t12` / `t16` share 3.5 mm of collinear run at y = 8.89; `t13` / `t14` share the vertical
  at x = −12.75 (1.2 mm); `t14` / `t15` share the one at x = −9.75.

Summary moves from `{13 errors, 17 warnings}` / 30 violations to `{13, 21}` / 34.
