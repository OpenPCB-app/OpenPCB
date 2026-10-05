# Footprint intake quarantine

New KiCad footprint commits return HTTP 422 `UNQUALIFIED_IMPORT` until the source
coordinate transform is independently qualified. Direct KiCad import, KiCad ZIP
import and drawn-symbol plus imported-footprint commits reject before SQLite or
model asset writes. Inspection and preview remain available. Symbol-only imports,
editor-drawn footprints and IPC presets allowed by `generator-policy.ts` remain
available. Arbitrary editor geometry cannot prove its original authoring source;
the drawn payload is an explicit workflow boundary, not electrical certification.

All footprint-bearing `.opclib` installations are also blocked, including bundled
CoreLibrary bootstrap, updates, developer watching, manual installs and cloud
pulls. Pack signatures retain their existing authenticity checks, but do not
qualify footprint coordinate conversion. Missing provenance and self-declared
drawn/generated/frame qualification cannot authorize a pack. Symbol-only packs
remain supported. Existing library rows are not removed by this intake policy;
cloning preserves their provenance. A fresh installation can therefore have no
CoreLibrary components until a qualified pack intake exists.

Problem details include `source`, `blockedCapability`, affected footprint IDs and
source markers. Diagnostics classify explicit `kicad-derived` / `kicad_mod` /
`kicad-mod` markers as `kicad-derived`; other packs remain `unverified`. Reports
include at most 20 footprints and 256 characters per marker, with omitted counts
and explicit marker truncation. These classifications explain refusals; they never
permit a pack. There is no environment or payload override.

Focused verification:

```sh
bun test src/core/backend/tests/library-import-quarantine.test.ts src/core/backend/tests/library-generator-quarantine.test.ts src/core/backend/tests/library-generator-import.test.ts
npm run test:react -- src/modules/library/frontend/import-wizard/import-quarantine.test.tsx src/modules/library/frontend/import-wizard/preset-quarantine.test.tsx
```

This is an interim capability restriction. The underlying KiCad transform,
generator and manufacturing qualification work remains separate.
