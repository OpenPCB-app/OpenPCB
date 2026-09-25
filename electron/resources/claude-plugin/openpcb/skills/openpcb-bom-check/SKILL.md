---
name: openpcb-bom-check
description: Check the OpenPCB bill of materials for rows that would block ordering or assembly. Use when the user asks about the BOM, part numbers, or ordering readiness.
---

# Check an OpenPCB BOM

1. `designer_get_bom`.
2. Flag: rows with no MPN, parts marked DNP that still look required, duplicate reference designators,
   values that do not match the component's package or rating, and any row the projection warned about.
3. Finish with the count of orderable versus blocked lines.
4. Report only what the BOM data supports — never invent part numbers or suppliers.
5. `designer_export_manufacturing` checks whether the board can be exported and lists the bundle; the
   user exports the files from OpenPCB's PCB toolbar.
