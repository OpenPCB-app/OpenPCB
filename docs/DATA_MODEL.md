# Designer Data Model

This document describes the **current standalone designer data model** implemented in the new `core/` foundation.

It documents **what exists now in code**, not the older `src-ts` / `src-react` model and not the future fully-integrated module architecture.

Primary implementation roots:

- `core/backend/designer`
- `core/frontend/designer`

This document focuses on:

- canonical backend state
- entity/component structure
- revision metadata
- sheet/net model
- persistence records and ports
- projection/read model shape
- frontend cache/session contracts that depend on the data model
- known limitations and gaps

---

## 1. Goals

The current data model exists to provide a **standalone, backend-canonical, command-driven schematic foundation** that future code can build on.

Main goals:

- keep **canonical mutable state** in backend memory/storage, not in frontend stores
- represent design state as a **small ECS-like world**
- support **command-based mutation** with revision checks
- support **derived topology** such as nets from geometry + pins
- support **projection-based reads** for frontend consumers
- keep persistence **abstracted behind ports**
- keep frontend state **explicitly stale-aware**, not falsely authoritative

This is intentionally schematic-first. PCB data model is not implemented here yet.

---

## 2. Scope

### Included

- backend `DesignWorld`
- design head and revision metadata
- entity kinds and component payloads
- net entities and net membership
- projection contracts
- persistence record types
- persistence ports and in-memory adapters
- frontend cache/session contracts that depend on revisioned projection data

### Excluded

- old `src-ts` / `src-react` documents and APIs
- app integration, routing, HTTP server wiring, Electron wiring
- PCB entity model and PCB commands
- auth, workspace, project ownership enforcement
- component library persistence and synchronization beyond embedded snapshots
- multi-user collaboration protocol

---

## 3. Big picture

The model is split into 4 layers.

### 3.1 Canonical backend world

File:

- `core/backend/designer/domain/design-world.ts`

Canonical mutable state is held in:

```ts
interface DesignWorld {
  head: DesignHeadState;
  entities: Map<EntityId, DesignEntity>;
  netMembers: NetMemberRef[];
}
```

This is the source of truth during command execution.

### 3.2 Persistence rows

Files:

- `core/backend/designer/persistence/records/design-head.record.ts`
- `core/backend/designer/persistence/records/design-entity.record.ts`
- `core/backend/designer/persistence/records/design-net-member.record.ts`
- `core/backend/designer/persistence/records/design-command-log.record.ts`

These are persisted shapes for head state, entities, net membership, and command history.

### 3.3 Read projection

Files:

- `core/backend/designer/contracts/projection.ts`
- `core/backend/designer/domain/projections/build-schematic-projection.ts`
- `core/backend/designer/application/get-schematic-projection.usecase.ts`

Frontend does not read raw entities directly. It reads a simplified `SchematicProjection`.

### 3.4 Frontend cache/session state

Files:

- `core/frontend/designer/state/design-cache.state.ts`
- `core/frontend/designer/state/selection.state.ts`
- `core/frontend/designer/state/schematic-session.state.ts`
- `core/frontend/designer/state/pending-command.state.ts`

Frontend keeps:

- cached projection
- known/stale revision markers
- UI-only selection/session state
- pending command tracking

---

## 4. Folder and file map

## 4.1 Backend contracts

### Base contracts

- `core/backend/designer/contracts/ids.ts`
  - branded-ish primitive ids used across model and commands
- `core/backend/designer/contracts/units.ts`
  - unit constants, currently schematic nm helpers
- `core/backend/designer/contracts/geometry.ts`
  - `PointNm`, `RotationDeg`, point key helpers
- `core/backend/designer/contracts/revision.ts`
  - revision primitive and conflict shape
- `core/backend/designer/contracts/errors.ts`
  - domain-level errors used by handlers/use cases

### Entity/component contracts

- `core/backend/designer/contracts/entity-kind.ts`
  - allowed entity kinds
- `core/backend/designer/contracts/component-kind.ts`
  - allowed component kinds
- `core/backend/designer/contracts/component-map.ts`
  - component-name -> payload-type map
- `core/backend/designer/contracts/entity.ts`
  - `DesignEntity` and sparse component bag type

### Component payload files

