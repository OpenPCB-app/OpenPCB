# Designer command ordering and recovery

The Schematic and PCB editors share one command coordinator per backend/module scope. Each
design has an independent FIFO. A queued command retains its originating design, session and
immutable payload; a document switch cannot retarget it. The first command uses an observed
revision or reads the design head. Following commands use the previous acknowledged revision.
An external revision observation never silently rebases an in-flight queue.

## Transactions and history

Commands, command-log entries and session history commit in one SQLite transaction. HTTP and SDK
stores reload history from SQLite rather than maintaining independent caches. Undo and Redo apply
geometry and persist the consumed history entry in one transaction. Capture runs after commit.

Interactive Undo and Redo send `expectedRevision`. The backend checks it inside the transaction
before consuming an entry; a mismatch returns `REVISION_CONFLICT` without changing geometry or
history. SDK and HTTP callers may omit this field for compatibility, so callers outside the
interactive coordinator still require an audit. This check does not provide selective undo or
merge semantics for intervening changes from another session.

Multi-entity Schematic actions use `batch_commands`: one logical action, one revision and one
undo entry. Nested batches, placement requiring library resolution, view-state changes and
autolayout application are excluded. A late failing child rolls back the entire batch. Mixed
Schematic/PCB history sessions are refused. Display-only commands remain outside undo history;
the existing view-state command still advances the design revision.

## Failure and review

A rejected or uncertain write blocks subsequent writes in that design. The failed payload and
all later unsent edits remain visible. Refresh updates the projection without replaying edits.
An explicit confirmed action may reapply a verified revision conflict or an unsent command with
a new command ID against the refreshed head. Unknown transport outcomes cannot be reapplied
through this control: the original write may already have committed. Discard requires an explicit
confirmation and a successful refresh.

Retained edits survive navigation away from and back to the Designer in the same renderer.
Pending or retained edits request the native close guard. They are **not crash-durable** and do
not survive an approved close or renderer termination. Backend URL changes have separate scopes.

Projection and history reads use design identity and request generations. A late response from
an inactive design cannot replace the active document. PCB view debounce captures the originating
dispatcher, and acknowledgement of an older view edit cannot clear protection for a newer field.

## Regression coverage and limits

Schematic history keys use this same dispatcher: `Mod+Z` undoes, `Mod+Shift+Z` and `Ctrl+Y`
redo. `Mod` means Command on macOS and Control elsewhere. They require canvas focus, respect
the shared text/modal/repeat guard and history availability, and do not act during an unfinished
wire, marquee, drag, placement or comment gesture. Rejections remain visible through the normal
history error path; no automatic retry is introduced. Toolbar tooltips show platform shortcuts.

- `src/core/backend/tests/designer-command-ordering.test.ts`: HTTP/SDK history consistency,
  batch rollback, command ID/revision guards, forced history persistence failure and stale Undo/Redo.
- `src/modules/designer/frontend/hooks/useDesignerWorkspace.test.tsx`: delayed writes, independent
  design lanes, stale reads/callbacks, atomic batches, conflict review, repeated history activation
  and retained edits across module remounts.
- `src/modules/designer/frontend/pcb/pcb-view-persistence.test.ts`: outgoing document flush and
  overlapping field acknowledgements.
- `tests/e2e/electron-designer-hardening.spec.ts`: real native frontend/backend ordering, exact PCB
  hole coordinates, toolbar history, confirmed conflict recovery and delayed history conflicts.
- `tests/e2e/electron-designer-keyboard.spec.ts`: native schematic Undo/Redo, text-field isolation
  and active-placement protection (T-094 / OPENPCB-79).

Native results must identify the renderer dependency artifact. The published canvas dependency
still requests remote fonts when offline; the isolated H05 candidate passed these tests. These
checks do not qualify packaged releases, every inspector, physical footprint drag gestures,
crash recovery, all SDK consumers or the complete H07 acceptance matrix.
