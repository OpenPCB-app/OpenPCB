# Desktop assistant compatibility contract

This document defines the legacy surfaces that must be preserved, adapted, or removed during the
AgentKit desktop migration. The executable baseline is the
[parity fixture suite](../../src/core/backend/tests/fixtures/assistant-parity/README.md), not the
older AgentKit migration playbook or a remembered tool count. The migration requirements are
OPENPCB-112–123; project progress, release provenance, approvals, and future work belong in Plane.

“Keep” preserves an OpenPCB capability and its owning domain implementation. “Adapt” changes its
orchestration, storage, transport, or DTO boundary while preserving the specified behavior.
“Remove” retires the legacy implementation or excludes a cloud-only surface from the desktop
profile after its replacement has passed integration checks. These decisions do not authorize
removing unrelated cloud services or resetting application data.

## Composition and active consumers

| Surface and source | Compatibility decision | Requirement |
| --- | --- | --- |
| [Assistant backend entry](../../src/modules/assistant/module.backend.ts), [activation](../../src/modules/assistant/backend/index.ts), and [AssistantService](../../src/modules/assistant/backend/assistant-service.ts) | Adapt activation to one app-owned AgentKit composition root. Replace generic conversation/submission orchestration, retain domain adapters and app preferences. | OPENPCB-116/123 |
| [Tasks backend entry](../../src/modules/tasks/module.backend.ts), [activation](../../src/modules/tasks/backend/index.ts), and [runtime singleton](../../src/modules/tasks/backend/runtime-singleton.ts) | Remove the legacy engine after all consumers move to the same AgentKit host. Do not leave a second queue for the monitor. | OPENPCB-123 |
| [Electron backend host](../../electron/src/main/backend-server.ts), [core runtime](../../src/core/backend/runtime.ts), and [static modules](../../src/core/backend/modules/static-modules.ts) | Keep the in-process Node backend and ephemeral loopback port. Adapt explicit host startup/shutdown and native SQLite packaging; no Bun sidecar. AgentKit uses its own `agentkit.sqlite`, never its schema manager against `openpcb.sqlite`. | OPENPCB-116 |
| [Assistant manifest](../../src/modules/assistant/manifest.json), [Tasks manifest](../../src/modules/tasks/manifest.json), and [generated module registry](../../src/core/frontend/src/generated/modules.ts) | Adapt the current required `assistant -> tasks` dependency, registrations, and navigation to the final single host. Keep a reachable Tasks monitor; the current Tasks sidebar entry is hidden. | OPENPCB-123 |
| [Backend AssistantSDK](../../src/modules/assistant/backend/sdk.ts), [assistant wire types](../../src/sdks/assistant/types.ts), and [SDK tokens](../../src/sdks/index.ts) | Adapt public consumers to AgentKit's canonical generic contracts and explicit app-owned domain adapters. No other production backend retrieves `MODULE_SDK_TOKENS.ASSISTANT`; registration alone is not evidence of a consumer. | OPENPCB-119/122/123 |
| [Backend TasksSDK](../../src/modules/tasks/backend/sdk.ts) and [task interfaces](../../src/sdks/tasks/types.ts) | Adapt verified consumers before removing generic task contracts. Current SDK methods cover creation, reads, cancellation/retry, chunks/events, queue state, executor registration, and subscriptions. | OPENPCB-112/122/123 |
| [Generated assistant HTTP SDK](../../src/core/frontend/src/generated/sdk/assistant.ts), [generated tasks HTTP SDK](../../src/core/frontend/src/generated/sdk/tasks.ts), and [generated index](../../src/core/frontend/src/generated/sdk/index.ts) | Regenerate or remove obsolete exports during cutover. These currently provide generic `get/post/put/delete` HTTP clients, not schema-derived assistant operation methods. No production source outside generated files imports either generated client. | OPENPCB-119/120/122/123 |
| [Assistant space](../../src/modules/assistant/frontend/Space.tsx) and [Designer dock](../../src/modules/assistant/frontend/DesignerChatDock.tsx), mounted by [Designer space](../../src/modules/designer/frontend/Space.tsx) | Adapt both direct HTTP callers to one authenticated AgentKit client and shared durable run model. Keep drafts, design navigation, mentions, provider/model selection, cards, and keyboard behavior. | OPENPCB-120 |
| [Legacy stream hook](../../src/modules/assistant/frontend/hooks/useAssistantStream.ts) | Remove the old `EventSource`, task-status mapping, `_aiEvent` JSON chunk wrapper, and Copilot frame routing after typed stream/replay integration passes. Keep partial output, working Stop, stable event identities, and final verification drain. | OPENPCB-119/120 |
| [Assistant Settings panel](../../src/core/frontend/src/settings/panels/AssistantPanel.tsx) | Adapt provider/settings calls and credential submission/status to the new trusted boundary. Preserve API-key/local configuration and MCP preferences independently of managed cloud. | OPENPCB-114/115/120 |
| [Tasks monitor](../../src/modules/tasks/frontend/Space.tsx) | Adapt its direct HTTP list read to AgentKit's authenticated run read model. Preserve error/empty/navigation behavior and add bounded pagination and accessible scrolling beyond 50 runs. Do not keep its legacy scheduler. | OPENPCB-123 |
| [Shared contract dependency](../../package.json), [assistant type reexports](../../src/sdks/assistant/types.ts), and [Copilot schema generator](../../scripts/gen-copilot-tool-schemas.ts) | Remove active `@openpcb/ai-core` imports, generated declarations, and transitive production dependencies only with the clean versioned shared-contract release. Retain PCB-specific contracts without loading an agent runtime. Remove desktop Copilot-only generation when no active consumer remains. | OPENPCB-122/123 |