- `contracts/components/sheet-meta.ts`
- `contracts/components/sheet-ref.ts`
- `contracts/components/transform-2d.ts`
- `contracts/components/part-origin-ref.ts`
- `contracts/components/symbol-snapshot.ts`
- `contracts/components/footprint-snapshot.ts`
- `contracts/components/instance-fields.ts`
- `contracts/components/wire-geometry.ts`
- `contracts/components/wire-end-hints.ts`
- `contracts/components/wire-net-ref.ts`
- `contracts/components/net-meta.ts`

### Mutation/projection/event contracts

- `core/backend/designer/contracts/patch.ts`
  - internal patch language + `NetMemberRef`
- `core/backend/designer/contracts/projection.ts`
  - `SchematicProjection` read model
- `core/backend/designer/contracts/event.ts`
  - `DesignInvalidatedEvent`

### Command contracts

- `core/backend/designer/contracts/commands/command-envelope.ts`
  - command union + outer envelope
- `core/backend/designer/contracts/commands/place-part.command.ts`
- `core/backend/designer/contracts/commands/move-entities.command.ts`
- `core/backend/designer/contracts/commands/delete-entities.command.ts`
- `core/backend/designer/contracts/commands/set-part-value.command.ts`
- `core/backend/designer/contracts/commands/create-wire.command.ts`
- `core/backend/designer/contracts/commands/command-result.ts`

## 4.2 Backend domain

- `domain/design-world.ts`
  - canonical in-memory aggregate
- `domain/invariants.ts`
  - entity and geometry validation
- `domain/entity-selectors.ts`
  - entity lookup, sheet checks, pin validation, pin world-position helpers

### Patches

- `domain/patches/apply-patches.ts`
  - mutates world from patch list
- `domain/patches/invert-patches.ts`
  - computes inverse patches relative to pre-apply world
- `domain/patches/stamp-patches.ts`
  - stamps `createdRevision` / `updatedRevision`
- `domain/patches/patch-builder.ts`
  - small helper constructors

### Commands and systems

- `domain/commands/command-handler.ts`
- `domain/commands/command-registry.ts`
- `domain/commands/command-bus.ts`
- `domain/commands/create-default-command-registry.ts`
- `domain/commands/handlers/place-part.handler.ts`
- `domain/commands/handlers/move-entities.handler.ts`
- `domain/commands/handlers/delete-entities.handler.ts`
- `domain/commands/handlers/set-part-value.handler.ts`
- `domain/commands/handlers/create-wire.handler.ts`

### Derived systems

- `domain/systems/reference-allocator.ts`
  - allocates references like `R1`, `U1`
- `domain/systems/wire-normalizer.ts`
  - grid-snap + geometry cleanup
- `domain/systems/net-rebuild-system.ts`
  - derives nets and net memberships from current world topology

### History and projection

- `domain/history/history-entry.ts`
- `domain/history/undo-session-registry.ts`
- `domain/projections/build-schematic-projection.ts`

## 4.3 Backend application layer

- `application/dispatch-command.usecase.ts`
  - main write path
- `application/undo.usecase.ts`
  - per-session undo
- `application/redo.usecase.ts`
  - per-session redo
- `application/get-schematic-projection.usecase.ts`
  - query path for frontend read model
- `application/world-persistence.mapper.ts`
  - world <-> record mapping
- `application/create-in-memory-foundation.ts`
  - standalone in-memory composition root

## 4.4 Backend persistence

### Records

- `persistence/records/design-head.record.ts`
- `persistence/records/design-entity.record.ts`
- `persistence/records/design-net-member.record.ts`
- `persistence/records/design-command-log.record.ts`

### Ports

- `persistence/ports/clock.ts`
- `persistence/ports/id-generator.ts`
- `persistence/ports/event-publisher.ts`
- `persistence/ports/transaction-runner.ts`
- `persistence/ports/design-head.repository.ts`
- `persistence/ports/design-entity.repository.ts`
- `persistence/ports/design-net-member.repository.ts`
- `persistence/ports/design-command-log.repository.ts`

### In-memory adapters

- `persistence/memory/in-memory-transaction-runner.ts`
- `persistence/memory/in-memory-design-head.repository.ts`
- `persistence/memory/in-memory-design-entity.repository.ts`
- `persistence/memory/in-memory-design-net-member.repository.ts`
- `persistence/memory/in-memory-design-command-log.repository.ts`
- `persistence/memory/in-memory-event-publisher.ts`

