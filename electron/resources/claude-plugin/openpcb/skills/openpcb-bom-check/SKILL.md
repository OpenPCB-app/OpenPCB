---
name: openpcb-bom-check
description: Check the OpenPCB bill of materials for rows that would block ordering or assembly. Use when the user asks about the BOM, part numbers, or ordering readiness.
---

# Check an OpenPCB BOM

1. `designer_get_bom`.
2. Flag: rows with no MPN, duplicate reference designators, and any row the projection warned about
   (facts from the BOM). Separately, as observations with their evidence: DNP parts that look
   required, and values that seem not to fit the component's package or rating — only where the
   library data shows the rating; otherwise say it cannot be checked.
3. Finish with the count of orderable versus blocked lines.
4. Report only what the BOM data supports — never invent part numbers or suppliers.
5. `designer_export_manufacturing` checks whether the board can be exported and lists the bundle; the
   user exports the files from OpenPCB's PCB toolbar.
