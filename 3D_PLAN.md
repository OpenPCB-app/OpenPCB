# 3D Model Viewer — Plan

## Context

OpenPCB needs 3D visualization of components (and eventually full PCB). Goal aligns with KiCad's library convention: STEP is the canonical 3D format for components. Today the codebase has no 3D path:

- `kicad-footprint-parser.ts:257-277` already extracts `model3dRefs` (`path`, `offset`, `scale`, `rotation`).
- `commit-kicad-zip.ts:21-32` detects `.step/.stp/.wrl` inside imported ZIPs and tracks `selectedModel.fileName` in `archiveImport` metadata, but **never persists the binary** and never exposes the reference downstream.
- `ComponentDetailPage.tsx` shows 2D symbol + footprint previews only.
- Designer's `3d` tab exists in `DesignerView` enum and renders `DesignerPlaceholderView` ("coming soon").

**v1 scope = per-component 3D preview in the Library**. Full-board 3D is deferred to Phase 2 (sketched at end). On STEP import, tessellate once via `occt-import-js` WASM, export to GLB, store on disk under user data dir, render in R3F via Drei `useGLTF`.

---

## Decisions (locked)

| Topic             | Choice                                                           |
| ----------------- | ---------------------------------------------------------------- |
| v1 surface        | Component preview tab in `ComponentDetailPage`                   |
| STEP→mesh         | `occt-import-js` (WASM, runs in renderer)                        |
| Conversion timing | On import (KiCad ZIP + manual upload)                            |
| Cache format      | GLB (via Three.js `GLTFExporter`)                                |
| Cache location    | `<userData>/models/<sha256>.glb`; DB stores relative path + hash |
| Ingest sources v1 | (a) KiCad ZIP import (b) manual per-component upload             |
| Materials v1      | Category defaults driven by mountType/tags                       |
| Full-board view   | Phase 2                                                          |

---

## Architecture

### Conversion pipeline (renderer-side, on import)

```
STEP bytes ──▶ occt-import-js WASM ──▶ {meshes[], nodes[]}
                                          │
                                          ▼
                              build THREE.Group with BufferGeometry per mesh
                                          │
                                          ▼
                          GLTFExporter.parse(group, {binary:true}) ──▶ GLB bytes
                                          │
                                          ▼
                       POST /api/modules/library/footprints/:id/model
                       (multipart: glb + sha256 + originalStepHash + tessellationParams)
                                          │
                                          ▼
                       Backend writes file → updates footprint row → returns metadata
```

WASM module is lazy-loaded only when an import containing a STEP is detected, or when the manual upload dialog opens. Conversion happens in a `Worker` to keep UI responsive for large STEPs.

### Schema change

New table for asset cleanliness (avoid bloating `library_footprints.dataJson`):