## 4.5 Frontend relevant files

### Ports

- `core/frontend/designer/ports/command-transport.ts`
- `core/frontend/designer/ports/query-transport.ts`
- `core/frontend/designer/ports/event-stream.ts`

### State

- `core/frontend/designer/state/design-cache.state.ts`
- `core/frontend/designer/state/pending-command.state.ts`
- `core/frontend/designer/state/selection.state.ts`
- `core/frontend/designer/state/schematic-session.state.ts`

### Runtime

- `core/frontend/designer/runtime/designer-client.ts`
- `core/frontend/designer/runtime/dispatch-command.ts`
- `core/frontend/designer/runtime/reconcile-command-result.ts`
- `core/frontend/designer/runtime/reconcile-event.ts`
- `core/frontend/designer/runtime/in-memory-transports.ts`
- `core/frontend/designer/runtime/create-in-memory-designer-client.ts`

### Tests

- `core/backend/designer/tests/integration/designer-foundation.test.ts`
- `core/frontend/designer/tests/runtime-reconcile.test.ts`

---

## 5. Canonical backend model

## 5.1 `DesignWorld`

File:

- `core/backend/designer/domain/design-world.ts`

Current shape:

```ts
interface DesignWorld {
  head: DesignHeadState;
  entities: Map<EntityId, DesignEntity>;
  netMembers: NetMemberRef[];
}
```

This is the canonical in-memory world used during command handling and projection building.

### Responsibilities

- hold design-global revision and counters
- hold all canonical entities
- hold derived net membership edges
- act as the mutation target for patch application

### Important note

The current persistence strategy loads and rewrites the whole design world at once. This is simple and explicit, but not incremental.

## 5.2 `DesignHeadState`

File:

- `core/backend/designer/domain/design-world.ts`

Current shape:

```ts
interface DesignHeadState {
  designId: DesignId;
  revision: Revision;
  nextAutoNetOrdinals: Record<string, number>;
  referenceCounters: Record<string, number>;
}
```

### Field semantics

- `designId`
  - owning design id
- `revision`
  - current global revision of canonical state
- `nextAutoNetOrdinals`
  - next auto net sequence per sheet id
  - drives names like `N$1`, `N$2`
- `referenceCounters`
  - reference counters per prefix, e.g. `R -> 2`, `U -> 4`

### Current behavior

- first created world bootstraps one root sheet and initializes `nextAutoNetOrdinals` for that sheet
- normal command dispatch mutates head directly in memory, then persists head record
- head is not currently maintained through a first-class head-patch-only workflow in normal dispatch

## 5.3 `DesignEntity`

File:

- `core/backend/designer/contracts/entity.ts`

Current shape:

```ts
interface DesignEntity {
  id: EntityId;
  designId: DesignId;
  kind: EntityKind;
  createdRevision: Revision;
  updatedRevision: Revision;
  components: ComponentBag;
}
```

### Meaning of fields

- `id`
  - stable entity identity
- `designId`
  - owning design
- `kind`
  - one of `sheet | part_instance | wire | net`
- `createdRevision`
  - revision that originally created the entity
- `updatedRevision`
  - last revision that changed the entity or its components
- `components`
  - sparse typed bag keyed by component kind

### Style of modeling

This is **ECS-like**, not a fully generic ECS engine.

It uses:

- stable entity ids
- explicit entity kind
- typed component payloads
- sparse component storage

It does **not** use:

- generic archetype systems
- fully generic query DSL
- per-component relational persistence tables

---

## 6. Entity kinds and components

## 6.1 Entity kinds

Defined in:

- `core/backend/designer/contracts/entity-kind.ts`

Current kinds:

- `sheet`
- `part_instance`
- `wire`
- `net`

No label entity exists yet.

## 6.2 `sheet`

### Required components

- `sheet_meta`

### Forbidden/absent assumptions

- sheet does **not** require `sheet_ref`

### Role

- logical sheet root entity
- scope owner for parts, wires, and nets
- source for projection sheet list

### Current behavior

- system auto-creates one root sheet on first design creation:
  - `id = sheet-root`
  - `title = Sheet 1`
  - `index = 0`
- deleting sheet entities is currently rejected by command logic

## 6.3 `part_instance`

### Required components