The complete production **backend consumers** of `TasksSDK` are:

| Consumer | Actual use | Decision |
| --- | --- | --- |
| [AssistantService](../../src/modules/assistant/backend/assistant-service.ts) | Retrieves the SDK and creates `assistant.chat` or `assistant.cloud-chat` tasks on submission. | Adapt local submission to AgentKit; remove desktop cloud submission under OPENPCB-116/123. |
| [RunService](../../src/modules/assistant/backend/run-service.ts) | Retrieves the SDK and registers the `assistant.chat` executor. | Replace generic run loop, projection/retry, and correction orchestration under OPENPCB-116/117/123. |
| [CloudRunService](../../src/modules/assistant/backend/cloud/cloud-run-service.ts) | Retrieves the SDK and registers `assistant.cloud-chat` when the service is instantiated behind `cloud.copilot`. | Exclude desktop cloud execution under OPENPCB-115/123. |

No production backend outside `assistant` consumes `TasksSDK`. The Tasks module itself is the SDK
provider and HTTP server, not another SDK consumer. Its
[runtime singleton](../../src/modules/tasks/backend/runtime-singleton.ts) also registers the
`tasks.echo` demonstration executor directly; no production submitter for that kind appears outside
the generic task endpoint. Retire that executor with the legacy engine under OPENPCB-123 rather
than retaining a separate scheduler for a demonstration. The non-assistant
production consumer is the **Tasks monitor's HTTP read**. The Assistant space, dock, and stream hook
also read task status/streams and cancel tasks over HTTP; their type imports are real consumers even
though they do not instantiate the generated SDK. Test fixtures are excluded from this inventory.

Retirement covers [TaskRuntime](../../src/modules/tasks/backend/runtime/task-runtime.ts),
[queue manager](../../src/modules/tasks/backend/runtime/task-queue-manager.ts),
[executor registry](../../src/modules/tasks/backend/runtime/executor-registry.ts),
[event bus](../../src/modules/tasks/backend/runtime/event-bus.ts),
[scope lock](../../src/modules/tasks/backend/runtime/scope-task-lock.ts),
[status mapping](../../src/modules/tasks/backend/runtime/status.ts), and
[legacy task storage](../../src/modules/tasks/backend/storage/openpcb-task-storage.ts).
Old assistant/task history may remain inert in the app database. It must not be imported, replayed,
or read/written by the active replacement runtime. Design/library/document data and canonical undo
history remain application data.

## Provider compatibility

The fixture captures five public provider presets. The actual
[ProviderStore](../../src/modules/assistant/backend/provider-store.ts) accepts those five kinds plus
`openpcb-cloud`; four ordinary presets are seeded, while custom compatible endpoints are user-added.
The [provider factory](../../src/modules/assistant/backend/providers/openpcb-provider-factory.ts)
uses the OpenAI-compatible transport for all five ordinary provider kinds, including OpenRouter.

