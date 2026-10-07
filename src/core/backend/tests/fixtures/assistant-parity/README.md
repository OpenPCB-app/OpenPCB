# Desktop assistant parity fixtures

These fixtures support OPENPCB-112. They compare executable desktop behavior without a paid
provider, network inference, application database, or system keychain. They are not packaged
macOS qualification and do not certify electrical or manufacturing correctness.

## Run

From the repository root:

```sh
bun test src/core/backend/tests/assistant-parity-catalog.test.ts src/core/backend/tests/assistant-parity-native.test.ts src/core/backend/tests/assistant-parity-lifecycle.test.ts
bun scripts/assistant-parity-snapshot.ts --check
```

The tests create and remove an isolated temporary SQLite directory. Production migrations,
library import, LibrarySDK, DesignerSDK, TasksSDK, RunService, the native tool registry, and the
authenticated MCP endpoint execute normally. Only provider responses and credential storage are
test doubles. The credential store is an in-memory implementation of the trusted-process port;
it never opens the user's OS vault. Provider environment keys are excluded from fixture seeding.

The library fixture is imported through the real KiCad parser and commit path. Its files were
copied from `@openpcb/kicad-parsers/tests/__fixtures__/simple_capacitor.kicad_sym` and
`C_0603_1608Metric.kicad_mod` installed at the initial baseline. There is no bundled CoreLibrary
bootstrap in this harness. This isolates domain parity from the separate OPENPCB-50 trust gate
without weakening signature checks.

## Contract snapshots

`catalog.json` preserves the legacy baseline captured at OpenPCB
`798f9fdc7d0018f081f2a27f3fa2bc9d96f8e2c4`, before the credential migration. Its SHA-256 is
`e752f2a9a5c28beaff7d8d213e6c9371012906831f2ad8f6eb50cd7d4a381b40`.

`catalog.current.json` records the reviewed current database migration, including
`0015_provider_secret_refs.sql`. Its SHA-256 is
`a64bdf2045794bd54b250887d6b6af2c4d42e16355e9681b0a41723325aefb01`.
The tests compare the entire current snapshot and separately require the native tool/MCP
contracts to match the preserved legacy snapshot.

The snapshots capture actual public provider presets, registered tool definitions and JSON
Schemas, authenticated MCP tools/list in both write modes, resource templates, prompt definitions
and prompt bodies, SQLite DDL, and applied migration names. They contain no chat rows, provider
credential rows, environment endpoint values, tokens, user design IDs, or application database
contents. Counts are derived: 15 in-app tools, 14 read-only MCP tools, 22 write-enabled MCP tools,
and 47 tables across the isolated library/designer/tasks/assistant schema. These counts describe
this capture, not an independent contract. Knowledge and other application schemas are excluded.

Regenerate only after reviewing an intentional contract change:

```sh
bun scripts/assistant-parity-snapshot.ts --write
```

This updates only `catalog.current.json`; it never overwrites the legacy snapshot. Object keys
are sorted before hashing. Array order is preserved unless the catalog itself defines an
unordered collection, such as tools listed by name.

## Domain and lifecycle assertions

| Fixture | Executable assertions |
| --- | --- |
| Inspect/explain | Real connectivity reaches provider history; part IDs match the domain; revision and undo history do not change. Prose is not an oracle. |
| Bounded place/move/wire/update | Two capacitors produce revision 2; move produces 3; wire plus automatic arrange produces 5; value update produces 6; undo produces 7. UUIDs stay stable, the wire joins real pin IDs, and undo/redo restore domain state. |
| Destructive reject/approve | Deletion stays pending without mutation even when model arguments claim medium risk; rejection prevents apply; explicit approval deletes once; another apply is rejected; undo restores the deleted ID. |
| Stale approval and schema refusal | A changed revision blocks pending deletion before mutation; invalid placement quantity is refused by the registered schema before any proposal or undo entry exists. |
| Duplicate action | Both repeated submissions and repeated provider call IDs retain one committed action, one proposal, and unchanged revision/part count. |
| Unresolved placement | Missing component is exposed in model data and proposal; no edit occurs before explicit partial approval; the valid unit commits and can be undone. |
| Real partial command failure | A fixture proposal commits the first real update; the second real command returns `ENTITY_NOT_FOUND`; per-operation receipts are `applied`/`failed`; undo restores the first value. This proposal is explicitly constructed, not emitted by the fake provider. |
| Stop/reopen | Stop prevents later provider work and retains the committed edit. Chunks replay from an inclusive sequence cursor. Reopened SQLite retains messages, chunks, cancelled task, part ID, and usable undo history. |
| Provider compatibility | The actual compatible transport receives scripted SSE for all five installed API-key/local preset kinds. It preserves model, streaming, full native tool definitions, and completed tool-call arguments. No paid connection is tested. |
| MCP | Missing/wrong bearer is refused; write tools are unavailable in read mode; two client headers keep separate chats/design bindings; reconnect reuses the backing chat. |

## Known baseline limitations

- A placement proposal with an unresolved item remains pending. After explicit partial approval,
  the legacy proposal record says `applied` even though its original payload retains the skipped
  item. The fixture records this existing limitation; it does not classify it as migration success.
- The fixture's Stop/reopen test covers a terminal cancelled task. It does not prove crash-after-
  domain-commit receipt recovery, assistant publication atomicity, or interrupted-run resume.
- Argument fingerprints and tampered approvals, crash recovery, dock remount/SSE transport, native GUI
  undo, packaged Node storage, OS credential persistence, and SIWC remain separate gates.
- The manually composed test modules omit application bootstrap, bundled pack trust verification,
  module manifests/routes discovery, mention-provider registration, canvas rendering, and native
  Electron packaging. Existing compiler-live, DoD, MCP endpoint, and UI tests remain complementary.
- The fake provider does not prove live endpoint compatibility, model quality, account renewal,
  or professional EDA correctness. No Windows/Linux qualification is claimed.
