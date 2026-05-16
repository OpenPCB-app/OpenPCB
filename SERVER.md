# OpenPCB Cloud Server — Specification

Status: **Draft / spec-only**. No code yet. License intent: **AGPL-3.0**.

Companion to the existing desktop app. Adds account/auth, cloud sync of designs, presence-style collaboration, a public component catalog, and a sync channel for the built-in/"core" library. The desktop app remains fully functional offline; the server is **optional but first-class**.

Cross-refs: `docs/PROPOSED_ARCHITECTURE.md`, `docs/COMMAND_PATTERN.md`, `docs/DATA_MODEL.md`, `TODO.md`.

---

## 1. Goals & non-goals

**Goals**

- Cloud sync of designs (schematic + PCB) across devices for one user.
- Multi-user collaboration on a single design with **presence + revision-locked single-writer** semantics (no CRDT in v1).
- Account/auth: email+password, GitHub OAuth, Google OAuth.
- Public component library: catalog of submitted+reviewed components, immutable versioned releases.
- Authoritative core-library distribution to desktop clients (channels: `stable` / `beta`).
- Asset storage for 3D models, images, exported Gerbers.
- Opt-in telemetry/crash reports (Sentry-wired already on client).
- Self-host parity with hosted SaaS via a single build with multi-tenant flag.

**Non-goals (v1)**

- Replacing the desktop app or web-only editing.
- True concurrent multi-writer editing on the same design (CRDT/OT) — deferred.
- E2E encryption — deferred to Phase 5; design keeps it feasible.
- Branching / git-style history per project — Phase 5.
- Paid marketplace — Phase 4+.
- SSO/SAML/OIDC — Phase 3.

---

## 2. Deployment topologies

| Topology                      | Description                                          | Auth                      | Library                                          | Sync | Collab |
| ----------------------------- | ---------------------------------------------------- | ------------------------- | ------------------------------------------------ | ---- | ------ |
| **Hosted SaaS**               | `cloud.openpcb.dev`, multi-tenant Postgres + S3.     | Email+OAuth               | Curated core + public catalog                    | ✓    | ✓      |
| **Self-host (single-tenant)** | One Postgres + object store per org, Docker Compose. | Email; OAuth optional     | Mirror of curated core; private submissions only | ✓    | ✓      |
| **Self-host (multi-tenant)**  | Same image, `OPENPCB_MULTI_TENANT=true` build flag.  | Email+OAuth+(Phase 3) SSO | Full                                             | ✓    | ✓      |
| **Air-gapped offline**        | No server. Desktop only.                             | None                      | Local seeded built-ins only                      | ✗    | ✗      |

Feature degradation is per-feature, not all-or-nothing. The desktop app **must always boot without a server**.

---

## 3. Identity & accounts

Phase 1 launch: **personal accounts only**. Each user owns a single personal workspace.

Phase 2: introduces `org → workspace → project → design` graph + memberships.

Entities:

- `user` — id (ULID), email (unique), display name, avatar URL, locale, status (active/suspended), timestamps.
- `user_identity` — provider (`password`, `github`, `google`, later `oidc`), provider subject, primary flag. Multiple identities per user (account linking).
- `workspace` — id, owner_user_id, slug, kind (`personal` v1 / `org` v2), settings.
- `project` (Phase 2+) — id, workspace_id, name, visibility (`private` / `link` / `public`).
- `project_member` (Phase 2+) — project_id, user_id, role.
- `api_token` — id, user_id, name, scopes, last_used_at, expires_at, prefix, hashed secret. For CLI/CI use.
- `invite` (Phase 2+) — token, project_id, role, email_hint, expires_at, accepted_by.

Roles (Phase 2+): `owner`, `admin`, `editor`, `viewer`. v1 personal-only collapses to owner.

---

## 4. Auth

Providers (v1): email+password, GitHub OAuth, Google OAuth. Phase 3: SSO/SAML/OIDC.

Session model:

- **Opaque refresh tokens** stored server-side in `session` table; client receives short-lived **access JWT** (`exp` ≤ 15 min) signed with rotating RS256 keys (JWKS endpoint).
- Sliding refresh: rotate on use; revoke entire session family on detected reuse.
- `session` row: id, user_id, device_label, user_agent, ip_hash, refresh_hash, last_seen_at, expires_at, revoked_at.

Electron desktop sign-in:

- **OAuth 2.0 Authorization Code with PKCE** via system browser; loopback redirect on `http://127.0.0.1:<port>/openpcb-auth/callback`.
- Email+password: native form inside app, POST to `/v1/auth/password`.
- Tokens stored in OS keychain via Electron `safeStorage` API.

CLI / CI: long-lived `api_token`s with explicit scopes (`designs:read`, `designs:write`, `library:publish`, …). Never expose JWTs to scripts.

Email verification + password reset: standard signed-link flows with 30-min TTL.

Rate limits: aggressive on `/v1/auth/*` (per IP and per email). Lockout after 10 failures / 15 min, exponential backoff.

---

## 5. Authorization model

Resource graph: `workspace → project → design` (v1: workspace owns designs directly; v2 introduces `project`).

RBAC matrix (Phase 2+):

| Action                              | viewer | editor | admin | owner |
| ----------------------------------- | :----: | :----: | :---: | :---: |
| Read design / library               |   ✓    |   ✓    |   ✓   |   ✓   |
| Dispatch design command             |        |   ✓    |   ✓   |   ✓   |
| Invite/remove members               |        |        |   ✓   |   ✓   |
| Delete project / transfer ownership |        |        |       |   ✓   |

Sharing primitives:

- **Link share** — per-design tokenized URL with role (`viewer` / `editor`) and optional expiry; revocable.
- **Public read** — design or library version marked public; cacheable via CDN.
- **Audit log** entry on every share, role change, transfer.

All authz decisions live in `src/server/auth/policy.ts` (planned), called by every route + WS upgrade handshake.

---

## 6. Sync protocol — designs

**Server is the canonical writer.** Builds directly on the existing command model (`src/shared/domain/commands/command-envelope.ts`, `command-result.ts`, `patch.ts`):

```
CommandEnvelope { commandId, sessionId, aggregateId (designId), baseRevision, issuedAt, command }
CommandResult   ok+{revision, forwardPatches} | conflict+{code:"REVISION_CONFLICT", conflict}
```

Transport:

- **HTTPS** `POST /v1/designs/{designId}/commands` — dispatch. Idempotent on `commandId`.
- **WebSocket** `wss://…/v1/designs/{designId}/stream` — per-design channel: applied commands, presence frames, comment events.

Server flow per command:

1. Authz check.
2. Lookup design head (`designs.revision`) inside a `BEGIN IMMEDIATE`-equivalent (Postgres `SELECT … FOR UPDATE` on the design row).
3. Idempotency: if `commandId` already in `design_commands`, return stored `CommandResult` unchanged.
4. If `baseRevision !== head.revision` → return `REVISION_CONFLICT` with current revision + minimal conflicting patch summary.
5. Run handler → produce forward + inverse patches.
6. Persist: append to `design_commands`; update normalized projection rows / `pcb_entities` JSON; bump `designs.revision`.
7. Commit.
8. Broadcast `{revision, forwardPatches}` to all subscribers on the WS channel.

Client behavior:

- Online: dispatch over HTTPS, mark caches stale, refetch (matches today's pattern in `src/core/frontend/src/generated/sdk/`).
- Offline: queue envelopes in a local SQLite table (`outbound_commands`). On reconnect, replay in order **with original `baseRevision`**.
- Conflict on replay → surface in UI with three actions: **rebase** (auto if patches commute on disjoint entity sets), **abandon**, **fork** (new designId, full history copied).
- Other sessions of the same design receive forward patches over WS and apply them locally without re-fetching the projection (eventually consistent within a few hundred ms).

Snapshots:

- Server periodically (`every N=200 commands` or daily) materializes a projection snapshot to `design_snapshots` for fast cold-load. Client cold-load: GET latest snapshot + tail of command log since `snapshot.revision`.
- Snapshot format mirrors the existing `SchematicProjection` + PCB JSON-entity payloads.

Out-of-scope v1: real-time concurrent typing on the same entity, OT, CRDT. Two editors hitting the same field cause one to receive `REVISION_CONFLICT`. UX shows the loser a one-click rebase if their patches don't overlap.

---

## 7. Presence & collaboration UX

Per-design WebSocket carries presence frames:

```ts
type PresenceFrame =
  | { kind: "join"; sessionId; userId; displayName; color; viewerOnly }
  | { kind: "leave"; sessionId }
  | {
      kind: "cursor";
      sessionId;
      sheet: "schematic" | "pcb";
      xNm: number;
      yNm: number;
    }
  | { kind: "viewport"; sessionId; bboxNm: [x0, y0, x1, y1] }
  | { kind: "selection"; sessionId; entityIds: string[] }
  | { kind: "typing-comment"; sessionId; threadId };
```

Presence is **ephemeral** — never persisted; in-memory pubsub keyed by designId.

Comments (Phase 2):

- Anchored to entity ids (`partId`, `wireId`, `padId`, `traceId`, `regionXY`).
- Thread = root comment + replies; resolved/unresolved state.
- `@mention` sends in-app notifications (and optional email digest).
- Survives entity deletion as orphan threads with last-known anchor.

---

## 8. Public component library

Authoritative versioned catalog. Mirrors today's `library_*` tables but every published row is **immutable** and **SemVer-versioned**.

Server schema (sketch):

- `pub_component` — id, slug (`@vendor/part-mpn`), owner_user_id, current_version_id, status (`draft`/`review`/`published`/`deprecated`).
- `pub_component_version` — component_id, version (semver), symbol_payload_json, footprint_payload_json (default), pin_map_json, tags, MPN, manufacturer, package, license, submitted_at, reviewed_by, published_at.
- `pub_footprint`, `pub_symbol` (separately publishable / referenceable).
- `pub_model_asset` — versioned 3D model object key, sha256, tessellation params.
- `pub_review` — version_id, reviewer_id, decision, notes.

Submission flow:

1. User forks a draft from `library_components`, edits in desktop app.
2. POST `/v1/pub/components/{slug}/versions` with payload (symbol + footprint + 3D model upload via signed URL).
3. Automated validation: schema, DRC/ERC sanity, naming, license metadata.
4. Manual review by curators (queue endpoint `/v1/pub/review/queue`).
5. On approval → `status=published`, immutable.

Search:

- Full-text on name/MPN/manufacturer/tags (Postgres `tsvector`).
- Filters: package, pin count, footprint family, manufacturer, JLCPCB/LCSC part number cross-refs.
- Public read endpoints CDN-cacheable; `ETag` per version.

License metadata required on every published asset (CC-BY / CC0 / proprietary-redistributable).

---

## 9. Core library sync

The server hosts the **authoritative core library** (today's `builtin:resistor`, `builtin:capacitor`, future built-ins).

- Channels: `stable`, `beta`. Desktop installs subscribe to a channel.
- Distribution: signed JSON bundle (ed25519) at `/v1/core-lib/{channel}/latest` + `/v1/core-lib/versions/{version}`. Includes manifest hash, all component/footprint/symbol payloads, 3D asset object keys + sha256.
- Desktop behavior:
  - On first online launch: download latest snapshot, write to local `library_*` tables marked `isBuiltin=true`, `source=core@{version}`.
  - On subsequent launches: HEAD against `latest`; if newer, fetch delta (`?since={version}`) and apply transactionally.
  - Offline: keep last snapshot, fully usable.
- Source of truth lives in a separate `core-library` admin module on the server; promotion `beta → stable` is a curated operation.

Migrates today's `src/modules/library/backend/builtins/seed.ts` from hard-coded seeding to server-pulled bootstrap with local fallback.

---

## 10. Asset storage

S3-compatible object storage (AWS S3, Cloudflare R2, MinIO for self-host).

- Buckets: `assets-3d/`, `assets-images/`, `assets-exports/`, `design-snapshots/`, `core-lib/`.
- Upload: server issues **pre-signed PUT URLs**; client uploads directly. After upload, client POSTs metadata; server verifies content hash + size + MIME.
- Download: signed GET URLs (TTL ≤ 1h) for private; permanent public URLs (versioned key path) for published library + core lib.
- Quotas enforced at upload-init time (see §17).
- Deduplication: address by sha256; multiple references share one underlying object.

---

## 11. Server data model (Postgres)

Top-level tables (full schema deferred to migration files). All ids are ULIDs unless noted.

```
user(id, email UNIQUE, display_name, avatar_url, status, created_at, updated_at)
user_identity(user_id FK, provider, subject, is_primary, created_at, PRIMARY KEY (provider, subject))
session(id, user_id FK, refresh_hash, device_label, user_agent, ip_hash, last_seen_at, expires_at, revoked_at)
api_token(id, user_id FK, name, prefix, secret_hash, scopes JSONB, expires_at, last_used_at, created_at)

workspace(id, owner_user_id FK, slug UNIQUE, kind, settings JSONB)
project(id, workspace_id FK, name, visibility, settings JSONB)        -- Phase 2
project_member(project_id FK, user_id FK, role, PRIMARY KEY)          -- Phase 2

design(id, workspace_id FK, project_id FK NULL, name, revision INT, schema_version, created_at, updated_at)
design_command(command_id PK, design_id FK, session_id, user_id FK, applied_revision INT, command_type, command_json JSONB, result_json JSONB, forward_patches JSONB, inverse_patches JSONB, issued_at, applied_at)
design_snapshot(design_id FK, revision INT, projection_json JSONB | object_key, created_at, PRIMARY KEY (design_id, revision))
design_session_history(design_id FK, session_id, undo_json JSONB, redo_json JSONB, updated_at)
design_share(id, design_id FK, role, token_hash, expires_at, revoked_at, created_by FK)
comment_thread(id, design_id FK, anchor_kind, anchor_id, status, created_at) -- Phase 2
comment(id, thread_id FK, author_id FK, body_md, created_at)

pub_component / pub_component_version / pub_footprint / pub_symbol / pub_model_asset / pub_review (see §8)
core_lib_release(id, channel, version, manifest_json, signature, published_at)

asset(id, owner_workspace_id FK, kind, object_key UNIQUE, sha256, size, mime, created_at)
audit_log(id, actor_user_id FK, action, resource_type, resource_id, metadata JSONB, ip_hash, created_at)
```

Partitioning:

- `design_command` partitioned by hashed `design_id` (16 partitions) for write throughput.
- `audit_log` time-partitioned monthly.

Indexes:

- `design_command(design_id, applied_revision)` UNIQUE — guards revision linearity per design.
- `design_command(command_id)` UNIQUE — idempotency.
- GIN on `design_command.command_json` for diagnostics.
- Full-text GIN on `pub_component_version(tags, name, mpn)`.

Client SQLite is **retained unchanged**; cloud is additive. Client sync state lives in new local tables: `cloud_account`, `cloud_design_link(designId, remoteId, lastSyncedRevision)`, `outbound_commands`.

---

## 12. API surface

All under `/v1/`. Versioned; never break v1 after GA.

REST (representative):

```
POST   /v1/auth/password              login
POST   /v1/auth/oauth/{provider}/start
GET    /v1/auth/oauth/{provider}/callback
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/password-reset/{request,confirm}
POST   /v1/auth/email/{verify,resend}

GET    /v1/me
GET    /v1/me/sessions
DELETE /v1/me/sessions/{id}
POST   /v1/me/api-tokens
DELETE /v1/me/api-tokens/{id}

GET    /v1/workspaces/{id}/designs
POST   /v1/workspaces/{id}/designs
GET    /v1/designs/{id}
PATCH  /v1/designs/{id}                 -- name, settings only
DELETE /v1/designs/{id}
POST   /v1/designs/{id}/commands        -- CommandEnvelope; returns CommandResult
GET    /v1/designs/{id}/snapshot/latest
GET    /v1/designs/{id}/commands?sinceRevision=
POST   /v1/designs/{id}/shares
DELETE /v1/designs/{id}/shares/{token}

POST   /v1/assets/sign-upload
POST   /v1/assets/{id}/commit

GET    /v1/pub/components?q=&package=&manufacturer=
GET    /v1/pub/components/{slug}
GET    /v1/pub/components/{slug}/versions/{version}
POST   /v1/pub/components/{slug}/versions
POST   /v1/pub/review/{version_id}/decision

GET    /v1/core-lib/{channel}/latest
GET    /v1/core-lib/versions/{version}

GET    /v1/health
GET    /v1/.well-known/jwks.json
```

WebSocket:

```
wss://…/v1/designs/{id}/stream     -- commands applied, presence, comments
wss://…/v1/notifications/stream    -- per-user mentions, share accepted, etc.
```

Errors: **RFC 7807 problem-details** (same convention as `src/core/backend/contracts/`), type URIs prefixed `https://openpcb.dev/problems/`.

Pagination: cursor-based (`?cursor=&limit=`), `Link` header.

---

## 13. Module–server boundary

The server reuses today's module system (`src/core/backend/modules/module-loader.ts`). Each module may declare an optional `cloud.ts` alongside `backend.ts`:

```ts
// src/modules/designer/cloud.ts
export const cloudModule: CloudModuleDefinition = {
  id: "designer",
  registerRoutes(router, ctx) {
    /* /v1/designs/* … */
  },
  registerWebSocket(ws, ctx) {
    /* /v1/designs/{id}/stream */
  },
  registerJobs(scheduler, ctx) {
    /* snapshot materializer … */
  },
};
```

Layer rules (same as today):

```
server/   → core/server + sdks/cloud-* + shared/
modules/* → sdks/ + shared/ + (cloud.ts adds cloud-side handlers)
```

Core server stays business-logic-free. SDKs (`@sdks/library`, `@sdks/designer`) gain cloud-facing facades but no implementations.

Codegen: extend `npm run sdk:generate` to emit cloud SDK clients alongside today's local SDKs, sharing types.

---

## 14. Conflict resolution policy

v1 (matches existing `COMMAND_PATTERN.md`):

- **Reject on revision mismatch** with structured payload:

  ```ts
  type RevisionConflict = {
    code: "REVISION_CONFLICT";
    currentRevision: number;
    rejectedBase: number;
    conflictingCommandIds: string[]; // commands applied since rejectedBase
    overlappingEntityIds: string[]; // entities touched by both
  };
  ```

- Client UX:
  - **Auto-rebase** if `overlappingEntityIds === []` — replay locally on top of `currentRevision`, transparent to user.
  - **Manual resolve** if overlap — show diff modal: "discard mine / discard theirs / fork".
  - **Fork** copies design + history to new id under same workspace.

v2+ (Phase 5): introduce CRDT for non-structural metadata first (design name, notes, comment bodies). Structural ECS migration to CRDT is research-scope.

---

## 15. Versioning & history

- Full `design_command` log retained indefinitely on hosted SaaS; configurable retention for self-host.
- **Named snapshots / releases**: user marks a revision with a tag (`v0.1`, `prototype-A`). Server stores reference + materializes a permanent projection snapshot.
- Time-travel read: GET projection `?at=revision=N` or `?at=tag=foo` — read-only.
- Branching: **Phase 5**. Model under consideration: each branch is a new aggregate with a `forked_from(design_id, revision)` link; merge tooling for non-overlapping changes.

---

## 16. Privacy, security, encryption

v1:

- TLS 1.3 everywhere; HSTS preload.
- At-rest encryption on Postgres + object storage (managed-key on SaaS; admin-key on self-host).
- Secrets in keychain (Electron) / OS credential store (CLI).
- Per-user session list with device labels + revoke.
- Audit log on every authz-sensitive action.
- CSRF: JWT in `Authorization` header only; no cookie sessions for browser SDK except auth flow (SameSite=Strict + double-submit token).
- IP/UA hashed (HMAC w/ rotating secret) for analytics; never raw.
- Account deletion: 30-day grace, then hard-delete (cascade) except audit_log (retained per compliance setting).

Phase 5 — E2E encryption (E2EE):

- Per-project keypair (X25519); per-design symmetric key wrapped per member.
- Server stores `design_command.command_json` and `design_snapshot.projection_json` as ciphertext.
- Disables: server-side search inside design, server-side previews, server-side ERC/DRC (must run client-side), comments-in-design (separate plaintext channel optional).
- Design choices kept E2EE-compatible: command payloads are opaque to non-projection code paths; library lookup stays plaintext.

Compliance: GDPR DSR endpoints (`/v1/me/export`, `/v1/me/delete`). SOC2 trajectory tracked separately.

---

## 17. Quotas & limits

Tier names only; concrete numbers set at GA.

| Quota                             | Free     | Pro  | Team (Phase 2) | Enterprise (Phase 3) |
| --------------------------------- | -------- | ---- | -------------- | -------------------- |
| Active designs                    | low      | high | high           | unlimited            |
| Asset storage GB                  | low      | mid  | high           | custom               |
| Public library publishes / month  | very low | mid  | mid            | custom               |
| Concurrent WS sessions per design | 2        | 5    | 25             | custom               |
| Commands per minute per user      | low      | high | high           | custom               |
| Command log retention             | 30d      | 1y   | 1y             | custom               |
| SSO/SAML                          | —        | —    | —              | ✓                    |
| Audit log export                  | —        | ✓    | ✓              | ✓                    |

Enforcement points:

- Pre-flight: upload-init, design-create.
- In-flight: token-bucket on `POST /v1/designs/{id}/commands`.
- Background: storage GC for over-quota workspaces after grace.

Self-host single-tenant: quotas are "off" by default (only operational caps remain).

---

## 18. Telemetry & diagnostics

- Sentry already wired in renderer + main (`electron/src/main/sentry.ts`); SaaS server adds backend Sentry.
- Opt-in **anonymous usage metrics**: feature use counters, time-in-tool, never design payloads. Explicit toggle in settings.
- Crash dumps user-controlled: client already exposes `openCrashDumpsFolder()`.
- Source maps continue to flow via `npm run release:sourcemaps`.
- Server-side: structured JSON logs (same shape as `src/core/backend/logging/`), ring-buffer diagnostics endpoint behind admin auth.

---

## 19. Migrations & schema evolution

- Server uses the same per-module SQL migrations pattern as today (`src/modules/*/backend/migrations/*.sql`), driven by a server `module-migrator`.
- Client desktop migrations unchanged; new local-only tables added under `cloud_*` prefix.
- **API versioning**: URL `/v1/`; bumps only on breaking changes. Additive fields tolerated within v1.
- **Client compatibility matrix**: each desktop release advertises `clientApiVersion` + `minServerApiVersion` headers. Server responds with `Deprecation` / `Sunset` headers when downlevel.
- **Command schema evolution**: each `command_type` carries a `version`. Server rejects unknown versions with a structured error; client triggers self-update flow.
- Downtime-free rollouts: blue/green; long-running snapshot rematerialization runs as background job.

---

## 20. Open-source / self-host considerations

- **License: AGPL-3.0** for the server. Network-use clause forces SaaS forks to publish modifications. Aligns with comparable self-hostable cloud tooling.
- **Desktop license**: unchanged (decide separately, but AGPL or MIT both compatible).
- **Reference deployment**: Docker Compose with services `server`, `postgres`, `minio`, `caddy` (TLS), `worker` (snapshot/jobs).
- **Single-binary mode**: Bun-compiled binary + embedded migrations for tiny self-host setups (SQLite mode possible later, but Postgres is canonical).
- **Build flags / env**:
  - `OPENPCB_MULTI_TENANT=true|false`
  - `OPENPCB_PUBLIC_REGISTRATION=true|false`
  - `OPENPCB_BILLING=stripe|none`
  - `OPENPCB_TELEMETRY=true|false`
- Hosted SaaS and self-host ship from the **same source tree**; differences are runtime config, not code forks.

---

## 21. Roadmap phasing

- **Phase 1 — Foundations (cloud sync)**
  - Auth: email+password, GitHub, Google. Sessions, refresh, PKCE for Electron.
  - Personal workspace.
  - Design CRUD, command dispatch over HTTPS, idempotency, snapshots.
  - Asset storage with pre-signed URLs.
  - Offline queue + auto-rebase for non-overlapping conflicts.
  - Self-host Docker Compose reference.

- **Phase 2 — Collaboration**
  - Orgs/workspaces/projects, RBAC, invites.
  - WebSocket per-design channel: applied commands + presence + cursors + viewports + selection.
  - Comment threads anchored to entities.
  - Core-library sync channel (server-hosted, signed bundles).
  - In-app notifications + email digests.

- **Phase 3 — Public library + enterprise**
  - Public component catalog: submission, review, search, JLCPCB/LCSC cross-refs.
  - SSO/SAML/OIDC.
  - Billing + quota enforcement.
  - Admin tooling (workspace transfers, abuse reports).

- **Phase 4 — Versioning & marketplace foundations**
  - Named snapshots / releases.
  - Time-travel read.
  - Paid marketplace foundations (creator accounts, payouts integration).
  - Advanced search (parametric, manufacturer APIs).

- **Phase 5 — Advanced**
  - E2E encryption for private projects (with feature-degradation UX).
  - Git-style branching + merge tooling.
  - CRDT exploration for non-structural fields (design name, notes, comment bodies).
  - Real-time concurrent editing R&D.

---

## 22. Open questions

1. Paid marketplace (Phase 4 vs Phase 5) — when do creator payouts + revenue split land?
2. Branching/merge model in Phase 5 — fork-then-three-way-merge vs explicit named branches with linear merges?
3. CRDT scope in Phase 5 — fields-only (Yjs/Automerge on metadata) or full structural ECS migration?
4. Self-host: is SQLite ever supported server-side (single-tenant only, Litestream replication), or is Postgres required from day 1?
5. Hosted region split — single region at GA, or multi-region with data residency from day 1?
6. Plugin marketplace (hinted in `docs/PROPOSED_ARCHITECTURE.md` Q4) — does it fold into the public library, or get its own catalog?
7. Manufacturer integrations (JLCPCB/LCSC quoting API) — first-party in cloud, or client-only?
