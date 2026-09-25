---
name: openpcb-build-circuit
description: Build a circuit in the OpenPCB schematic from a description — resolve parts from the installed library, create or pick a design, place, wire, and verify. Use when the user asks to design, build, create or wire a circuit in OpenPCB.
---

# Build a circuit in OpenPCB

OpenPCB must be running with Settings → Assistant → MCP enabled and **Allow writes** on.
If no write tools are listed, ask the user to turn on Allow writes.

## Before you build: separate what you may choose from what you must ask

- **Ask the user** when the request does not fix something electrical or manufacturing-critical:
  supply and logic voltage, currents and power / voltage ratings, a package or footprint the
  assembly depends on, connector pinouts, isolation or safety requirements, fab limits. A wrong
  guess here can destroy a part or make the board unbuildable — never fill it in silently.
- **Choose and report** only reversible, low-stakes details: placement, spacing, label positions,
  reference designator order. Say what you chose.
- If the library has no part that meets a stated requirement, say so; do not substitute silently.

Once the requirements are settled, carry the build through — placed, wired and verified — before
summarising. Stop and ask if a tool result contradicts the plan.

## Steps

1. **Pick the design.** `designer_list_designs`; use the one the user means (`designer_use_design`
   to pin it), or `designer_create_design` for a new one. Never guess ids.
2. **Resolve the BOM** with `library_resolve_bom` (one call for the whole circuit). Search by generic
   family and treat color/value/package as requirements (`LED` with color red, not "LED red").
   Never invent parts; if something is missing after a broad search, say so and suggest an import.
3. **Standard blocks** (indicator LEDs, …): prefer `compile_circuit` — one call resolves parts,
   computes values, places, wires, adds power rails and runs ERC.
4. **Otherwise place** with `designer_propose_schematic_edits` (parts, labels, power ports), then read
   `designer_get_schematic_connectivity` for the new references and pin names.
5. **Wire** in ONE `designer_propose_schematic_wires` call: pins as `REF.PIN` (`"U1.4"`), rails as
   `{ "net": "GND" }` / `{ "net": "<rail the user specified>" }`. Prefer pin numbers over decorated
   names.
6. **Verify** with `designer_verify_build`; fix what it reports (missing parts, unwired rails,
   dangling power pins, ERC errors) and verify again.
7. **Summarise** only what tool results confirmed.

## Rules

- Pass a stable `action_id` on every write (e.g. `wire_U1.OUT__R1.1_<designId>`) so retries are
  no-ops. After a rejection or a failure, use a NEW id — re-sending the old one is refused.
- Non-destructive edits apply immediately and are undoable in OpenPCB (the user sees them live).
- Deletions (`designer_propose_schematic_deletions`) wait for the user's approval in OpenPCB's
  assistant panel: tell the user, then `assistant_await_proposal` with the proposal id. Never re-send.
- Ids of nets, wires and parts can change after edits — re-read before reusing them.
- Do not touch the PCB unless the user asks (see the openpcb-pcb-layout skill).
