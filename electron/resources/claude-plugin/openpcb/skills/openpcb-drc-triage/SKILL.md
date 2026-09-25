---
name: openpcb-drc-triage
description: Run DRC on the OpenPCB board and triage violations by root cause, most severe first, with the fix for each. Use when the user asks about DRC errors, clearance problems or whether the board is ready to manufacture.
---

# Triage OpenPCB DRC

OpenPCB is the DRC authority — never compute clearances yourself.

1. `designer_get_pcb_state` for board setup, net classes and `drcSuppression` (waived violations,
   ignored rule classes); `designer_get_pcb_layout` (detail `summary`) if you need placement context.
2. `designer_run_drc`. Read `counts`: active, waived, and hidden (ignored rule classes / severity
   overrides). Report all three — **never call the board clean while anything is waived or hidden**;
   say what is suppressed and that the user chose to.
3. Group violations by root cause instead of listing them one by one — e.g. "clearance too tight for
   the default net class", "unrouted power net", "annular ring below fab minimum". Order by severity.
4. For each group say what would fix it and whether that is a **rule change** (`pcb_set_design_rules`,
   which waits for the user's approval) or a **layout change** (`pcb_place_footprints`, `pcb_route`,
   `pcb_delete_routing`).
5. Waiving is the user's decision, not a fix. Only when the user explicitly asks: waive specific
   violations with `pcb_waive_drc_violations` (ids from the current report, with the user's reason).
   Ignoring a whole rule class (`pcb_set_drc_rule_class_ignores`) hides every present and future
   violation of that class — propose it only on an explicit request. Both wait for the user's
   approval in OpenPCB; tell them, then `assistant_await_proposal`. Safety-critical codes (shorts,
   layer-invalid items) can never be waived.
6. After any change, run `designer_run_drc` again and report the new counts.
