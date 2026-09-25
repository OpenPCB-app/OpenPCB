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
4. Report in two clearly separate groups:
   - **ERC findings** — exactly what `designer_run_erc` reported (unconnected pins, undriven rails,
     conflicting drivers…), with reference designators and net names. These are facts.
   - **Engineering observations** — heuristics such as missing decoupling, missing pull-ups on
     open-drain / reset lines, or a value that seems wrong for its role. For each, give the evidence
     (part, pins, nets, and the component data from `library_get_component_detail`) and say when the
     data is not enough to be sure — e.g. no datasheet values in the library entry. Never present an
     observation as a rule violation.
5. Order each group by severity. Ask the user before assuming operating conditions (voltages,
   currents) that a finding depends on.