- `sheet_ref`
- `transform_2d`
- `part_origin_ref`
- `symbol_snapshot`
- `instance_fields`

### Optional components

- `footprint_snapshot`

### Role

- canonical placed schematic part
- carries both source identity and frozen symbol representation needed for standalone operation

### Why both origin and snapshot exist

- `part_origin_ref` points back to library/source identity
- `symbol_snapshot` preserves render/connectivity-critical information even if source data changes later

## 6.4 `wire`

### Required components

- `sheet_ref`
- `wire_geometry`

### Optional components

- `wire_end_hints`
- `wire_net_ref`

### Role

- canonical schematic conductor polyline
- may carry optional endpoint hints to connected part pins
- receives derived `wire_net_ref` after net rebuild

## 6.5 `net`

### Required components

- `sheet_ref`
- `net_meta`

### Role

- derived, first-class electrical connectivity group
- persists sheet-scoped auto name and ordinal
- not directly edited by users/commands in current implementation

---

## 7. Component catalog

Defined in:

- `core/backend/designer/contracts/component-kind.ts`
- `core/backend/designer/contracts/component-map.ts`

## 7.1 `sheet_meta`

File:

- `contracts/components/sheet-meta.ts`

Shape:

- `title`
- `index`
- optional `pageSettings.widthNm`
- optional `pageSettings.heightNm`

Current use:

- title and index projected to frontend
- page settings reserved but not used elsewhere

## 7.2 `sheet_ref`

File:

- `contracts/components/sheet-ref.ts`

Shape:

- `sheetId`

Meaning:

- every non-sheet schematic entity belongs to exactly one sheet id

## 7.3 `transform_2d`

File:

- `contracts/components/transform-2d.ts`

Shape:

- `xNm`
- `yNm`
- `rotationDeg`
- `mirrored`

Used by:

- part placement projection
- pin world-position calculation during net rebuild

## 7.4 `part_origin_ref`

File:

- `contracts/components/part-origin-ref.ts`

Shape:

- `componentId`
- `variantId`
- optional `footprintOptionId`

Meaning:

- stable external origin for placed part instance

## 7.5 `symbol_snapshot`

File:

- `contracts/components/symbol-snapshot.ts`

Important fields:

- `symbolKind`
- `referencePrefix`
- optional `bodyBounds`
- optional `graphics`
- `pins[]`
- optional `sourceHash`

Important pin fields:

- `originPinKey`
- optional `number`
- `name`
- `localPosition`

### Why this matters

The command/data model depends on `symbol_snapshot.pins` for connectivity.

`originPinKey` is the stable pin identity used in:

- `wire_end_hints`
- net membership rows
- pin existence checks

## 7.6 `footprint_snapshot`

File:

- `contracts/components/footprint-snapshot.ts`

Current fields:

- `footprintOptionId`
- optional `footprintName`
- optional `sourceHash`
- optional `padCount`

Current status:

- present in schema
- stored optionally on part instance
- not used by current projection or net logic

## 7.7 `instance_fields`

File:

- `contracts/components/instance-fields.ts`

Fields:

- `reference`
- `value`
- `properties`

Current note:

- explicit duplicate reference rejection is enforced at placement time
- current rule is **global design-wide uniqueness** across all part instances

## 7.8 `wire_geometry`

File:

- `contracts/components/wire-geometry.ts`

Fields:

- `pointsNm: PointNm[]`

Geometry assumptions today:

- minimum 2 points
- points normalized by command handler before write
- no guarantee yet that geometry is orthogonal-only, but code is written with schematic orthogonal expectations in mind

## 7.9 `wire_end_hints`

File:

- `contracts/components/wire-end-hints.ts`

Fields:

- `startPinRef?`
- `endPinRef?`

Each `PinRef` contains:

- `partInstanceId`
- `originPinKey`

Current role:

- validated on wire creation
- used by deletion logic to safely cascade delete attached wires when a part is removed
- not the primary source of net derivation

## 7.10 `wire_net_ref`

File:

- `contracts/components/wire-net-ref.ts`

Fields:

- `netId`

Current role:

- derived by net rebuild
- projected to frontend wires

## 7.11 `net_meta`

File:

- `contracts/components/net-meta.ts`

Fields:

- `stableName`
- `namingSource: "auto"`
- `ordinal`

