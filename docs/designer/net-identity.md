# Net identity: storage, API and consumer contract

This document describes the current net-identity implementation. Identity tracks logical
schematic membership; it does not certify physical routing, electrical safety, IPC compliance,
fabricator capability or manufacturing output. The DRC view exposes identity status and explicit
reference repair; the contracts below also apply to API consumers.

## Identity and modes

A durable net ID has the form `net:<salt>:<sequence>`. The salt is the first 50 bits of SHA-256
of the design ID, encoded as 10 lowercase base32 characters. The sequence is a positive safe
integer. Its allocation watermark is the maximum of the stored next sequence and one greater
than every observed active or retired sequence. Migration also reserves own-design IDs found in
the raw backup, including decoded PCB and history JSON. Undo, restore and re-migration never
lower the watermark or recycle an issued ID.

Membership consists of stable, typed pin, wire, label and primitive IDs. Coordinates and display
names are not identity keys. A fresh component containing only one pin uses `nc:<pinId>` without
allocating a durable record. A current lone-pin ID is a valid authoring target. Read-only binding
can produce `pending:<n>` for a component requiring allocation; such IDs must never be persisted
as copper or rule references.

The backend resolves one of two modes before binding or consuming references:

| Mode | Meaning |
| --- | --- |
| `durable` | The validated stored identity state has status `active`. |
| `legacy` | State is absent, invalid, `migration_failed` or `legacy_restored`. Coordinate-derived roots and historical projection-time name binding remain a degraded compatibility path. |

Invalid state is retained as evidence. Reads do not replace it with fresh state. Automatic ensure
may migrate an unmigrated design, but does not repeatedly retry a failure from the current
migrator version or a deliberately restored legacy design. Use the explicit migration route to
retry. A status read itself never runs ensure.

## Reconciliation and display names

Exact membership keeps its ID. On a split, merge or larger reconfiguration, the shared identity
kernel matches old and new components by stable member overlap. For competing inheritance edges,
the deterministic order is:

1. A named predecessor outranks an automatically named predecessor. Explicit naming and a display
   override both count as named.
2. More retained pins, then more retained members, then more pins in the successor, then more
   pins in the predecessor.
3. More declared dependents, then the smaller numeric sequence, then stable ID and canonical
   membership order.

Each predecessor can survive in at most one successor, and each successor inherits at most one
predecessor. Other components receive new IDs. The dependency census counts physical declarations
once, includes disabled zones, and counts each affected length group, differential pair and rule
once. Array order and lexical ordering such as `:10` before `:9` do not decide the sequence tie.

Display naming is separate: schematic GND, power, portal and label names take precedence over a
retained override; otherwise the generated name is `Net_<sequence>`. Explicit names outrank
overrides, which outrank generated names when resolving case-insensitive display-name collisions.
Suffixes make displayed names unique without changing IDs. A rename, re-annotation or movement
that preserves schematic membership does not itself allocate another ID.

Moving a PCB placement is a different operation from changing schematic membership. Its logical
net IDs can remain stable while fixed trace geometry stops touching the moved pads. Stable identity
therefore does not promise that placement motion preserves routing. Physical connectivity still
comes from the [copper connectivity kernel](../pcb-hardening/01-connectivity-contract.md).

## Stored state and reference consumers

The identity tables are owned by the Designer backend:

| Table | Stored contract |
| --- | --- |
| `designer_net_identity_state` | Schema version, status, next sequence, active membership and naming records, provenance, last error. |
| `designer_net_identity_retired` | Retired IDs and sequences, reason, successor IDs, historical display name and retirement revision. |
| `designer_net_identity_quarantine` | Exact reference provenance, original ID or hint, reason, candidates and optional suggestion. |
| `designer_net_identity_backups` | Versioned raw migration snapshot, source revision, SHA-256 and creation time. |

The eight authored reference sites are traces, vias, free pads, zones, per-net class assignments,
length-group members, differential-pair members and DRC net scopes. A disabled zone is still a
declared reference and remains repairable, but it is inert for orphan blocking. Distinct pair
members and rule scopes remain distinct diagnostic sites.

