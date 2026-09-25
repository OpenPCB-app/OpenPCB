---
name: openpcb-review-schematic
description: Review the schematic open in OpenPCB — connectivity, ERC, and concrete design problems — without changing it. Use when the user asks to review, check or audit a schematic.
---

# Review an OpenPCB schematic

This is a read-only review: do not propose edits unless the user asks.

1. `designer_get_design_summary`, then `designer_get_schematic_connectivity` (parts, pins, nets, wires).
2. `designer_run_erc`.
3. If the user keeps specs or notes in OpenPCB Docs, look for them with `knowledge_search_pages` /
   `knowledge_get_page` and check the design against them.
4. Report concrete problems, each grounded in a tool result with reference designators and net names:
   unconnected or floating pins, missing decoupling, missing pull-ups on open-drain / reset lines,
   undriven power rails, and parts whose value looks wrong for their role.
5. Order findings by severity and say which are ERC errors versus design judgement.
