---
name: openpcb-drc-triage
description: Run DRC on the OpenPCB board and triage violations by root cause, most severe first, with the fix for each. Use when the user asks about DRC errors, clearance problems or whether the board is ready to manufacture.
---

# Triage OpenPCB DRC

OpenPCB is the DRC authority — never compute clearances yourself.

1. `designer_get_pcb_state` for board setup and net classes; `designer_get_pcb_layout` (detail
   `summary`) if you need placement context.
2. `designer_run_drc`.
3. Group violations by root cause instead of listing them one by one — e.g. "clearance too tight for
   the default net class", "unrouted power net", "annular ring below fab minimum". Order by severity.
4. For each group say what would fix it and whether that is a **rule change** (`pcb_set_design_rules`,
   which waits for the user's approval) or a **layout change** (`pcb_place_footprints`, `pcb_route`,
   `pcb_delete_routing`).
5. Only waive a violation (`pcb_set_drc_waivers`) when the user agreed it is acceptable.
6. After any change, run `designer_run_drc` again and report the new count.
