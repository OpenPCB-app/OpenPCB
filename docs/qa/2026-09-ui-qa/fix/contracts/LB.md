# LB contract — library backend changes for the frontend owners (L1, C2)

Backend side of T-256, T-253, T-270, T-049, T-055, T-251. All changes are additive on the wire except
the two status codes called out below. Types live in `src/sdks/library/types.ts` (re-exported from
`src/sdks/library`).

## T-256 + T-253 — `GET /api/modules/library/components` (L1)

Query params: `q`, `tags` (comma-separated, lower-cased server-side), `limit`, **`offset` (new)**.

- `limit`: clamped to `[1, 200]` (was `[1, 100]`), default 25. Invalid/`<= 0` → default.
- `offset`: non-negative integer, default 0. Negative or non-numeric → **400** problem+json.
- Response `data` is now a `LibraryComponentPage`:
  ```ts
  { components: LibraryComponent[]; total: number; offset: number; limit: number }
  ```
  `components` stays where it was, so existing readers of `data.components` keep working.
- `total` = every component matching `q` + `tags`. It is **the same number** as
  `GET /facets?q=…&tags=…` → `facets.total` (one shared predicate, `backend/component-filter.ts`).
  Use it for the header count and the "`<n>` of `<total>`" strip; page with `offset += limit` until
  `offset >= total` (infinite scroll or "Load more"). Select All must say it selects loaded rows, or
  fetch the remaining pages first.
- Order is stable across pages: exact name match, then name prefix, then name contains, then other
  matches; ties by name (binary/SQLite order), then id. Searching `R` puts a part named `R` first.

Search/filter semantics (list and facets identical):

- Free text matches `name + description + tags` (phrase, or every token). **The source id is no longer
  searched** — use the Source facet (`source:<id>` tag). `q=core` / `q=local` no longer return the
  whole library.
- Mount: facet keys are canonical **`smd` / `tht` / `mixed`** (was the raw footprint value, e.g.
  `through_hole`). A component's mount set = its default footprint's `mountType` ∪ its mount tags
  (`smd`, `smt`, `tht`, `through-hole`, …), canonicalised. Filters accept any spelling
  (`through_hole`, `smt`, …) and are canonicalised, so old persisted filter keys still work. Mount
  option `label` equals its key; humanise (`SMD`/`THT`/`Mixed`) in the UI if wanted.
- Family / package / other tags: every selected tag must be on the component (intersection-aware
  facet counts unchanged). System tags (`user`, `builtin`, `core`, …) have no facet but, if sent,
  filter the same way in both endpoints.

## T-270 — "Duplicate to edit" (`POST /components/:id/clone`) (L1)

Response unchanged (`201 { componentId, componentName }`). The copy is now a faithful, editable part:

- every footprint option is copied (variant label, default flag, order, **pin map**);
- metadata copied: manufacturer, MPN, LCSC, supplier, subcategory, datasheet URL, keywords;
- each footprint (and its 3D model row) is copied into `user.local` under a **new footprint id**, so the
  copy's `component.footprintId` / `footprintVariants[].footprintId` are its own.
  `POST/PATCH/DELETE /footprints/:footprintId/model` on those ids is **no longer rejected** — STEP upload
  on a duplicate works with the existing upload flow (upload to the copy's selected variant id). The
  symbol stays shared.
- Deleting the copy (`POST /components/delete`) also removes its private footprints.
- New optional field on every `LibraryComponent` (list, detail, placement): `origin:
  { libraryId, componentId, componentVersion } | null`. For a duplicate, `origin.componentId !== id`
  (the source part) — use it for the Details "Source" row (e.g. "Copy of Core library"). Pack
  components carry `origin` pointing at themselves; locally created parts have `null`.
- The built-in guard message now reads `Use "Duplicate to edit" to create an editable copy.`

## T-049 + T-055 — library sources (C2, `LibrariesPanel`)

- `GET /sources` rows gain **`isRemovable: boolean`** — false for `openpcb.core` and `user.local`,
  true for every installed pack. Render Remove iff `isRemovable` (instead of `kind !== "core"`).
- Only `openpcb.core` is ever `kind: "core"` / `isReadOnly: true`. An installed pack without
  `library.kind` (or claiming `core`) is stored as `kind: "team"`, removable. Existing bad rows are
  repaired by migration `0011_untrusted_core_sources.sql`.
- `DELETE /sources/openpcb.core` and `DELETE /sources/user.local` → **409** (was 400 for core; user.local
  was deleted!) problem+json, `type: https://openpcb.dev/problems/library-source-protected`,
  `sourceId` extra, `detail` is user-readable. Show it via `describeError`.
- `POST /sources/install` with a pack whose id is `openpcb.core` or `user.local` → **409**,
  `type: https://openpcb.dev/problems/library-source-reserved`.

## T-251 — `POST /imports/kicad/inspect` (and the zip / commit paths) (L1, L2)

Malformed user files (wrong file type, truncated s-expression, missing `(footprint …)` root, …) now
answer **400** `application/problem+json`, `type: https://openpcb.dev/problems/validation`, with the
parser's reason in `detail` (e.g. `Not a valid KiCad symbol library file`). Previously 500
`internal-error`. Show `detail` via `describeError(err, …)`.