```sql
-- src/modules/library/backend/migrations/0002_footprint_3d_models.sql
CREATE TABLE library_footprint_models (
  footprint_id TEXT PRIMARY KEY REFERENCES library_footprints(id) ON DELETE CASCADE,
  glb_path TEXT NOT NULL,             -- relative to userData/models/
  glb_sha256 TEXT NOT NULL,
  source_step_sha256 TEXT,            -- nullable for manual GLB uploads later
  source_filename TEXT,
  tessellation_params_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

Drizzle schema entry added to `src/modules/library/backend/schema.ts` matching existing patterns (lines 22-27).

### KiCad ZIP import wiring

`src/modules/library/backend/import/commit-kicad-zip.ts`:

- After footprint commit, if `selectedModel.fileName` ∈ extracted entries with extension `.step|.stp`: stream STEP bytes back to the frontend in the import response (or stash them in a temp blob the frontend can fetch).
- Frontend ImportWizard's success step queues conversion → POST GLB to new endpoint.
- Reason for renderer-side conversion even for ZIP path: keeps OCCT WASM out of Bun (untested, larger backend), single conversion code path.

Alternative path (minor): write STEP bytes to a temp dir inside `<userData>/tmp/import-<id>/`; frontend reads via a one-shot `/api/modules/library/imports/:id/raw-step/:fileName` endpoint that streams + deletes.

### Manual upload

New `ComponentDetailPage` "Upload STEP" button (gated on non-builtin) → `<input type="file" accept=".step,.stp">` → conversion worker → POST.

### Backend routes (new)

In `src/modules/library/backend/routes.ts`:

- `POST /footprints/:id/model` — multipart {glb, sha256, sourceStepSha256?, sourceFilename?, tessellationParamsJson} → write to `<userData>/models/<sha256>.glb`, upsert row.
- `DELETE /footprints/:id/model` — delete file + row.
- `GET /footprints/:id/model` — stream GLB (sets cache headers, ETag = sha256).
- `GET /footprints/:id/model/meta` — JSON metadata (used by ComponentDetailPage to decide whether to render 3D tab).

Resolves user-data dir using existing `OPENPCB_DB_PATH` neighbour logic; introduce `getUserDataDir()` helper if absent. Reuse `module-db-factory.ts` patterns for path resolution.

### Frontend: Component 3D tab

`src/modules/library/frontend/ComponentDetailPage.tsx` — convert the existing 2-column previews grid into a tab strip using `src/shared/frontend/ui/tabs` (already extracted per recent commit `f0b3177`):

- Tab 1: Symbol
- Tab 2: Footprint
- Tab 3: 3D (only when `model/meta` returns data; otherwise show "Upload STEP" CTA)

New component `ThreeDComponentPreview.tsx`:

```
<Canvas frameloop="demand" camera={{ position: [10, 10, 10], fov: 35 }}>
  <ambientLight intensity={0.6} />
  <directionalLight position={[5, 10, 5]} intensity={0.8} />
  <Suspense fallback={null}>
    <Bounds fit clip observe margin={1.2}>
      <ComponentGLB url={modelUrl} category={category} />
    </Bounds>
  </Suspense>
  <OrbitControls makeDefault enableDamping />
  <gridHelper args={[20, 20]} />
