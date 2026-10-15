# Hardening design docs (2026-10)

Implementation designs for the P1 hardening items, written before W3 of the 2026-10-15 batch run.
Each doc has §4 slices, §5 edge cases, §6 migration/rollback and §7 tests. `DECISIONS.md` holds the
binding user/lead decisions and overrides any open-question default inside the docs.

| Doc | Plane |
| --- | --- |
| `H08-OPENPCB-56-net-identity.md` | OPENPCB-56 |
| `H13-OPENPCB-61-kicad-frame.md` | OPENPCB-61 |
| `H14-OPENPCB-62-kicad-project-import.md` | OPENPCB-62 |
| `H15-OPENPCB-63-ipc-preset-qualification.md` | OPENPCB-63 |
| `H19-OPENPCB-67-manufacturing-output.md` | OPENPCB-67 |
| `P103-OPENPCB-103-edit-recovery.md` | OPENPCB-103 |

Migration numbering overrides the docs: designer H08 `0021_net_identity`, H13
`0022_design_frame_status`, H19 `0023_drc_result_provenance`, H14 `0024_kicad_import_reports`;
library H13 takes the next free number (`0012_footprint_frame_provenance` if free).

Cross-item merge order for shared designer files (§4.7): P103 S2 → H08 S3/S5/S7/S10 → H13
OP4a/b/c → H19 S2/S6a/S6b → H14 S10.

Slice progress and remaining work are tracked in Plane (per item, plus the "Session handoff
2026-10-15" page), not here.
