[← index](README.md)

# Structural / layout proposals

## (e) Structural / layout proposals (not built without approval)

| ID | Proposal | What | Findings → TIDs | Evidence |
|---|---|---|---|---|
| **P1** | Fixed PCB tool row (no canvas resize) | Reserve a permanent 28 px row under the PCB toolbar for route/tune parameters and tool hints; move notices into canvas overlays. | F2A-020, Q4-004, F1B-033 → T-146 | [041-route-armed](evidence/shots/f2a/dark/041-route-armed.png) |
| **P2** | Narrow-window (1100×720) responsive layout | Below ~1280 px auto-collapse the right dock / left panel, Library facet rail / preview pane and Home preview column; area entries only do minmax column fixes. | Q4-041, Q10-017, Q1-005, F1B-028, Q7-026, F2B-009 → T-032, T-172, T-221, T-255, T-302 | [012-1100-pcb](evidence/shots/q4/light/012-1100-pcb.png) |
| **P3** | Cloud layout actions in the PCB toolbar | 'Layout ▾' toolbar dropdown (Auto Layout…, Route board…, Auto place…) with kit dialogs instead of floating canvas buttons/panels. | Q10-014 → T-177 | [021-C1-pcb-autolayout-buttons](evidence/shots/q10/dark/021-C1-pcb-autolayout-buttons.png) |
| **P4** | Trace/via inspector | Net, width, layer span, via type (blind/buried) in PCB Properties; needs backend edit commands. | F2B-011 → T-174 | [073-blind-vs-through](evidence/shots/f2b/dark/073-blind-vs-through.png) |
| **P5** | Net-class management | Add/rename/delete net classes with per-class via size in Design rules. | F1B-007 → T-162 | [041-design-rules-dialog](evidence/shots/f1b/dark/041-design-rules-dialog.png) |
| **P6** | Part wizard structure | Metadata fields (value/MPN/manufacturer/datasheet, backend), 3D model preview + orientation in Model step, harmonised step layouts, pin↔pad mapping table. | Q7-030, Q7-035, Q7-036, Q7-017 → T-296, T-304, T-305, T-308 | [080-metadata](evidence/shots/q7/dark/080-metadata.png) |
