# OpenPCB Desktop — Cloud Teams / Sharing / Collaboration: CURRENT STATE

> Feature-scoped handoff (the rest of the desktop's state lives in `TODO.md` +
> `ROADMAP.md`). Last updated **2026-06-10**.
> **Plan:** `~/.claude/plans/act-as-senior-software-atomic-lightning.md` (approved).
> **Cross-repo tracker:** workspace-root `TODO.md`.
> **Memory:** `project_teams_sharing_collab_plan`.

## What this feature is

Company/team usage: multiple users on the same project. **Shared** designs become
**cloud-authoritative** (cloud-api is the source of truth; local SQLite becomes a
refetch-only projection cache). **Personal/unshared designs stay local-first,
unchanged.** Built on the existing event-sourced command log (no CRDT). 3 phases:
P1 teams/sharing + async cloud-authoritative editing (conflict→refresh); P2 custom
WebSocket push + presence; P3 true co-editing (rebase + per-user undo).

## Status

| Side                                                                                                                             | State                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **cloud-api backend** (teams, members, invites, per-design grants, transfer, share redeem, role-aware authz, `design_role_rank`) | ✅ DONE + E2E-validated (devstack + Playwright, 2026-06-10) |
| **cloud-dashboard** (teams UI, invites, ShareSheet grants)                                                                       | ✅ DONE                                                     |
| **`@openpcb/cloud-client` SDK + `@openpcb/contracts` sharing types**                                                             | ✅ DONE                                                     |
| **Desktop integration** (this repo)                                                                                              | ❌ **NOT STARTED — this is the remaining P1 work**          |
| P2 realtime push + presence                                                                                                      | ⏳ after P1                                                 |
| P3 true co-editing                                                                                                               | ⏳ after P2 (gated on a field-level patch refactor)         |

The backend + web are usable today; **the desktop editor does not yet participate
as a cloud-authoritative client.** Today desktop still only mirrors commands
fire-and-forget (`designer/backend/cloud-sync.ts`); it has no inbound sync, no
authority switch, no read-only/offline gating.

## What's MISSING — desktop integration (P1.9–P1.11)

### P1.9 — authority migration + schema

- NEW `src/modules/designer/backend/migrations/0016_cloud_link_authority.sql`
  (head is `0015_comment_reactions.sql`; **next free = 0016**). Add to
  `designer_cloud_link`: `authority` (`local_first`|`cloud`, default `local_first`),
  `cloud_role` (UI hint only — never an authz boundary), `cloud_workspace_kind`,
  `applied_revision` (inbound watermark, default -1), `read_only`.
- Mirror in the `cloudLink` Drizzle table (`backend/schema.ts`).

### P1.10 — cloud-authoritative dispatch + link lifecycle

- `dispatchToCloudAndReplicate` (NEW in `backend/cloud-sync.ts`): for
  `authority='cloud'` designs, **projection-driven, NOT replay** — do NOT re-run
  `executeDesignerCommand` to "replicate" (cloud/desktop mint entity ids in disjoint
  namespaces → divergence). Per-`designId` async queue serializes dispatch; POST with
  `baseRevision = link.appliedRevision`; on 200 **refetch** `GET /v1/designs/:id/projection`,
  replace the local replica, set `applied_revision`, feed `inversePatches` to undo; 409 →
  resync+refresh (P1); 403 → read-only; block `pcb_*` (`PCB_NOT_SHARED` — cloud is
  schematic-only on the shared path).
- `upgradeLinkToCloudAuthority` (do NOT reuse `linkDesignToCloud`, which early-returns
  on already-linked designs — guardrail B2): force resync → set
  `applied_revision = cloud head` → stop the legacy fire-and-forget mirror for that link.
- `downgradeLinkToLocalFirst` (decision: un-share is **reversible**): when the last
  grant/share/membership is removed, pull the final projection, flip `authority` back to
  `local_first`, resume local revision authority, tear down the replica.
- Widen the lossy `CloudProjection` (`core/frontend/src/cloud/queries.ts`) to the verbatim
  `DesignerSchematicProjection`.
- "Shared with me" open: link to the owner's cloud design via the
  `existingCloudDesignId` param (`cloud-sync.ts`) and **skip `/seed`** (guardrail).

### P1.11 — read-only / offline gating + role-aware UI

- `editable = authority==='cloud' && role∈{owner,admin,editor} && connectivity==='connected'`.
  Offline → render last replica **read-only** + banner (net-new frontend state;
  `useDesignerWorkspace.ts` has no reusable banner). A never-synced shared design opened
  offline → explicit "not available offline" empty state.
- Discover the role via `GET /v1/designs/:id/access` ({role, source}); disable toolbar/
  palette/inspector dispatch for viewers/commenters (UX only — server `requireDesignRole`
  is the real backstop).
- Extend `commandErrorMessage` for `FORBIDDEN_ROLE` / `OFFLINE_READONLY` / `PCB_NOT_SHARED`.

### Backend↔frontend push (P2, not P1)

- The desktop has **no push channel** today (frontend full-reloads projections over HTTP).
  P2 adds a backend WS client (`cloud-ws-client.ts`, ref-counted by `cloudDesignId`) +
  SSE backend→renderer (reuse the tasks SSE pattern at `tasks/backend/routes.ts`).

## Key files to touch

`src/modules/designer/backend/{schema,store,cloud-sync,routes}.ts` ·
`src/modules/designer/frontend/{api.ts,hooks/useDesignerWorkspace.ts,Space.tsx,components/CloudDesignBrowser.tsx}` ·
`src/core/frontend/src/cloud/queries.ts`.

## Contracts the desktop consumes (already shipped cloud-side)

- Endpoints: `GET /v1/designs/shared-with-me`, `GET /v1/designs/:id/access`,
  `POST /v1/shares/:token/redeem`; commands still `POST /v1/designs/:id/commands`
  (now editor-gated, rejects unknown types, returns `inversePatches`).
- Role model: `@openpcb/contracts` `sharing/roles` (viewer 10 < commenter 20 < editor 30
  < admin 40 < owner 50). The desktop should consume these types (or add the literals
  locally — the SDK does the latter because it pins an older contracts tag).

## Verify (once built)

Devstack (`cd cloud-workspace/cloud-infra/devstack && make up-core`) + desktop
`npm run dev`. E2E: owner A shares a design with B → B opens it on desktop
(`existingCloudDesignId`, no seed) → B (editor) edits → A's projection reflects after
refresh; B demoted to viewer → next command 403 → desktop flips read-only;
last-grant-revoked → design de-flips to local-first on the owner; offline → read-only banner.
Run `npm run test:backend` (Bun) + `npm run test:react` (Vitest) + `npm run typecheck`.
