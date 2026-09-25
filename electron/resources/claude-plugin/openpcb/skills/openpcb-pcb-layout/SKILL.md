---
name: openpcb-pcb-layout
description: Lay out the OpenPCB board — outline, footprint placement, routing, pours — then check it with DRC. Use when the user asks to place footprints, route traces, draw the board outline, add a ground pour or otherwise work on the PCB.
---

# Lay out an OpenPCB board

Work on the PCB only when the user asks. OpenPCB must have **Allow writes** enabled.
All coordinates are millimetres in board space.

## Read first

`designer_get_pcb_layout` returns the outline, clearances, net classes, every footprint (reference,
position, rotation, side) with pad positions and nets, existing copper per net, and the unrouted
connections as pad pairs (`"U1.3"` → `"R1.1"`). Filter with `refs` / `nets` on big boards.

## Workflow

1. **Outline**: `pcb_set_board_outline` (rect / roundrect / circle from width × height, or a polygon).
2. **Place**: `pcb_place_footprints` by reference designator (position, rotation 0/90/180/270,
   side top/bottom). Keep parts inside the outline; group by function; decoupling caps next to
   their IC's power pins.
3. **Route**: `pcb_route` per net — `from` / `to` pads as `REF.PAD`, optional `waypointsMm`; the
   path gets 45° elbows automatically, width and vias default to the net's class. It is one atomic,
   undoable change. If OpenPCB answers `PCB_COPPER_ILLEGAL`, the path would violate DRC — move the
   waypoints or change layer (add a via) and try again; do not force it.
4. **Pours**: `pcb_manage_zone` (e.g. GND on B.Cu over the whole board); keep areas clear with
   `pcb_manage_keepout`.
5. **Check**: `designer_run_drc` after every batch; the write tools also report the DRC count.

## Approval and undo

- Deleting copper (`pcb_delete_routing`), deleting zones/keepouts, and rule changes
  (`pcb_set_design_rules`, not undoable) wait for the user's approval in OpenPCB. Tell the user, then
  call `assistant_await_proposal`.
- Never guess manufacturing values: widths, clearances and drill sizes come from the design's net
  classes or from the user / their fab.
- `designer_undo` / `designer_redo` only act on changes this session made; the user undoes their own
  edits in OpenPCB. Use `designer_get_history` to see what the next undo would affect.