| Kind | Existing configuration behavior | Decision |
| --- | --- | --- |
| `openai` | API key required; built-in preset; `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` seed configuration. | Keep and adapt under OPENPCB-114/115. |
| `openrouter` | API key required; built-in preset; `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL` seed configuration. | Keep and adapt under OPENPCB-114/115. |
| `openai-compatible` | Custom endpoint; optional key; valid kind but not a default seeded row. Ollama/vLLM/llama.cpp are endpoint examples, not separate current preset kinds. | Keep and adapt under OPENPCB-115. |
| `lmstudio` | Built-in local preset; optional key; endpoint/model configuration and local model discovery. | Keep and adapt under OPENPCB-115. |
| `omlx` | Built-in local preset; optional key; initially empty endpoint/model requiring configuration. | Keep and adapt under OPENPCB-115. |
| `openpcb-cloud` | Separate Pro-session seeding, workspace attribution, bearer headers, metered proxy, remote tools, and optional Copilot runs. | Exclude seeding/execution from the desktop profile under OPENPCB-115/123. |

[ProviderCredentials](../../src/modules/assistant/backend/providers/provider-credentials.ts),
[credential contracts](../../src/core/contracts/credentials/secret-store.ts), and the
[Electron vault](../../electron/src/main/credential-vault.ts) own API-key references/resolution.
Adapt that boundary under OPENPCB-114; saved credentials must not appear in public provider DTOs,
renderer reads, tasks, or diagnostics. Local providers must remain usable without persistent secrets.

Keep enabled/default/model selection, base URLs, supported custom headers, cached discovery,
user-initiated probes, and `auto/on/off` tool-calling overrides. OPENPCB-115 requires one immutable
provider/config snapshot per submitted run, explicit errors for unavailable models/keys/endpoints,
and no automatic fallback to a paid provider. Do not infer that OpenAI/OpenRouter should disappear
because their source labels call them “cloud providers.” Ordinary API-key/local providers remain
available with managed cloud disabled.

Remove the desktop dependencies on
[cloud provider seeding](../../src/modules/assistant/frontend/cloud/use-cloud-provider-seed.ts),
[cloud run service](../../src/modules/assistant/backend/cloud/cloud-run-service.ts),
[remote tools](../../src/modules/assistant/backend/cloud/remote-tool.ts),
[Copilot client](../../src/modules/assistant/backend/cloud/copilot-client.ts), and
[Copilot frame mapping](../../src/modules/assistant/backend/cloud/frame-mapper.ts) under OPENPCB-123.
SIWC is an independent later option; OPENPCB-113 controls its authentication dependency and
redistribution approval. Generic Responses mocks do not grant that approval.

## HTTP ownership and route decisions

The module router adds `/api/modules/assistant` or `/api/modules/tasks` to the paths below; see
[module dispatch](../../src/core/backend/router/module-registry.ts). Every registration in
[assistant routes](../../src/modules/assistant/backend/routes.ts) is listed: 46 registrations,
including three `/mcp` registrations conditional on `mcp.server`. The cloud-specific routes are
present in this legacy registration function; a disabled frontend is not proof that those routes
are absent.

All adapted application routes must use OPENPCB-119's bounded schemas, per-launch application
credential, Host/Origin checks, typed problem responses, and explicit idempotency/replay contracts.
An MCP bearer cannot authorize application submission, settings, or credential APIs. Remove old
aliases after migration; no unauthenticated compatibility endpoint may bypass the new boundary.
The table defines behavioral ownership, not promised one-for-one AgentKit URL aliases.