Current role:

- persisted identity metadata for derived net entities

---

## 8. Invariants

Main invariant code:

- `core/backend/designer/domain/invariants.ts`
- `core/backend/designer/domain/entity-selectors.ts`

## 8.1 Entity invariants

Current enforced rules:

- every entity must have non-empty id
- every non-sheet entity must have `sheet_ref`
- `part_instance` must contain:
  - `transform_2d`
  - `part_origin_ref`
  - `symbol_snapshot`
  - `instance_fields`
- part transform `xNm` and `yNm` must be finite
- part rotation must be one of `0 | 90 | 180 | 270`
- `wire` must contain `wire_geometry` with at least 2 points
- every wire point coordinate must be finite
- `net` must contain `net_meta`

## 8.2 Command-level invariants

### `place_part`

- entity id must be new
- target sheet must exist and be of kind `sheet`
- x/y must be finite
- rotation must be orthogonal
- reference must be unique
- symbol snapshot pin keys must be unique

### `create_wire`

- entity id must be new
- target sheet must exist
- all incoming points must be finite
- optional pin refs must exist on same sheet
- normalized wire must still have >= 2 points
- if start/end pin refs exist, they must match first/last wire point after normalization

### `move_entities`

- non-empty entity id list
- finite delta coordinates

### `delete_entities`

- deleting sheet entities is rejected

## 8.3 Selector-level invariants

Files:

- `domain/entity-selectors.ts`

Helpers enforce:

- required entity lookup
- required sheet lookup
- pin ref exists on referenced part
- pin ref belongs to same sheet
- pin world position computed from transform + snapshot pin local position

## 8.4 Important not-yet-enforced invariants

Still missing today:

- no deep schema validation for `graphics` / optional snapshot payloads
- no strict validation that entity `designId` matches world head design id
- no validation that sheet indices/titles are unique
- no validation that wire geometry is orthogonal-only
- no validation that `properties` payloads follow a specific schema
- no persistent enforcement that `wire_end_hints` remain accurate after future edits

---

## 9. Sheet model

Current sheet model is **entity-only**.

There is no separate `design_sheet` persistence concept in the new standalone core.

### Current behavior

- when a new design world is created, one default root sheet entity is inserted automatically
- current constants live in `dispatch-command.usecase.ts`
  - `DEFAULT_SHEET_ID = "sheet-root"`
- projected sheet list comes only from actual `sheet` entities
- all parts, wires, and nets are sheet-scoped through `sheet_ref`

### Current limitations

- no `create_sheet` command
- no `delete_sheet` command
- no sheet reorder command
- no hierarchical sheets
- no cross-sheet connectivity semantics
- effectively only one sheet is usable today, although the contracts are multi-sheet-shaped
- root sheet is currently a bootstrap convention, not yet a fully user-managed sheet lifecycle

---

## 10. Net model

Main files:

- `core/backend/designer/contracts/components/net-meta.ts`
- `core/backend/designer/contracts/patch.ts`
- `core/backend/designer/domain/systems/net-rebuild-system.ts`
- `core/backend/designer/persistence/records/design-net-member.record.ts`

## 10.1 What a net is

In the current system, a net is:

- a **derived entity** of kind `net`
- scoped to one sheet
- rebuilt from world topology after topology-changing commands
- represented by:
  - a `net` entity with `sheet_ref` + `net_meta`
  - `wire_net_ref` on participating wires
  - `netMembers` entries for wires and part pins

## 10.2 Net source of truth

Connectivity is currently derived from:

- wire geometry
- part pin world positions from `symbol_snapshot + transform_2d`

It is **not** derived from:

- labels
- explicit user-authored net assignment
- buses
- hierarchical ports

`wire_end_hints` are not the main source of connectivity. They are creation/deletion helper metadata only.

## 10.3 Net rebuild algorithm

Implemented in:

- `domain/systems/net-rebuild-system.ts`

High-level process:

1. create a union-find set of wire nodes and pin nodes
2. compute part pin world positions with rotation + mirroring + translation
3. connect pin node to wire node if pin lies on any wire segment on same sheet
4. connect two wires if an endpoint of one lies on a segment of the other on same sheet
5. gather connectivity groups
6. for each group with at least one wire:
   - reuse an existing net if member overlap suggests continuity
   - otherwise allocate a new auto net id/name
