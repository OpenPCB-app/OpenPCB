# Desktop assistant parity fixtures

The fixtures retain historical native contracts and exercise the current AgentKit/domain boundary
without paid inference, the user's database or the OS keychain. They do not certify packaged GUI
behavior or electrical/manufacturing correctness.

## Run

```sh
bun test src/core/backend/tests/assistant-parity-catalog.test.ts
npm run test:assistant-parity
bun scripts/assistant-parity-snapshot.ts --check
```

`domain.ts` creates isolated real app migrations, LibrarySDK and DesignerSDK, imports a KiCad fixture
through the actual parser/commit path, and supplies domain context/tools. It does not create a legacy
queue or a production AgentKit host in Bun. The catalog uses a canonical in-memory store/proposal
service and actual MCP socket. `retirement.node.ts` reuses the checked-in Node HTTP/domain harness
with the real default app host, a separate AgentKit SQLite file, synthetic provider streams and an
in-memory vault. The Node runner bundles it into a fresh temporary directory and removes that
directory after execution.

The capacitor files came from the installed KiCad parser fixtures. Bundled CoreLibrary bootstrap
is excluded here so its independent trust gate is not bypassed. Legacy assistant/task migrations
remain present but their old runtime tables receive no active engine writes.

## Catalogs

`catalog.json` preserves the legacy capture at OpenPCB
`798f9fdc7d0018f081f2a27f3fa2bc9d96f8e2c4`, SHA-256
`e752f2a9a5c28beaff7d8d213e6c9371012906831f2ad8f6eb50cd7d4a381b40`.

`catalog.current.json` captures the reviewed canonical composition, SHA-256
`473f1eaf94f6eaaf0b3fd932b581bc97108edff789c6b1e831fe1453b025a438`.
It includes 15 native tools, 14 read-only and 22 write-enabled MCP tools, four prompts, five concrete
resource types and the current migrated SQLite DDL. The tests compare the complete current snapshot
and independently require every historical native name/input schema to remain unchanged.

AgentKit's accepted public resource extension has no resource-template listing hook. The current
capture records this explicit gap; it does not silently claim historical template advertisement.
Actual resource URI IDs are normalized to `{designId}`. Prompt bodies, real registered JSON schemas,
presets, migration names and DDL are captured without rows, credentials or application data.

After reviewing intentional contract drift:

```sh
bun scripts/assistant-parity-snapshot.ts --write
```

Only the current catalog is rewritten. Object keys are sorted; array order remains meaningful unless
the producing catalog defines an unordered collection. The script prints the current content hash
and derived counts.

## Executable behavior

The canonical Node parity suite covers an honest empty-response warning after one retry, successful
empty-response recovery, refusal to execute printed tool prose, real place/move/wire/value-update
IDs/revisions/connectivity with Undo/Redo, repeated tool-call deduplication, unresolved placement
pending until explicit partial approval, and terminal Stop/reopen with durable exclusive-cursor
replay and zero inference on boot.

Complementary real HTTP/native/MCP tests cover destructive reject/approve, stale and tampered
approval, schema refusal, per-operation partial failure, actor isolation, receipt recovery across
process death, bounded correction and knowledge/context inputs. Host tests cover immutable pinning,
replay conflicts, leases, shutdown, cumulative budgets and split-key redaction before persistence.
Mounted React tests cover canonical HTTP/SSE/remount/retry behavior; Tasks tests cover paged monitoring
and lifecycle delegation. Old cloud-only and implementation-specific engine fixtures are retired.

Fake transports do not prove live endpoint quality, OS credential persistence, native GUI Undo or
packaged Electron behavior. SIWC, published dependency pins and release trust are separate gates;
local candidate evidence never authorizes distribution.