| Method | Legacy assistant path | Handler owner and decision | Requirement |
| --- | --- | --- | --- |
| GET | `/design-chats` | `AssistantService.listDesignChats`: adapt app-owned design/chat association. | OPENPCB-117/119 |
| POST | `/design-chats` | `AssistantService.createDesignChat`: adapt creation plus binding. | OPENPCB-117/119 |
| POST | `/design-chats/ensure` | `AssistantService.ensureDesignChat`: adapt deterministic design-chat resolution. | OPENPCB-117/119 |
| GET | `/chats` | `ConversationStore.listChats`: adapt to fresh AgentKit history. | OPENPCB-119/123 |
| POST | `/chats` | `AssistantService.createChat`: adapt generic creation and app prompt preferences. | OPENPCB-117/119 |
| POST | `/chats/bulk-delete` | `ConversationStore.deleteChat`: adapt validated bulk deletion; do not carry old history into the new store. | OPENPCB-119/123 |
| GET | `/chats/:id` | `ConversationStore.getChat`: adapt canonical conversation reads. | OPENPCB-119 |
| PATCH | `/chats/:id` | `ConversationStore.updateChat`: adapt validated title changes. | OPENPCB-119 |
| DELETE | `/chats/:id` | `ConversationStore.deleteChat`: adapt explicit conversation deletion. | OPENPCB-119 |
| GET | `/chats/:id/messages` | `ConversationStore.listMessages`: adapt bounded history pagination. | OPENPCB-119/120 |
| POST | `/chats/:id/messages` | `AssistantService.submitMessage`: replace task creation with authenticated immutable/idempotent AgentKit submission; exclude cloud credentials. | OPENPCB-116/119 |
| POST | `/providers/cloud/seed` | `AssistantService.seedCloudProvider`: remove from desktop profile. | OPENPCB-115/123 |
| POST | `/providers/cloud/disable` | `AssistantService.disableCloudProvider`: remove obsolete desktop cloud-seeding control. | OPENPCB-115/123 |
| GET | `/chats/:id/tool-events` | `AssistantService.listToolEvents`: adapt durable event identity and per-message filtering to the new read model. | OPENPCB-119/120 |
| GET | `/chats/:id/write-proposals` | `AssistantService.listWriteProposals`: adapt proposal/receipt reads; keep domain payloads. | OPENPCB-118/119 |
| POST | `/chats/:id/write-proposals/:proposalId/apply` | `AssistantService.applyWriteProposal`: adapt approval and crash-safe operation receipts; keep native command semantics. | OPENPCB-118/119 |
| POST | `/chats/:id/write-proposals/:proposalId/reject` | `AssistantService.rejectWriteProposal`: adapt explicit rejection; exclude cloud callbacks. | OPENPCB-118/119 |
| GET | `/chats/:id/cloud-runs/:runId/plan` | `AssistantService.getCloudPlan`: remove desktop Copilot proxy. | OPENPCB-123 |
| PATCH | `/chats/:id/cloud-runs/:runId/plan` | `AssistantService.patchCloudPlan`: remove desktop Copilot proxy. | OPENPCB-123 |
| POST | `/chats/:id/cloud-runs/:runId/plan/approve` | `AssistantService.approveCloudPlan`: remove desktop Copilot proxy. | OPENPCB-123 |
| POST | `/chats/:id/cloud-runs/:runId/resume` | `AssistantService.resumeCloudRun`: remove cloud resume; do not confuse it with explicit local receipt-aware resume. | OPENPCB-119/123 |
| GET | `/cloud/wallet` | `AssistantService.getCloudWallet`: remove desktop managed-credit read. | OPENPCB-123 |
| GET | `/chats/:id/write-policy/session-allow` | `AssistantService.listSessionWriteAllowances`: adapt scoped ephemeral authorization. | OPENPCB-118/119 |
| POST | `/chats/:id/write-policy/session-allow` | `AssistantService.allowSessionWriteTool`: adapt validated explicit grants; model content cannot grant authority. | OPENPCB-118/119 |
| DELETE | `/chats/:id/write-policy/session-allow/:key` | `AssistantService.revokeSessionWriteAllowance`: adapt explicit revocation. | OPENPCB-118/119 |
| GET | `/chats/:id/context-bindings` | `AssistantService.listContextBindings`: keep app-owned bindings, adapt transport. | OPENPCB-117/119 |
| DELETE | `/chats/:id/context-bindings/:bindingId` | `AssistantService.deleteContextBinding`: keep app-owned unbinding, adapt transport. | OPENPCB-117/119 |
| GET | `/prompt-presets` | `PromptService.listPresets`: keep app prompts, adapt transport. | OPENPCB-117/119 |
| GET | `/providers` | `ProviderStore.listProviders`: adapt sanitized configuration reads. | OPENPCB-114/115/119 |
| POST | `/providers` | `ProviderStore.createProvider`: adapt validated nonsecret configuration. Credential fields are rejected; durable key submission uses typed desktop IPC. | OPENPCB-114/115/119 |
| GET | `/providers/:id` | `ProviderStore.getProvider`: adapt sanitized single-provider reads. | OPENPCB-114/115/119 |
| PUT | `/providers/:id` | `ProviderStore.updateProvider`: adapt nonsecret settings, preserve configuration. Key rotation uses typed desktop IPC. | OPENPCB-114/115/119 |
| DELETE | `/providers/:id` | `ProviderStore.deleteProvider`: adapt removal without silently replacing a running provider. | OPENPCB-115/119 |
| GET | `/providers/:id/models` | `AssistantService.listProviderModels`: adapt cached catalog reads. | OPENPCB-115/119 |
| POST | `/providers/:id/models/refresh` | `AssistantService.refreshProviderModels`: adapt explicit bounded discovery. | OPENPCB-115/119 |
| POST | `/providers/:id/test` | `AssistantService.testProvider`: adapt explicit probes; `includeCompletion` can request inference. | OPENPCB-115/119 |
| GET | `/providers/:id/capabilities` | `AssistantService.getProviderCapabilities`: adapt cached capability reads. | OPENPCB-115/119 |
| POST | `/providers/:id/capabilities/refresh` | `AssistantService.refreshProviderCapabilities`: adapt explicit bounded capability probing. | OPENPCB-115/119 |
| GET | `/providers/:id/tool-calling` | `AssistantService.getToolCalling`: adapt override reads. | OPENPCB-115/119 |
| PUT | `/providers/:id/tool-calling` | `AssistantService.setToolCalling`: keep `auto/on/off`, adapt validation/storage. | OPENPCB-115/119 |
| GET | `/tools` | `RunService` registry projection: adapt to the authoritative contributor catalog; preserve intentional visibility. Current route returns only name/effect/description. | OPENPCB-117/119 |
| POST, GET, DELETE | `/mcp` | Same `McpEndpoint.fetch` handler for all three methods: adapt generic protocol serving; keep app tools/resources/prompts and separate bearer. | OPENPCB-121 |
| GET | `/settings` | `SettingsStore.getSettings`: adapt generic settings ownership, keep app-only preferences. | OPENPCB-115/117/119 |
| PUT | `/settings` | `SettingsStore.updateSettings`: adapt validated updates without switching an active run. | OPENPCB-115/119 |

