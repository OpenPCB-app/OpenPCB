# Library Component Model Audit

_Read-only audit. No code was modified. All paths are relative to `OpenPCB/` unless prefixed `../`._

## TL;DR (variant vs option — what's real today)

- **There is no "variant" entity and no "option" entity.** A component → footprint relationship is a 1:N join table `library_component_footprints`. The word "variant" is only a **display label** (`variant_label` column); "footprint variant" = an alternative footprint the component can accept.
- **`variantId` and `footprintOptionId` do not exist in code.** Zero occurrences across `src/` (verified by grep). They live only in an **archived** design doc (`../docs/archive/2026-05/designer/data-model.md` §7.4/§7.6) that was never implemented.
- **The default footprint** is the join row with `is_default = 1`, mirrored into `library_components.footprint_id` as a cached pointer for the fast read path.
- **Placement always uses the component's cached default footprint.** No footprint is chosen at placement time; per-instance override is rendered in the UI but **fully disabled** ("Per-instance override coming soon").
- **The 3D model is linked to the footprint, not the component** (`library_footprint_models` PK = `footprint_id`). The detail page shows only the default footprint's model.

---

## Schema & migrations (with paths)

**`library_component_footprints` (the only footprint-option mechanism)** — `src/modules/library/backend/migrations/0002_component_footprints.sql`:

```sql
CREATE TABLE `library_component_footprints` (
  `component_id` text NOT NULL,
  `footprint_id` text NOT NULL,
  `is_default` integer NOT NULL DEFAULT 0,
  `variant_label` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`component_id`, `footprint_id`), ...
```

Drizzle mirror + intent — `src/modules/library/backend/schema.ts:144-164`. Note the doc comment (`schema.ts:139-143`): _"1:N component → footprint variants … Exactly one row per component has `isDefault = 1` and matches the cached `library_components.footprintId`."_

**Per-component pin map added later** — `src/modules/library/backend/migrations/0004_component_footprint_pinmap.sql`:

```sql
ALTER TABLE `library_component_footprints` ADD COLUMN `pinmap_json` text;
```

**Cached default pointer on the component** — `src/modules/library/backend/schema.ts:104-109`:

```ts
/** Cached default footprint id. The full set … lives in
 *  `library_component_footprints`; this column stores the one with
 *  `is_default = 1` for fast lookup on the read path. */
footprintId: text("footprint_id").notNull(),
```

**Is there ANY "variant" table or column?** — **Partially.**

- Table named "variant": **NOT FOUND.** `grep -i "create table.*variant"` over `src/modules` returns nothing. The only relationship table is `library_component_footprints`.
- Column: `variant_label` (display label) and the SDK type name `LibraryComponentFootprintVariant`. There is **no `variant_id` / `variantId` column anywhere** (grep: 0 hits in `src/`).

