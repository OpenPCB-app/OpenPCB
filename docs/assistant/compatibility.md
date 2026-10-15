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

## Route ownership

Every route the assistant module registers, with its owner and the guard that runs before any body
read or handler. `agentkit-http-routes.node.ts` (run by `agentkit-http-native.test.ts`) records what the
assistant module definition's `registerRoutes` registers, requires this table to match exactly, and
sends hostile-Origin, foreign-Host, wrong-token and missing-token requests to each route, plus a
malformed and an oversized body without a token (still `401`). It also asserts the tasks module
definition registers no HTTP routes; its monitor is `GET /v1/runs` below. The MCP endpoint is the one
exception to body-after-credential order: it keeps the shared 1 MiB / valid-JSON body guard (`413` /
`400`) ahead of its own bearer check, and no handler work runs either way. The owner column is derived
from the AgentKit REST contract, so the check catches registration drift, not a misclassified owner. Legacy, encoded and alternate prefixes (`/api/assistant`, `/assistant`,
`/api/tasks`, `/tasks`) hit the same prefix guard (`local-api-security.test.ts`). An idempotency-key
reuse with a different payload is refused with `422` (`idempotency_key_mismatch`), not `409`: the key
names one immutable request, so a changed body is an unprocessable request rather than a conflict
with current state, as in the IETF Idempotency-Key draft.

<!-- route-ownership:start -->
| Method | Path | Owner | Guard |
| --- | --- | --- | --- |
| GET | `/api/modules/assistant/availability` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| DELETE | `/api/modules/assistant/mcp` | AgentKit MCP server adapter | Host + Origin, own MCP bearer (app token ignored) |
| GET | `/api/modules/assistant/mcp` | AgentKit MCP server adapter | Host + Origin, own MCP bearer (app token ignored) |
| POST | `/api/modules/assistant/mcp` | AgentKit MCP server adapter | Host + Origin, own MCP bearer (app token ignored) |
| GET | `/api/modules/assistant/prompt-presets` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/providers` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/providers` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| DELETE | `/api/modules/assistant/providers/:id` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/providers/:id` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PATCH | `/api/modules/assistant/providers/:id` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PUT | `/api/modules/assistant/providers/:id` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/providers/:id/capabilities` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/providers/:id/capabilities/refresh` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/providers/:id/models` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/providers/:id/models/refresh` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/providers/:id/test` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/providers/:id/tool-calling` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PUT | `/api/modules/assistant/providers/:id/tool-calling` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/settings` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PATCH | `/api/modules/assistant/settings` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PUT | `/api/modules/assistant/settings` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats` | AgentKit REST `listChats` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/chats` | AgentKit REST `createChat` | Host + Origin + app token, before body or handler |
| DELETE | `/api/modules/assistant/v1/chats/:chatId` | AgentKit REST `deleteChat` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId` | AgentKit REST `getChat` | Host + Origin + app token, before body or handler |
| PATCH | `/api/modules/assistant/v1/chats/:chatId` | AgentKit REST `updateChat` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId/context-bindings` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/chats/:chatId/context-bindings` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| DELETE | `/api/modules/assistant/v1/chats/:chatId/context-bindings/:bindingId` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/chats/:chatId/fork` | AgentKit REST `forkChat` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId/messages` | AgentKit REST `listMessages` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/chats/:chatId/messages` | OpenPCB adapter over AgentKit `submitMessage` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/chats/:chatId/messages/:messageId/regenerate` | OpenPCB adapter over AgentKit `regenerateMessage` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId/native-write-allowances` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| DELETE | `/api/modules/assistant/v1/chats/:chatId/native-write-allowances/:key` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId/proposals` | AgentKit REST `listProposals` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId/tool-events` | AgentKit REST `listToolEvents` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/chats/:chatId/tools` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/messages/:messageId/activate` | AgentKit REST `activateBranch` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/messages/:messageId/siblings` | AgentKit REST `listSiblings` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/prompt-presets` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/proposals/:proposalId/allow-session` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/proposals/:proposalId/apply` | AgentKit REST `applyProposal` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/proposals/:proposalId/approve` | AgentKit REST `approveProposal` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/proposals/:proposalId/presentation` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/proposals/:proposalId/reject` | AgentKit REST `rejectProposal` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/providers` | OpenPCB adapter over AgentKit `listProviders` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/providers` | OpenPCB adapter over AgentKit `createProvider` | Host + Origin + app token, before body or handler |
| DELETE | `/api/modules/assistant/v1/providers/:providerId` | OpenPCB adapter over AgentKit `deleteProvider` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/providers/:providerId` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PATCH | `/api/modules/assistant/v1/providers/:providerId` | OpenPCB adapter over AgentKit `updateProvider` | Host + Origin + app token, before body or handler |
| PUT | `/api/modules/assistant/v1/providers/:providerId` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/providers/:providerId/capabilities` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/providers/:providerId/capabilities/refresh` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/providers/:providerId/models` | OpenPCB adapter over AgentKit `listModels` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/providers/:providerId/models/refresh` | OpenPCB adapter over AgentKit `refreshProviderModels` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/providers/:providerId/test` | OpenPCB adapter over AgentKit `testProvider` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/providers/:providerId/tool-calling` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| PUT | `/api/modules/assistant/v1/providers/:providerId/tool-calling` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/runs` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/runs/:runId` | AgentKit REST `getRun` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/runs/:runId/cancel` | AgentKit REST `cancelRun` | Host + Origin + app token, before body or handler |
| POST | `/api/modules/assistant/v1/runs/:runId/resume` | AgentKit REST `resumeRun` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/runs/:runId/stream` | AgentKit REST `streamRun` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/search` | AgentKit REST `searchMessages` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/settings` | OpenPCB adapter over AgentKit `getSettings` | Host + Origin + app token, before body or handler |
| PATCH | `/api/modules/assistant/v1/settings` | OpenPCB adapter over AgentKit `updateSettings` | Host + Origin + app token, before body or handler |
| PUT | `/api/modules/assistant/v1/settings` | OpenPCB app adapter | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/tools` | AgentKit REST `listTools` | Host + Origin + app token, before body or handler |
| GET | `/api/modules/assistant/v1/version` | AgentKit REST `getVersion` | Host + Origin + app token, before body or handler |
<!-- route-ownership:end -->

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