Handler implementations are [AssistantService](../../src/modules/assistant/backend/assistant-service.ts),
[ConversationStore](../../src/modules/assistant/backend/conversation-store.ts),
[ProviderStore](../../src/modules/assistant/backend/provider-store.ts),
[SettingsStore](../../src/modules/assistant/backend/settings-store.ts),
[PromptService](../../src/modules/assistant/backend/prompt-service.ts), and
[McpEndpoint](../../src/modules/assistant/backend/mcp/handler.ts).

All nine registrations in [task routes](../../src/modules/tasks/backend/routes.ts) use
[TaskRuntime](../../src/modules/tasks/backend/runtime/task-runtime.ts) or its storage. They must be
retired with the legacy task engine, rather than mounted beside AgentKit.

| Method | Legacy task path | Compatibility decision | Requirement |
| --- | --- | --- | --- |
| GET | `/tasks` | Adapt monitor/filter reads to bounded authenticated AgentKit run pagination. | OPENPCB-119/123 |
| POST | `/tasks` | Remove generic legacy task creation; use the authorized host submission contract for genuine consumers. | OPENPCB-119/123 |
| GET | `/tasks/:id` | Adapt durable run/status reads used by space, dock, and monitor. | OPENPCB-119/120/123 |
| POST | `/tasks/:id/cancel` | Adapt cancellation to explicit run identity; committed domain edits remain committed. | OPENPCB-118/119/120 |
| POST | `/tasks/:id/retry` | Remove blind retry. Explicit Continue/Resume must retain receipt and submission identity. | OPENPCB-118/119/123 |
| GET | `/tasks/:id/chunks` | Replace chunk-wrapper reads with the typed durable event/read contract. | OPENPCB-119/120 |
| GET | `/tasks/:id/events` | Adapt ordered event reads and stable identities. | OPENPCB-119/120 |
| GET | `/queues` | Remove legacy queue state; expose only truthful run-host monitoring if the monitor needs it. | OPENPCB-123 |
| GET | `/tasks/:id/stream` | Replace legacy replay-plus-subscribe SSE with authenticated cursor replay and final verification drain. | OPENPCB-119/120 |

Core mention routes remain shared application infrastructure. Their registrations in
[create-http-server.ts](../../src/core/backend/http/create-http-server.ts) dispatch through
[MentionController](../../src/core/backend/mentions/mention-controller.ts):

| Method | Core path | Handler and decision |
| --- | --- | --- |
| POST | `/api/mentions/search` | `search`: keep bounded multi-provider search; adapt assistant attachment/context use under OPENPCB-117. |
| GET | `/api/mentions/resolve/:entityType/:entityId` | `resolve`: keep explicit entity resolution. |
| POST | `/api/mentions/staleness` | `checkStaleness`: keep snapshot health checks. |
| GET | `/api/mentions/types` | `getTypes`: keep registered type discovery. |
| GET | `/api/mentions/navigate/:entityType/:entityId` | `getNavigationPath`: keep application navigation. |