7. update net entities
8. update wire `wire_net_ref`
9. fully replace `netMembers`

## 10.4 Net identity reuse

The system now tries to preserve net identity.

Mechanism:

- previous net membership is turned into member keys
- new group member keys are scored against previous nets
- best overlapping old net on same sheet is reused
- if no suitable old net exists, a new net id is allocated

This helps keep:

- net ids stable
- `stableName` stable
- ordinals stable

across some topology-preserving edits.

## 10.5 Auto-net naming

Current auto net names:

- `N$1`, `N$2`, ...

Important detail:

- ordinals are **sheet-scoped** via `head.nextAutoNetOrdinals[sheetId]`

## 10.6 Net membership structure

Defined in:

- `contracts/patch.ts`

Shape:

```ts
interface NetMemberRef {
  netId: EntityId;
  memberEntityId: EntityId;
  memberKind: "wire" | "part_pin";
  pinKey?: string;
}
```

Current usage:

- wire member -> wire entity id only
- part pin member -> part entity id + `pinKey`

## 10.7 Current net limitations

Important known gaps:

- no labels or named nets
- no global nets
- no hierarchical/off-sheet ports
- no buses
- no explicit junction entity
- coincident pins with no wire between them do **not** create a net in the current algorithm
- plain segment crossing without endpoint-on-segment participation is not considered a connection
- no incremental rebuild; full topology rebuild happens on topology-changing commands

---

## 11. Revision semantics

Relevant files:

- `contracts/revision.ts`
- `application/dispatch-command.usecase.ts`
- `application/undo.usecase.ts`
- `application/redo.usecase.ts`
- `domain/patches/stamp-patches.ts`

## 11.1 Global design revision

- one global revision per design head
- every accepted dispatch increments revision by exactly 1
- every accepted undo increments revision by exactly 1
- every accepted redo increments revision by exactly 1

## 11.2 `baseRevision`

Command envelopes carry:

- `baseRevision: number | null`

Current rules:

- if design already exists, `baseRevision` must be non-null and equal current head revision
- if design does not yet exist, `baseRevision` may be null
- mismatch returns `REVISION_CONFLICT`

## 11.3 `acceptedRevision` and `nextRevision`

Command success returns:

- `acceptedRevision`
- `nextRevision`

Semantics:

- `acceptedRevision` = world head revision before the command
- `nextRevision` = committed revision after command

## 11.4 Entity revision stamping

`stampPatchesForRevision()` ensures:

- new entity upserts get `createdRevision = nextRevision`
- existing entity upserts preserve old `createdRevision`
- all upserts get `updatedRevision = nextRevision`

`applyPatches()` also updates `updatedRevision` for component set/remove patches.

## 11.5 Undo/redo revision behavior

Undo/redo do not roll revision backward.

Instead:

- undo applies inverse semantic patches at a new revision
- redo reapplies forward semantic patches at a new revision

This means history is **monotonic by revision**, not reversible by decreasing revision numbers.

---

## 12. Projection model

Main files:

- `contracts/projection.ts`
- `domain/projections/build-schematic-projection.ts`

## 12.1 `SchematicProjection`

Current shape:

```ts
interface SchematicProjection {
  designId: DesignId;
  revision: Revision;
  sheets: SchematicProjectionSheet[];
  parts: SchematicProjectionPart[];
  wires: SchematicProjectionWire[];
  nets: SchematicProjectionNet[];
}
```

## 12.2 Why projection exists

Frontend does not consume raw `DesignEntity` bags.

Projection provides:

- stable frontend-facing shape
- narrower data surface
- explicit revisioned snapshot

## 12.3 Projection contents

### Sheets

- built from `sheet` entities
- sorted by `index`
- includes `id`, `title`, `index`

### Parts

- built from `part_instance`
- includes:
  - id
  - sheetId
  - componentId
  - variantId
  - reference
  - value
  - x/y position
  - rotation
  - mirrored
  - symbolKind

### Wires

- built from `wire`
- includes:
  - id
  - sheetId
  - pointsNm
  - optional `netId`

### Nets

- built from `net`
- includes:
  - id
  - sheetId
  - `name` from `net_meta.stableName`

## 12.4 Projection omissions

Projection intentionally does **not** include:

- full symbol snapshot pin data
- footprint snapshot
- instance `properties`
- entity `createdRevision` / `updatedRevision`
- `netMembers`
- optional page settings
- raw component bag

This is a read model, not a lossless serialization of canonical world.

---

## 13. Persistence model

## 13.1 Records

### `DesignHeadRecord`

File:

- `persistence/records/design-head.record.ts`

Fields:

- `designId`
- `revision`
- `nextAutoNetOrdinals`
- `referenceCounters`
- `createdAt`
- `updatedAt`

### `DesignEntityRecord`

File:

- `persistence/records/design-entity.record.ts`

Fields:

- `id`
- `designId`
- `kind`
- optional promoted columns:
  - `sheetId`
  - `reference`
  - `originComponentId`
  - `originVariantId`
- `createdRevision`
- `updatedRevision`
- `componentsJson`
- `createdAt`
- `updatedAt`

### `DesignNetMemberRecord`

File:

- `persistence/records/design-net-member.record.ts`

Fields:

- `netId`
- `memberEntityId`
- `memberKind`
- optional `pinKey`

### `DesignCommandLogRecord`

File:

- `persistence/records/design-command-log.record.ts`

Fields:

- `commandId`
- `designId`
- `sessionId`
- `baseRevision`
- `nextRevision`
- `commandType`
- `commandPayload`
- `forwardPatches`
- `inversePatches`
- `affectedEntityIds`
- `createdAt`

## 13.2 Persistence strategy

Current standalone strategy is **whole-design replacement**.

On successful dispatch/undo/redo:

- head is upserted
- all entity rows for design are replaced
- all net member rows for design are replaced
- command log row is appended

This is simple and deterministic, but not optimized.

## 13.3 Persistence mappers

File:

- `application/world-persistence.mapper.ts`

Responsibilities:

- convert head record -> head state
- convert head state -> head record
- convert entity record -> entity
- convert entity -> entity record
- preserve `createdAt` when entity already existed
- convert `NetMemberRef` -> persistence row
- build command log rows

## 13.4 Ports

Current port files:

- `persistence/ports/design-head.repository.ts`
- `persistence/ports/design-entity.repository.ts`
- `persistence/ports/design-net-member.repository.ts`
- `persistence/ports/design-command-log.repository.ts`
- `persistence/ports/event-publisher.ts`
- `persistence/ports/transaction-runner.ts`
- `persistence/ports/id-generator.ts`
- `persistence/ports/clock.ts`

## 13.5 In-memory adapters

Current in-memory adapters:

- clone on read/write to avoid accidental reference sharing
- transaction runner is pass-through
- command log repo indexes by command id and design id
- event publisher stores event list and supports live subscribers

---

## 14. Frontend data-model-facing state

## 14.1 `DesignCacheState`

File:

- `core/frontend/designer/state/design-cache.state.ts`

Current shape:

- `designId: string | null`
- `projection: SchematicProjection | null`
- `knownRevision: number | null`
- `staleRevision: number | null`
- `status: idle | loading | ready | stale | conflict | error`
- `pendingInvalidated: Array<"schematic" | "nets">`
- `conflictServerRevision: number | null`
- `error: string | null`

### Meaning

- `projection`
  - last successfully loaded projection
- `knownRevision`
  - newest revision client knows exists
- `staleRevision`
  - revision newer than cached projection that requires refetch
- `status`
  - explicit cache lifecycle
- `pendingInvalidated`
  - coarse invalidation domains waiting to be refreshed

## 14.2 Projection load helpers

Same file defines:

- `createInitialDesignCacheState()`
- `beginProjectionLoad()`
- `completeProjectionLoad()`
- `failProjectionLoad()`

Important behavior:

- if a loaded projection revision is behind already-known stale revision, state remains `stale`
- a late load therefore does not incorrectly claim freshness

## 14.3 Pending command state

File:

- `core/frontend/designer/state/pending-command.state.ts`

Tracks in-flight operations by command id.

Each pending entry stores:

- `commandId`
- optional `designId`
- `issuedAt`
- `operation: dispatch | undo | redo`
- optional `envelope`

## 14.4 UI-only state

Files:

- `selection.state.ts`
- `schematic-session.state.ts`

These are **not canonical model**. They are future frontend-only state.

They currently hold:

- selected ids
- active tool
- placement preview
- wire preview
- viewport

---