In durable mode, PCB projections preserve stored references. Consumers must never substitute a
net by position, legacy root, a similar name or a stale display hint. An active ID wins over an
old hint. A null ID plus a blank or absent hint is unassigned; a nonblank hint alone is unresolved,
even when its text equals a live display name. Check map membership using own keys: inherited
properties such as `constructor` are not active nets or assignments.

Authoring boundaries validate non-null targets against current own-design durable or lone-pin
IDs. They return `NET_REFERENCE_DANGLING`, with an indexed field where appropriate, for retired,
unknown, foreign or provisional IDs. Zone authoring can resolve a unique current display name
using its documented trim/case normalization; multiple matches return `NET_REFERENCE_AMBIGUOUS`.
This boundary resolution is not permission for consumers to rebind persisted data. Imported
names use exact explicit-name matches; generated names, fuzzy matches and aliases supply no
automatic correspondence.

## Read-only status and blocking

The HTTP paths below are relative to `/api/modules/designer`:

| Method and path | Behavior |
| --- | --- |
| `GET /designs/:designId/net-identity` | Returns `DesignerNetIdentityStatus` in the standard success envelope. Reads revision and summary from one transaction, without migration, placement synchronization, default PCB rows or zone filling. |
| `GET /designs/:designId/projection/pcb` | The normal PCB projection includes `netIdentity`, a `DesignerNetIdentitySummary`. The broader projection path may ensure identity or synchronize PCB data; it is not a substitute for the read-only status route. |
| `POST /designs/:designId/net-identity/migrate` | Explicitly retries migration and returns the resulting status. An already active design remains active. Failure can be reported as a persisted status rather than an HTTP error. |
| `POST /designs/:designId/net-identity/restore-legacy` | Restores a validated legacy-migration backup; accepts the confirmation body described below. |

The summary exposes `status`, `mode`, `origin`, `lastError`, `historiesArchived`, `groups`,
`orphanedCopperCount`, `inertRuleReferenceCount` and `exportBlocked`. Status is `active`,
`migration_failed`, `legacy_restored` or `unmigrated`. Groups carry exact IDs or unresolved hints,
retirement/quarantine reason, successor and candidate IDs, a conservative suggestion, copper
anchors, disabled-zone IDs and rule sites. Suggestions are evidence for an explicit repair;
reading them changes nothing.

Durable summaries block when enabled orphan copper or inert rule references remain. Disabled
zones are listed but do not contribute to blocking counts. Legacy summaries block even with zero
reported reference counts; zero is not evidence that the design has qualified identity.

Batch DRC emits `NET_ORPHANED_COPPER` for each enabled physical kind/ID with an inactive ID or
unresolved name. It is an error in the `connectivity` class, cannot be downgraded, ignored or
waived, and keeps its violation ID when moved. The check reads raw projected declarations so
rejected zone geometry cannot hide an orphan. It is not part of live legality or its refusal set.

The manufacturing identity guard requires `netIdentity.exportBlocked === false`; an absent
summary fails closed. Its HTTP 422 problem type is
`https://openpcb.dev/problems/net-identity-unqualified`, with code `NET_IDENTITY_UNQUALIFIED`,
`identityStatus`/`mode`, blocking counts and up to 50 groups. The standard problem `status` remains
the numeric HTTP status. The independent manufacturing capability
quarantine runs first in normal export paths and remains unchanged; see
[CAPABILITY-QUARANTINE.md](../../src/modules/designer/backend/CAPABILITY-QUARANTINE.md).

## Migration and legacy restore

Migration captures the raw schematic rows, PCB entity rows and session histories before any
rewrite or legacy-fill conversion. The backup format is `openpcb.net-identity-backup/2`; opaque
JSON columns remain strings rather than normalized objects. Its hash, owning design, source
revision, full row columns and relations are validated. Provenance records the migration origin,
migrator version, before/after revisions, binding/quarantine counts and archived history count.