## Native tools, context, verification, and writes

[The native registry](../../src/modules/assistant/backend/tools/openpcb-tool-registry.ts) registers
15 in-app tools: seven reads and eight writes. Names, schema structure, optional fields, quantities,
units, errors, assigned IDs/refdes, and partial-result semantics are compatibility contracts under
OPENPCB-117. Wrap these implementations as contributors; do not rename tools, weaken schemas,
copy algorithms into AgentKit, or expand the in-app catalog with MCP-only reads.

| Tool | Effect | Implementation to keep and adapt |
| --- | --- | --- |
| `library_search_components` | read | [Library tools](../../src/modules/assistant/backend/tools/library-tools.ts) |
| `library_get_component_detail` | read | [Library tools](../../src/modules/assistant/backend/tools/library-tools.ts) |
| `library_resolve_bom` | read | [Library tools](../../src/modules/assistant/backend/tools/library-tools.ts) |
| `designer_resolve_design` | read | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) and [ContextResolver](../../src/modules/assistant/backend/context-resolver.ts) |
| `designer_get_design_summary` | read | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_get_part_detail` | read | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_get_schematic_connectivity` | read | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_create_design` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) and app-owned binding creation |
| `designer_place_components` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_arrange_schematic` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_propose_schematic_edits` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_propose_schematic_wires` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) and [schematic targeting](../../src/modules/assistant/backend/tools/schematic-targeting.ts) |
| `designer_propose_schematic_updates` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `designer_propose_schematic_deletions` | write | [Designer tools](../../src/modules/assistant/backend/tools/designer-tools.ts) |
| `compile_circuit` | write | [Compiler tool](../../src/modules/assistant/backend/compiler/compile-circuit-tool.ts), [expansion](../../src/modules/assistant/backend/compiler/expander.ts), [lowering](../../src/modules/assistant/backend/compiler/lowering.ts), and [apply](../../src/modules/assistant/backend/compiler/apply.ts) |

Keep app-owned [ContextResolver](../../src/modules/assistant/backend/context-resolver.ts),
[context summary](../../src/modules/assistant/backend/context-summary.ts), bindings, selected entities,
and [prompt presets/instructions](../../src/modules/assistant/backend/prompt-service.ts), adapting
AgentKit's ContextProvider and prompt composition under OPENPCB-117. The current unbound staging
names are the three library reads, `designer_resolve_design`, and `designer_create_design`. When
creation is available, the legacy runner advertises the full catalog up front so create/place/wire
can finish in one run. Preserve that workflow through `unboundToolNames` and refresh binding health
at defined turn/tool boundaries. Stale or deleted bindings must not silently target another editor.

Keep the shared [mention registry/parser](../../src/core/backend/mentions/index.ts) and providers for
[design](../../src/modules/designer/backend/providers/mention-provider.ts),
[library-component](../../src/modules/library/backend/providers/mention-provider.ts), and
[knowledge-page](../../src/modules/knowledge/backend/providers/mention-provider.ts).
Adapt [assistant snapshots](../../src/modules/assistant/backend/mention-repository.ts),
[content resolution](../../src/modules/assistant/backend/mention-content-resolver.ts),
[Tiptap conversion](../../src/modules/assistant/backend/tiptap-to-markdown.ts),
[autocomplete hook](../../src/modules/assistant/frontend/hooks/useMentions.ts), and composer/badge
components under OPENPCB-117/120. Imported text, images, attachments, and tool output are untrusted
context, never approval or permission to expose hidden tools.

The existing mention limits declare 10,000 characters per page, 50,000 total context characters,
10 pages per message, 10 images per page, 20 total images, 5 MiB per image, and a 5,000 ms resolution
timeout. Preserve bounded supported inputs and explicitly report unsupported/over-budget images;
declaring constants does not prove each limit is enforced. The current resolver extracts knowledge
page text/images and represents PDFs as attachments without text extraction. Do not silently flatten
images or introduce arbitrary filesystem paths/unrestricted URL fetching in the adapter.

Keep [Definition-of-Done verification](../../src/modules/assistant/backend/verification/run-dod.ts),
[build intent](../../src/modules/assistant/backend/verification/build-intent-store.ts), and
[verification types](../../src/modules/assistant/backend/verification/types.ts). Its checks are
`bom_placed`, `nets_wired`, `no_dangling_power`, and `erc_clean`; they do not certify every PCB DRC or
manufacturing rule. Missing projections and unverifiable required nets must remain honest failures.
Adapt the checker as VerificationHook; remove the second correction loop in
[RunService](../../src/modules/assistant/backend/run-service.ts). Corrections belong to AgentKit,
bounded to the configured three passes under OPENPCB-117/115. Final verification remains durable
and visible even after provider text or a later provider failure.