**How DEFAULT is marked/stored:** dual representation — `library_component_footprints.is_default = 1` (authoritative, in the join) **and** `library_components.footprint_id` (cached copy of that row's footprint id). The invariant (exactly one `is_default=1` matching the cache) is documented in `schema.ts` but **not enforced by a DB constraint**.

---

## Contracts (variantId / footprintOptionId reality check)

**`part_origin_ref` — NOT FOUND in code.** Grep over the entire workspace finds it only in archived docs:

- `../docs/archive/2026-05/designer/data-model.md:594` §7.4 — shape: `componentId`, `variantId`, optional `footprintOptionId`. References file `contracts/components/part-origin-ref.ts`, which **does not exist** (no `contracts/components/` tree in current `src/modules/designer`).

**`variantId` written or read in real code?** — **Never.** 0 occurrences of `variantId` / `variant_id` in `src/`.

**`footprintOptionId` written or read?** — **Never.** 0 occurrences in `src/`. Exists only in archived doc §7.4 / §7.6.

**The real placement contract** — `src/sdks/library/types.ts:71-100`:

```ts
export interface LibraryComponentFootprintVariant {
  footprintId: string; variantLabel: string; isDefault: boolean;
  sortOrder: number; name: string; mountType: string | null;
  padCount: number; packageCode: {...}; pinMap: LibraryPinMapEntry[] | null;
}
export interface LibraryComponentDetail {
  component; symbol; footprint /* resolved default */; footprintVariants: [...];
}
```

Identity is `footprintId` (the footprint's own id). **No separate option/variant id is minted.**

**`footprint_snapshot`:** the task's premise ("stored-but-unused per DATA_MODEL.md §7.6") is **stale**. Two distinct things share the name:

1. **Archived ECS component `footprint_snapshot`** (`../docs/archive/2026-05/designer/data-model.md` §7.6, line 642; fields incl. `footprintOptionId`): _"present in schema … not used by current projection or net logic"_; reinforced at line 1491 _"`footprint_snapshot` exists but is not used"_. This ECS component was **never built** — no `contracts/components/footprint-snapshot.ts` exists.
2. **The real designer storage `footprint_snapshot_json`** — `src/modules/designer/backend/schema.ts:40` (`text("footprint_snapshot_json").notNull()`), written at `command-executor.ts:347` / `projection-world.ts:753` and **actively read** at `projection-read.ts:41,82`. It stores the full `LibraryFootprintPlacementSnapshot` (default footprint geometry), **not** a `footprintOptionId`.

→ So "footprint snapshot" today is **stored AND used**, and contains no option id. **NOT FOUND:** any `DATA_MODEL.md` (uppercase) or `CURRENT_STATE_REPORT.md` in the repo.

---

## Queries & default-selection logic

`src/modules/library/backend/queries.ts`:

- **`loadComponentFootprintVariants` (758-832):** selects `library_component_footprints` rows for the component, `ORDER BY sort_order`, joins each to its footprint for display metadata. **Fallback (776-800):** if no join rows exist (older imports), synthesizes a single-entry list from `componentRow.footprintId` with `isDefault: true`.
- **`getComponentDetail` (853-890):** returns `footprint: mapFootprintDetail(footprintRow)` where `footprintRow` is fetched by `components.footprintId` (the cached default) — **not** by scanning for `is_default`. Plus `footprintVariants` (full list).
- **`resolveComponentForPlacement` (892-942):** same default-footprint resolution; additionally loads the 3D model row for that footprint and the default footprint's `pinMap` (`loadDefaultFootprintPinMap`, 834-850, matched on `componentId + footprintId`). Returns `footprintVariants` too.

**How "default" is chosen:** by reading `library_components.footprint_id` (the cache). `is_default` is used to _label_ the matching row in the list (`row.isDefault === 1`, line 822), not to drive selection.

---

## ComponentDetailPage — what renders + wording sources

`src/modules/library/frontend/ComponentDetailPage.tsx`:

- **Three panes (490-655):**
  - **Symbol** — `SymbolPreviewCanvas` + name / reference / pins / warning count.
  - **Footprint** — `FootprintPreviewCanvas` + name / mount / pads / package / warnings. Renders **`detail.footprint`** (the resolved default only). Shows "No footprint yet" when `placeholder-footprint` tag present (536-540, 552).
  - **3D** — `ThreeDComponentPreview` keyed to `detail.footprint.id` (644-652); "Upload STEP" control shown only when `!isBuiltin && !isPlaceholderFootprint` (597).
- **"Footprint variants" section (657-719):** rendered **only when `footprintVariants.length > 1`** (657).
  - Heading literal `"Footprint variants"` — **line 663**.
  - Wording _"This component can use any of the {N} footprints below. The default is preselected when placing a new instance; **per-placement override coming soon.**"_ — **lines 665-670**.
- **DEFAULT badge logic:** `variant.isDefault` → renders a "Default" pill — **lines 698-702**.
- **Does selecting a row change any preview?** — **NO.** The list (671-717) is a static `<ul>`; rows have **no `onClick`** and there is no selection state. Each row only lazy-loads a `preview.svg` thumbnail (685). The main Footprint/3D panes are fixed to the default.
- **CORE / read-only / builtin determination:** `detail.component.isBuiltin` (154) →
  - "Core" lock badge in header (335-340),
  - read-only note "Read-only built-in. Click Duplicate…" (404-411),
  - Edit button hidden, STEP upload hidden.
  - `isPlaceholderFootprint` is separate: derived from the tag `placeholder-footprint` (150-153).

---

## Placement & import behavior

**`place_part` (no footprint choice):**

- Route parser reads **only** `componentId` (+ transform) — `src/modules/designer/backend/routes.ts:270-290` (`asString(raw.componentId)`; no `footprintOptionId`/`variantId`/`footprintId` parsed).
- `command-executor.ts:990-992` calls `buildPlacePartPayload(detail, …)` where `detail = store.resolveComponentForPlacement(componentId)` (`store.ts:476`) → footprint = component's cached default.
- `buildPlacePartPayload` (`src/modules/designer/backend/commands/place-part.ts:115-140`) freezes `footprint: detail.footprint` into the part payload. **The default footprint is the only footprint a placed part ever gets.**

**Per-instance override = rendered but disabled:**

- `Space.tsx:233-236` fetches `detail.footprintVariants` and passes them to `SelectionInspector`.
- `SelectionInspector.tsx:113-121` renders `PartInspectorPanel` with `onReplaceComponentDisabledMessage="Per-instance override coming soon"`.
- `PartInspectorPanel.tsx`: builds a footprint dropdown of `variants`, marks current via `part.footprint.footprintId` (250-256), shows a "Default" badge (361-363), but **every option is `disabled = Boolean(onReplaceComponentDisabledMessage)`** (338) — i.e. always disabled today. No command exists to change a placed part's footprint (only `create-wire.ts` and `place-part.ts` in `commands/`).

**Import wizard (footprints attached at import, no variant concept):**

- `FootprintStep.tsx` "Package Variants" list (heading line 423): clicking a row sets `selectedFootprintId` (433) for _preview/inspection_; index 0 is shown as `"default ★"` (442). This selects which footprint(s) are being inspected, not a variant id.
- Persistence — `src/modules/library/backend/sync/opclib-importer.ts:739-760`: on (re)import it **deletes and re-inserts** all `componentFootprints` rows for the component; per footprint it sets `isDefault: variant.footprint === entry.defaultFootprint ? 1 : 0`, `variantLabel: variant.label`, and `pinMapJson`. The default is just whichever footprint id equals `entry.defaultFootprint`. **No variant/option id is generated.**

---

## 3D model linkage

- **Linked to the FOOTPRINT, not the component.** `library_footprint_models` has `footprint_id` as PRIMARY KEY with `ON DELETE CASCADE` to `library_footprints` — `src/modules/library/backend/migrations/0002_footprint_3d_models.sql` + `schema.ts:77-95`. One model row per footprint.
- The detail page 3D pane fetches `/api/modules/{moduleId}/footprints/{footprintId}/model` using **`detail.footprint.id` (the default footprint)** — `ThreeDComponentPreview.tsx:210`, wired from `ComponentDetailPage.tsx:648`.
- At placement, the model descriptor is attached only for the resolved (default) footprint — `queries.ts:421-423` (`snapshot.model3d = mapFootprintModelDescriptor(modelRow)`).
- **Implication:** non-default footprint variants _can_ each own a 3D model (keyed by their own `footprint_id`), but the UI only ever surfaces the default footprint's model.

---

## Doc drift (contradictions with the design docs)

- **No `DATA_MODEL.md` / `CURRENT_STATE_REPORT.md` exist** in the repo (NOT FOUND). The task's section references map to **`../docs/archive/2026-05/designer/data-model.md`** (an archived, lowercase, designer-scoped doc).
- **Archived doc describes an unbuilt ECS model.** §7.4 `part_origin_ref` (`componentId`, `variantId`, optional `footprintOptionId`) and §7.6 `footprint_snapshot` (`footprintOptionId`) — none of these fields, files, or the `core/backend/designer/contracts/components/*` paths they cite exist in current code (code lives under `src/modules/designer/`). This archived spec is the **only** source of the "variant + footprintOption" framing.
- **"footprint_snapshot is unused" is contradicted by reality.** Archived doc line 1491 lists `footprint_snapshot` as reserved-but-unused; the _current_ designer stores `footprint_snapshot_json` and **reads it** in `projection-read.ts`. The active doc `../docs/designer/data-model.md:30,58` correctly states parts carry a footprint snapshot — so active vs archived docs disagree.
- **Terminology drift in live code:** the live model has no "option" anywhere, yet uses "variant" three ways — a SQL **label** (`variant_label`), a **TS type** (`LibraryComponentFootprintVariant`), and **UI copy** ("Footprint variants"/"Package Variants") — for what is structurally just "an alternative footprint."

---

## Open questions for product

1. **Naming:** settle on one term. Today's data model is "a component accepts N footprints, one default." Is the user-facing concept **"footprint variant," "footprint option,"** or **"alternative footprint"**? Pick one and align SQL/TS/UI.
2. **Per-placement override:** the UI promises it ("coming soon") and the picker is pre-wired but disabled. Is per-instance footprint selection the intended next feature? If yes, it needs (a) a new designer command, (b) a place-time footprint id, and (c) a route-parser field (note the known gotcha: new command fields must be added to `routes.ts` or they're dropped over HTTP).
3. **Should the placed part remember which footprint option it used?** Currently the part stores a frozen `footprint` snapshot but no back-reference to the chosen join row. The archived `part_origin_ref`/`footprintOptionId` idea would cover this — **adopt it, or formally retire the archived spec?**
4. **3D per variant:** models already key on `footprint_id`, so each variant can carry its own 3D model — but only the default's is shown/uploadable in the detail page. Should the UI expose 3D per footprint variant?
5. **Default invariant:** "exactly one `is_default=1` matching `components.footprint_id`" is convention-only (no DB constraint, dual storage). Worth a check/constraint, or collapse to a single source of truth?