## 15. Frontend transport and runtime model

## 15.1 Ports

Files:

- `ports/command-transport.ts`
- `ports/query-transport.ts`
- `ports/event-stream.ts`

These abstract:

- dispatch / undo / redo
- projection query
- invalidation subscription from optional starting revision

## 15.2 Runtime client

File:

- `runtime/designer-client.ts`

Thin facade around transport ports.

## 15.3 Command result reconciliation

File:

- `runtime/reconcile-command-result.ts`

Important current rule:

- frontend does **not** apply `forwardPatches` to local projection
- on successful command it marks cache:
  - `knownRevision = nextRevision`
  - `staleRevision = nextRevision`
  - `status = stale`

This is deliberate. Backend remains authoritative.

## 15.4 Event reconciliation

File:

- `runtime/reconcile-event.ts`

For matching active design:

- bump `knownRevision`
- bump `staleRevision`
- merge invalidated domains
- mark `stale` unless already `loading`

## 15.5 In-memory event stream

File:

- `runtime/in-memory-transports.ts`

Current behavior:

- replays stored events with `revision > fromRevision`
- then subscribes to future live events from in-memory publisher

Important note:

- this is a standalone/test transport helper, not a production-grade event transport

---

## 16. Tests and what they verify

## 16.1 Backend integration tests

File:

- `core/backend/designer/tests/integration/designer-foundation.test.ts`

Current coverage verifies:

- default root sheet bootstrap
- first part placement
- auto reference allocation
- placing part onto existing wire keeps same net id
- duplicate provided reference rejection
- `createdRevision` / `updatedRevision` semantics
- `createdAt` preservation on entity update
- existing design rejects `baseRevision: null`
- wire endpoint pin hints must match geometry endpoints
- undo/redo monotonic revisions and projection changes

## 16.2 Frontend runtime tests

File:

- `core/frontend/designer/tests/runtime-reconcile.test.ts`

Current coverage verifies:

- successful command marks cache stale instead of mutating projection locally
- invalidation event marks active design stale and records invalidated domains

## 16.3 Important test gaps

Still worth adding later:

- command idempotency replay behavior
- cross-session undo/redo blocking
- richer multi-sheet tests once sheet commands exist
- more net split/merge topology tests
- wire crossing / T-junction edge cases
- event replay race tests
- cache stale-load / design switch race tests

---

## 17. Current limitations and known gaps

### Model coverage

- schematic only
- single root sheet behavior, despite multi-sheet-shaped contracts
- no net labels, no buses, no hierarchical sheets, no explicit junction entities
- no user-authored net naming yet

### Validation gaps

- some optional snapshot payloads are structurally loose
- no deep schema enforcement for arbitrary `properties` or `graphics`
- no strict world-wide validation pass over all entities before persistence

### Net model gaps

- plain segment crossing without endpoint participation is not a connection
- no label/global-net semantics
- no incremental net rebuild yet

### Persistence/runtime gaps

- whole-design replace persistence
- in-memory undo stacks only
- no durable event stream
- no real transactional isolation in in-memory runner

### Frontend gaps

- returned forward patches are not applied client-side
- frontend currently uses invalidate/refetch semantics only
- no full query sync state machine around navigation and load token management yet

### Reserved-but-not-fully-used fields

- `createDesignIfMissing` exists on command envelope but is not yet consumed by standalone backend logic
- `footprint_snapshot` exists but is not used by current projection or topology logic
- `pageSettings` exists but is not consumed by current projection/runtime

---

## 18. Recommended next steps for developers

If building on top of the current data model, recommended order is:

1. add `create_sheet` command and explicit sheet lifecycle
2. add richer net topology tests before adding labels/junctions
3. add real persistence implementation with compare-and-swap on head revision
4. decide whether frontend stays invalidate/refetch or starts applying `forwardPatches`
5. add schema validation for optional snapshot payloads
6. extend projection only after canonical entity/component fields are stable

---

## 19. Summary

The current standalone designer data model is a **backend-canonical, typed, ECS-like schematic world**.

Core properties:

- entities are sparse component bags
- mutations go through commands
- topology-derived nets are rebuilt, persisted, and projected
- revisions are global and monotonic
- frontend treats projection as a cache, not authority

It is already concrete enough to extend, but it is still intentionally narrow and schematic-first.