Keep domain operations in [proposal apply](../../src/modules/assistant/backend/proposals/proposal-apply-service.ts),
[designer command execution](../../src/modules/designer/backend/command-executor.ts), and the
[DesignerSDK undo/redo](../../src/modules/designer/backend/sdk.ts). The canonical HTTP history paths
remain `/api/modules/designer/designs/:designId/history`,
`POST /api/modules/designer/designs/:designId/history/undo`, and
`POST /api/modules/designer/designs/:designId/history/redo`; see
[designer routes](../../src/modules/designer/backend/routes.ts).

OPENPCB-118 preserves non-destructive auto-apply with undo and explicit/session authorization for
destructive actions. Adapt [session write policy](../../src/modules/assistant/backend/write-session-policy.ts)
and [action IDs](../../src/modules/assistant/backend/tools/action-id.ts) to actor-scoped guards and
crash-safe receipts, then remove redundant generic policy/storage. A model-supplied risk or repeated
key with different arguments cannot grant authority. Receipts must bind actor, tool, argument
fingerprint, target design, expected revision, and undo outcome. Preserve partial committed units
and actual IDs; Stop prevents new work but does not undo completed commands. Existing assistant
proposal persistence/deduplication alone does not prove atomic crash-after-domain-commit recovery.

## Inbound MCP contract

Keep inbound local-agent domain control under OPENPCB-121. Adapt
[handler](../../src/modules/assistant/backend/mcp/handler.ts),
[server](../../src/modules/assistant/backend/mcp/server.ts), and
[tool projection](../../src/modules/assistant/backend/mcp/tool-projection.ts) to AgentKit's generic
serving seam; retain app-owned native implementations and guards. Keep
[Electron discovery](../../electron/src/main/mcp-portfile.ts), the
[packaged stdio shim](../../electron/src/mcp-shim/index.ts), and its
[packaging resources](../../electron/electron-builder.cjs). Discovery uses the ephemeral port and a
separate per-launch token in a mode-0600 portfile; executable resources must work outside app.asar.

The captured catalogs contain 14 tools with MCP writes off and 22 with writes on. Those are the
seven in-app reads or all 15 in-app tools, plus six
[MCP-only extended reads](../../src/modules/assistant/backend/tools/read-tools.ts):
`designer_list_designs`, `designer_get_pcb_state`, `designer_run_erc`, `designer_run_drc`,
`designer_get_bom`, and `designer_export_manufacturing`; and the session-scoped
`designer_use_design` control. The read annotation is catalog visibility, not proof of zero internal
persistence: for example, DRC uses the owning domain's report path. Do not add these extensions to
the in-app prompt catalog or quietly invoke any model from a native MCP action.

Keep [session context](../../src/modules/assistant/backend/mcp/session.ts): explicit `designId`
precedes the session pin, which precedes the UI-active design. Client identity comes from the stable
client header/fallback, not the cosmetic display name. Backing chats reconnect through
`metadata.mcp.clientKey`. Adapt to server-controlled actors with independent allowances; app/MCP
sessions must not share destructive grants.

[Resources](../../src/modules/assistant/backend/mcp/resources.ts) register one template,
`openpcb://design/{designId}/{kind}`, with kinds `schematic`, `pcb`, `bom`, `erc`, and `drc`.
[Prompts](../../src/modules/assistant/backend/mcp/prompts.ts) register four workflows:
`openpcb-build-circuit`, `openpcb-review-schematic`, `openpcb-drc-triage`, and `openpcb-bom-check`.
Keep their app-specific content and schemas. The manufacturing tool description references an
export ZIP resource, but this resource implementation registers only the five JSON kinds; that
comment is not evidence that a Gerber ZIP resource exists.

Preserve `mcpEnabled`/`mcpAllowWrites` as app preferences and their off-by-default behavior. MCP
must exclude credential reads, sign-in/account selection, model catalog access, generic assistant
submission, and ChatGPT inference. No outbound MCP connection or SIWC-to-MCP bridge is in scope.

## Executable qualification

Run from the repository root:

```sh
bun test src/core/backend/tests/assistant-parity-catalog.test.ts src/core/backend/tests/assistant-parity-native.test.ts src/core/backend/tests/assistant-parity-lifecycle.test.ts
bun scripts/assistant-parity-snapshot.ts --check
```