</Canvas>
```

`ComponentGLB`: `useGLTF(modelUrl)` → traverse, apply category material (see below), `invalidate()` on mount. Reuses the demand-rendering rule from `/r3f-eda-rendering` skill.

### Conversion worker

`src/modules/library/frontend/three-d/step-to-glb.worker.ts`:

```ts
import occtImportJs from "occt-import-js";
// onmessage: ({stepBytes, params}) => transferable {glbBytes, sha256, params}
```

Helpers in `src/modules/library/frontend/three-d/`:

- `step-to-glb.ts` — orchestrator (spawns worker, awaits result, computes sha256 via SubtleCrypto).
- `category-materials.ts` — `(footprint) => MeshStandardMaterial` lookup table. Inputs: `mountType`, tags, footprint name patterns. Defaults: body=#1a1a1a (IC) / #d4b483 (resistor) / #4080ff (cap-elect) / #c8c8c8 (cap-cer); pads/leads=#d4af37 gold.
- `apply-category-material.ts` — traverse loaded GLTF and replace materials.

### Coordinate / unit handling

STEP files use millimetres natively. occt-import-js returns mm. R3F scene is also mm (matches existing canvas convention `coords.ts`). One unit; no conversion. Apply `model3dRef.offset/rotation/scale` from KiCad parser when present (multiply into root group transform).

---

## File inventory

**New files**

- `src/modules/library/backend/migrations/0002_footprint_3d_models.sql`
- `src/modules/library/backend/services/footprint-model-store.ts` — userData filesystem ops, hashing, atomic writes.
- `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx`
- `src/modules/library/frontend/three-d/ComponentGLB.tsx`
- `src/modules/library/frontend/three-d/step-to-glb.ts`
- `src/modules/library/frontend/three-d/step-to-glb.worker.ts`
- `src/modules/library/frontend/three-d/category-materials.ts`
- `src/modules/library/frontend/three-d/upload-step-dialog.tsx`
- Backend tests: `src/core/backend/tests/library-3d-models.test.ts`
- Frontend test: `src/core/frontend/src/__tests__/three-d/category-materials.test.ts` (pure logic only; R3F not vitest-friendly)

**Modified**

- `src/modules/library/backend/schema.ts` (~L22-27): add `library_footprint_models` Drizzle table.
- `src/modules/library/backend/routes.ts`: 4 new endpoints.
- `src/modules/library/backend/import/commit-kicad-zip.ts` (L21-32 area + response shape): expose detected STEP bytes.
- `src/sdks/library/types.ts` (L115-121): extend `LibraryFootprintPlacementSnapshot` with optional `model3d?: { url: string; sha256: string }` for Phase 2 use; v1 only sets it but Designer doesn't read yet.
- `src/modules/library/frontend/ComponentDetailPage.tsx` (L259 area): tabs + 3D pane + upload CTA.
- `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx`: post-commit conversion step when STEPs detected.
- `package.json` (frontend workspace): `occt-import-js`, ensure `three`/`@react-three/drei` already present (verify in `src/core/frontend`).

**Reused (do not reinvent)**

- `kicad-footprint-parser.ts:257-277` — `model3dRefs` extraction.
- `commit-kicad-zip.ts:34` — `MODEL_EXTENSIONS` constant.
- `src/shared/frontend/ui/tabs` — tabs primitive (commit `f0b3177`).
- `EdaCanvas.tsx` patterns — only as reference; this Canvas is perspective, separate instance.
- Existing module-loader migration runner — picks up `0002_*.sql` automatically.
- Drei `useGLTF`, `OrbitControls`, `Bounds` — already used elsewhere or trivially added.

---

## Verification

1. **Unit / integration**
   - `bun test` on `library-3d-models.test.ts`: POST → file written under tmp userData; GET streams identical bytes; DELETE removes file + row; sha mismatch rejected.
   - Frontend pure-logic vitest: `category-materials.test.ts` covers mountType + tag combinations.

2. **Manual end-to-end (component preview)**
   - `npm run dev:electron`.
   - Import a KiCad ZIP that bundles a `.kicad_mod` referencing a `.step` (use `Resistor_SMD/R_0805_2012Metric.step` from kicad-packages3d sample).
   - Verify import wizard shows a "Converting 3D model…" step, finishes without error.
   - Open component → "3D" tab visible → renders mesh, OrbitControls work, body+pads have distinct colors.
   - Reload app → 3D tab still works (cache hit, no reconversion).
   - Delete component → GLB file removed from disk (cascade).

3. **Manual upload path**
   - Component without STEP → tab shows "Upload STEP" CTA → upload `.step` → tab populates after conversion.
   - Upload garbage `.step` → user-visible error, no DB row, no orphan file.

4. **Type / lint**
   - `npm run typecheck`, `npm run lint`.

5. **Performance smoke**
   - Convert a 5MB STEP (e.g., DIP-40) → conversion <10s on M-series, GLB <2MB, first render <300ms.

---

## Phase 2 (sketched, not in this plan's scope)

- Designer `3d` tab: extruded board outline from `Edge.Cuts`, copper layers from PCB store, placed-component GLBs at footprint transforms (re-using `LibraryFootprintPlacementSnapshot.model3d`). Reference implementation: `tscircuit/3d-viewer`.
- Layer toggles, exploded view, screenshot/export, optional `.wrl` material parser for higher fidelity.

---

## Resolved decisions (added)

- **WASM hosting**: bundle `occt-import-js` `.wasm` locally via Vite (`?url` import or `public/`). Offline-first.
- **Size caps**: STEP ≤ 25MB, GLB ≤ 10MB. Enforce at upload endpoint + frontend pre-check.
- **Builtin GLBs**: pre-convert at build time and commit GLBs alongside KiCad assets in `src/modules/library/backend/builtins/kicad-assets/`. Add a one-shot script `scripts/convert-builtin-step.ts` that runs occt-import-js in Bun (or invokes a small Node CLI) producing GLBs; seed reads them and writes `library_footprint_models` rows during seeding.
- **Variants**: model is keyed to `footprint_id` (matches schema). Each footprint variant gets its own STEP slot; no cross-sharing or component-level fallback in v1.

## Unresolved questions

- None.
