# Desktop assistant compatibility

OPENPCB-122/123 replaces the generic desktop assistant/task engines with one AgentKit composition.
The ownership boundary is [architecture](architecture.md); operational requirements and exact
candidate provenance are [AgentKit runtime](agentkit-runtime.md). This is a code-coupled record of
current behavior, not a claim of production publication or packaged qualification.

## Runtime and contracts

The default backend activates [`agentkit-service.ts`](../../src/modules/assistant/backend/agentkit-service.ts)
on Node or Electron. The legacy RunService, AssistantService, ConversationStore, generic task queue,
old MCP server/session wrappers, cloud run/plan proxy and cloud-only code generator are removed.
Historical SQL migrations/tables remain inert; no old history or task is imported or resumed.

The app's domain DTOs live in `src/sdks/assistant`; generic DTOs come from `agentkit/contracts`.
`@openpcb/contracts` is a domain-only `1.0.0-candidate.0` breaking candidate. Its historical package
versions retain their old APIs; unrelated shared consumers must deliberately choose their migration.
The app dependency graph excludes `@openpcb/ai-core`, including transitive runtime edges.

The lockfile pins local reviewed AgentKit `0.6.0` and domain-contract candidates. The production
release policy remains unset and distribution is blocked by OPENPCB-124. Exact archive hashes,
canonical pack provenance and the published-pin gate are recorded in [runtime](agentkit-runtime.md)
and the vendor READMEs. Do not label these candidates as published releases.

## Retained surfaces

| Surface | Current owner and behavior | Evidence |
| --- | --- | --- |
| Chat/tree/history | AgentKit conversations and authenticated app HTTP; canonical branch/message/event identities and idempotent submission | `agentkit-http-native.test.ts`, `test:agentkit-host`, mounted conversation tests |
| Provider preferences | App defaults, endpoint/model selection, five compatible API-key/local kinds, discovery/probes, effective `auto/on/off` tool capabilities | `agentkit-provider-http.test.ts`, provider vault tests, catalog transport test |
| Credential custody | Trusted vault writes and opaque immutable references; rotation/deletion cannot change admitted work; stale probe commits refused | `assistant-provider-credentials.test.ts`, host tests, renderer boundary tests |
| Prompts/mentions/knowledge | App presets and source expansion through the canonical context provider; selected submission preset remains pinned while queued | Real HTTP context and queued-prompt tests |
| Native tools | Same 15 native names and exact historical input schemas; registered framework validation before native dispatch | `assistant-parity-catalog.test.ts`, native adapter tests |
| Place/move/wire/update | Real Designer IDs, revisions, connectivity, per-operation receipts and Undo/Redo | `test:assistant-parity`, native/domain recovery tests |
| Approvals/partial writes | Native actor/design/revision/fingerprint guards; destructive intent pending; unresolved placement pending until explicit partial approval | Real HTTP, native adapter/MCP and parity tests |
| Definition of Done | Four domain checks; missing bound snapshots fail honestly; framework owns bounded correction/shrink/stall behavior | DoD/compiler tests, real HTTP scenarios, host tests |
| Stop/Continue/recovery | Canonical cancel/resume, cumulative budgets and manual recovery; boot never initiates inference or repeats domain writes | Host, real HTTP crash/domain recovery and parity tests |
| Tasks | Visible paged monitor over the same canonical DB, maximum 50 rows/page, chat links, meaningful empty/errors, lifecycle actions | `tasks-monitor.test.ts`, mounted Tasks tests, HTTP paging test |
| Renderer stream | Canonical React client, durable replay cursor, lost-response retry identity, remount and selected-chat isolation | Mounted conversation transport tests and isolated browser harness |
| MCP | Public AgentKit protocol adapter; actual catalog, prompts, concrete resource reads, live actor isolation, native guarded writes; no inference surface | `native-mcp.test.ts`, catalog fixture |

The app provider DTO and SQLite rows have no persisted custom-header field. Historical extra headers
were transient managed-cloud attribution, not ordinary API-key/local settings. The desktop host
excludes that managed-cloud path and does not add a persisted header feature.

## Intentional retirement and gaps

Desktop managed-cloud provider seeding, paid Copilot orchestration, remote plan editing/resume,
wallet routes and remote tool execution are retired. Tests specific to those removed engines are
retired with them; unrelated cloud libraries/features remain separate. OpenAI/OpenRouter API-key
providers remain ordinary compatible transports and are not managed OpenPCB Cloud.

The old generic TasksSDK executor-registration/enqueue/event-bus API is removed. Its replacement
is a narrow monitor SDK with paged reads and canonical Stop/Continue. There is no duplicate queue,
history importer or custom restart scheduler.

The scoped backend retirement removes 13 test files with 150 explicit `test()`/`it()` declarations:
73 exercise the removed desktop cloud client/context/token/frame/remote-tool engine, and 77 exercise
the removed generic runtime/module/MCP wrappers or duplicate legacy parity harness. These are source
declaration counts, not a historical executed-suite total or a claim of one-for-one replacement.
Retained domain and authority behavior runs through the canonical fixtures listed above. The seven
Node retirement parity cases specifically preserve empty completion, tool-prose refusal, actual
command effects, duplicate calls, partial approval and Stop/reopen. Vault, DoD, native command and
new canonical HTTP/MCP tests remain active. Frontend cloud-only fixtures retire with their views.

MCP reconnect no longer trusts a reusable client header as conversation authority. Each transport
session has a separate generated actor scope. The accepted public AgentKit resource extension
supports concrete resources but has no template-list advertisement hook; the current catalog marks
that gap explicitly. Four prompt definitions/bodies and five concrete resource types remain covered.

No public Responses transport is present in the accepted FOUNDATION candidate. SIWC Responses and
identity/distribution remain separate fail-closed work. No automatic paid fallback is introduced.

## Run the checks

```sh
npm run test:agentkit-host
npm run test:assistant-parity
bun test src/core/backend/tests/assistant-parity-catalog.test.ts src/core/backend/tests/assistant-provider-credentials.test.ts src/core/backend/tests/assistant-dod-verifier.test.ts src/core/backend/tests/tasks-monitor.test.ts
bun scripts/assistant-parity-snapshot.ts --check
npm run gen
npx tsc --project src/core/backend/tsconfig.json --noEmit
npx tsc --project tsconfig.modules.json --noEmit
npm ls @openpcb/ai-core --all
node --test scripts/check-agentkit-distribution.test.mjs
```

Node/Electron host tests open real separate SQLite stores and use controlled provider streams and
vault doubles. Bun domain tests use real library import and native command paths. The historical
catalog remains immutable; only the reviewed current catalog is regenerated.

Passing these checks does not certify real endpoint/model quality, electrical/manufacturing
correctness, packaged native GUI Undo, OS-vault persistence or Windows/Linux behavior. Candidate
publication and production packaging are still blocked until reviewed published pins and independent
release gates pass. Live paid traffic is not part of these synthetic compatibility fixtures.