[Snapshot generation](../../scripts/assistant-parity-snapshot.ts) compares the entire current
catalog/schema capture. [catalog.json](../../src/core/backend/tests/fixtures/assistant-parity/catalog.json)
preserves the legacy capture; [catalog.current.json](../../src/core/backend/tests/fixtures/assistant-parity/catalog.current.json)
records the reviewed current database schema. Tests separately require native tool/MCP contracts to
match the legacy capture. Review intentional contract changes before using `--write`; it updates
only the current fixture. Never weaken a schema or patch installed dependencies to make a candidate
pass.

The parity harness runs production migrations, the real KiCad import path, LibrarySDK, DesignerSDK,
TasksSDK, native tools, RunService, and authenticated MCP against isolated temporary SQLite. Provider
responses and trusted credential storage are test doubles. It imports its checked-in capacitor
fixture; it does not bypass bundled CoreLibrary verification or qualify OPENPCB-50/101.

The deterministic expectations include inspect without mutation; two placed capacitors at revision
2; move at 3; wire plus arrange at 5; value update at 6; undo at 7; stable returned IDs; actual pin
connectivity; destructive rejection/approval; stale approval refusal; duplicate action deduplication;
partial operation receipts; and terminal Stop/reopen. See the
[scenario data](../../src/core/backend/tests/fixtures/assistant-parity/scenarios.json) and fixture
README for complete assertions and existing partial-placement status limitations.

Complementary app-owned regression checks remain necessary:

```sh
bun test src/core/backend/tests/assistant-run-service.test.ts src/core/backend/tests/assistant-dod-verifier.test.ts src/core/backend/tests/assistant-mcp-endpoint.test.ts src/core/backend/tests/assistant-write-idempotency.test.ts src/core/backend/tests/assistant-action-id-dedup.test.ts
bun test src/modules/assistant/backend/mention-content-resolver.test.ts src/modules/assistant/backend/tiptap-to-markdown.test.ts
```

To qualify an **explicit installed developer candidate** against the unchanged schema fixture,
without adding a production dependency or sibling-checkout import:

```sh
node scripts/qualify-assistant-candidate.mjs --package-dir /absolute/path/to/installed/agentkit --fixture src/core/backend/tests/fixtures/assistant-parity/catalog.json --tarball /absolute/path/to/agentkit-version.tgz
# Run this separate profile only for a Responses-ready candidate:
node scripts/qualify-assistant-candidate.mjs --profile responses --package-dir /absolute/path/to/installed/agentkit --fixture src/core/backend/tests/fixtures/assistant-parity/catalog.json --tarball /absolute/path/to/agentkit-version.tgz
AGENTKIT_QUALIFICATION_PACKAGE_DIR=/absolute/path/to/installed/agentkit node --test scripts/qualify-assistant-candidate.test.mjs
```

[Candidate qualification](../../scripts/qualify-assistant-candidate.mjs) verifies the pinned exact
unpublished candidate version/archive SHA-256 and every installed archive file before loading its
public exports. It stages all 15 definitions through the actual framework contributor catalog,
compares namespace/schema identity, and, with `--profile responses`, serializes them through exported
ResponsesClient using fake trusted transports for both API-key and account profiles. It preserves function call/result IDs and
fixture-returned design/part IDs. The real AgentKit TurnRunner, memory store, and local task runner
execute a **synthetic read stub**, not OpenPCB's domain tool implementation. The JSON report states
that boundary and returns nonzero on missing support, schema incompatibility, or failed assertions.

The default `migration` profile does not require Responses. The 0.6.0 foundation candidate has no
public ResponsesClient export; requesting the separate `responses` profile therefore fails
explicitly rather than inventing an API. The 0.7.0 candidate exposes it. Neither
candidate is a published install pin, supported live-account connection, native GUI qualification,
or approved redistribution artifact. The associated tests reject artifact mismatch and specific
schema incompatibilities without framework patches; an unavailable Responses test is explicitly
skipped on the foundation artifact.

Parity tests do not prove atomic domain receipt recovery, authenticated application REST/SSE,
renderer remount behavior, complete mention-provider bootstrap, native OS credential persistence,
Electron packaging, live model endpoint support, SIWC renewal, or professional PCB correctness.
Those require their owning integration/native gates. A canned provider answer and a passing
synthetic tool stub cannot substitute for domain snapshots, undo evidence, or real native evidence.