Legacy coordinate roots alone are insufficient proof of copper ownership. Migration combines
root correspondence with positive copper contact or eligible pour evidence, and handles exact
name evidence separately. Conflicts, shorts, ambiguous names and missing evidence retain their
original reference and quarantine provenance for review. Migration plans and validates reference
changes before writing; backup, fill conversion, rewriting, quarantine, history archival, revision
and active state commit together. Failed migrations retain source data and expose the failure.

Successful migration archives existing session histories in the backup, clears their live stacks
and advances revision once. It does not silently manufacture repair choices for every old ID.
Normal startup/read entry points may ensure migration; manual retry is the recovery mechanism
after a recorded failure or deliberate restore.

Restore requires active `legacy-migration` provenance and a matching validated backup. It replaces
the backed schematic, PCB and history rows, clears migration quarantine, records current durable
IDs as retired, retains the allocation watermark and sets status `legacy_restored`. The current
revision advances once rather than reverting to the backup revision.

If edits exist after the migration revision, the initial restore request returns HTTP 409 with
problem type `https://openpcb.dev/problems/net-identity-restore-discards-edits` and changes no rows.
Restoration discards those later edits. After explicit user confirmation, retry with:

```json
{ "confirmDiscardRevisions": true }
```

The confirmation must be boolean; malformed JSON/body fields return 400. Invalid restore state,
provenance or backup returns HTTP 422, code `NET_IDENTITY_RESTORE_INVALID`, problem type
`https://openpcb.dev/problems/net-identity-restore-invalid`. Confirmation does not bypass backup
or provenance validation.

## Explicit reference repair

Send the normal command envelope to `POST /designs/:designId/commands`, or dispatch through the
Designer SDK, with this command:

```typescript
{
  type: "pcb_rebind_net_references",
  bindings: [
    { fromNetId: "retired-or-foreign-id", toNetId: "current-net-id" },
    { fromNetId: null, fromNetName: " Exact stored hint ", toNetId: null }
  ]
}
```

Repair requires durable mode and 1..500 bindings with distinct sources. A non-null source must be
inactive and matches by ID alone. A null source requires a nonblank hint and matches the exact,
untrimmed, case-sensitive stored hint; a present non-null ID always wins over that hint. Targets
must be active or null. Malformed input returns `INVALID_PCB_BOARD_SETTINGS`; an invalid target
returns `NET_REFERENCE_DANGLING` with `field: "bindings[i].toNetId"`. Repair is forbidden inside
`batch_commands`, including a mixed batch with ordinary edits.

All bindings are evaluated against the original snapshot, without cascading one rewrite through
another. Effects are:

| Site | Non-null target | Null target |
| --- | --- | --- |
| Trace, via, free pad | Set `netId`; retain `netName` provenance. | Set both fields to null. |
| Zone, including disabled zones | Set `netId`; retain hint and enabled state. | Clear both fields and set `enabled: false`. |
| Per-net assignment | Re-key the source; an existing destination assignment wins. | Remove the source key. |
| Length group | Map members and deduplicate. | Remove members; remove the group if empty. |
| Differential pair | Map members; remove a collapsed self-pair. | Remove the pair if either member becomes null. |
| DRC net scope | Map members and deduplicate. | Remove the whole rule if any changed net scope becomes empty. |

When several source assignments map to an unassigned target, equal classes coalesce; different
classes refuse the entire command. This prevents an array-order winner from choosing a class.

Success includes the complete `netRebind` receipt:

```typescript
{
  traces: number, vias: number, zones: number, freePads: number,
  assignments: number, lengthGroups: number, diffPairs: number, drcRules: number,
  removedRules: string[], removedDiffPairs: string[], removedLengthGroups: string[],
  disabledZones: string[]
}
```

Counts describe changed physical rows or declarations once; assignments count affected source
keys. `disabledZones` lists every matched zone cleared, including one already disabled. An
unmatched source succeeds with zero counts, advances revision according to normal command policy,
and creates no undo entry. An idempotent retry returns the committed receipt before running ensure
or planning another mutation.

Repair patches original raw records, not typed copper/settings reconstructions. It preserves
unknown geometry and metadata, original hints on non-null bindings, array ordering, removed raw
declarations and absent-versus-null fields. The shared raw board serializer retains its schema
version policy. If parsing/re-encoding a numeric token would change its decimal value, repair
refuses before writing; it does not round opaque values, overflow them to null or underflow them
to zero.

Repair has a dedicated versioned raw-history carrier bound to its design and command. Copper
history stores only exact before/after reference slots; board history stores only the affected
top-level reference sections. It never enters generic combined-world replay. Undo and redo use
the normal history endpoints and may restore historically inactive references without reactivating
their identities or rerunning the authoring boundary.

Replay first validates every carrier, row identity and expected field value. A mismatch returns
HTTP 409, code `NET_REBIND_HISTORY_CONFLICT`, problem type
`https://openpcb.dev/problems/net-rebind-history-conflict`. Nothing is partially applied: dispatch
commits raw rows, revision, receipt and history together; replay commits raw rows, revision and
persisted history movement together.
Replay preserves current unrelated copper geometry and board/view settings, but conservatively
conflicts if another edit changed an affected board reference section. Allocation state and
retirement history are not changed by repair replay.

## Repair interface and observation

The DRC view shows identity status, exact unresolved sources, enabled and disabled copper counts,
inert rule references, candidates and successors. A suggestion is actionable only when its target
is an active persistent ID in the current PCB projection. Manual selection also uses IDs. A
non-null source ID remains authoritative; a null source retains its exact nonblank name hint.

Repair requires status, projection and command queue to agree on the design revision. Each action
uses one `pcb_rebind_net_references` command through the workspace coordinator and PCB history
session. Bulk actions reject more than 500 bindings instead of silently truncating or splitting
them. Dropping inert assignments excludes every group with copper, including disabled zones.

The panel retains the acknowledged revision and complete repair receipt before refreshing.
If a subsequent status, PCB projection or schematic read fails, it reports an applied change with
a refresh failure. Retry performs reads only. Explicit read-only refresh also recovers an initial
PCB read failure and observes newer server revisions without rehydrating a stale DRC report.
Existing workspace history refresh remains best-effort: a history-only read failure can disable
Undo/Redo without making the identity panel's refresh fail. The canvas may issue an additional
PCB read when its existing refresh token advances.

Activity and unread counts are scoped to the coordinator's backend and design. Opening the panel
marks that scope's activity read; the toolbar's net-change badge is separate from DRC severity.
Changing the design/backend or unmounting the panel invalidates pending observations and prevents
a delayed restore-conflict confirmation from issuing a second write to the old target. An already
issued request is not repeated or assumed cancelled.

## Merge confirmation and cloud compatibility

Naming edits require `confirmMerge: true` when they merge at least two named nets or two anonymous
multi-pin nets. Geometry edits require it for a merge of at least two named nets. The naming group
includes label/port edits and `update_primitive_text`; the geometry group includes part placement,
duplication, move/rotate/mirror, primitive movement/rotation, wire geometry and schematic arrangement.
Intentional `create_wire`/`create_wire_junction` commands keep their existing connection policy;
PCB footprint refresh does not alter schematic topology.

An unconfirmed merge returns `NET_MERGE_REQUIRES_CONFIRM` and rolls back the transaction. A retry
uses a fresh command ID and the same base revision. For a batch, set confirmation on its steps;
a flag on the batch wrapper has no effect. Mixed batches with an unconfirmed naming step use the
broader naming policy against the before/final topology.

The current cloud protocol does not preserve durable membership, allocation or retirement state.
Linking, snapshot pushing and mirroring therefore refuse transmission when any local identity
state row or retired row exists, including empty, restored or corrupt state. The guard reports
`CLOUD_NET_IDENTITY_UNSUPPORTED` and retains local data; pin-intent preservation has its own guard.
A peer version or a seeded net array is not proof of a lossless protocol.
