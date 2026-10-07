# Assistant architecture

The default desktop assistant is one AgentKit host composed by
[`agentkit-service.ts`](../../src/modules/assistant/backend/agentkit-service.ts).
[`agentkit-runtime.md`](agentkit-runtime.md) defines the runtime, storage, admission, recovery,
shutdown, budget and artifact requirements. This document defines the application boundary.

## Ownership

AgentKit's public package entry points own generic contracts, provider transport, tool schema
validation, run loops, correction passes, conversation branches, task lifecycle, durable events,
proposal state, session write policy, HTTP, React transport and MCP protocol handling. OpenPCB
imports those public entry points; it does not copy their implementations or patch installed code.

OpenPCB owns provider preferences and credential access, prompts, mentions, knowledge/context
bindings, native EDA tools, deterministic circuit compilation, domain mutation receipts and
verification. Application-specific DTOs live in [`src/sdks/assistant`](../../src/sdks/assistant/types.ts)
and import generic types from `agentkit/contracts`. The domain-only `@openpcb/contracts` candidate
exports unrelated PCB contracts without a transitive assistant engine dependency.

Electron's main process and standalone Node host the same composition. Backend development runs
Node with `tsx`; Bun runs domain tests, not the production host. AgentKit uses its own SQLite file;
OpenPCB's design/library/preferences database and OS credential vault remain distinct. Historical
assistant/task tables and SQL migrations remain inert. There is no legacy history importer,
parallel task queue or alternate cloud assistant engine.

The Tasks module is a visible monitor. Its narrow SDK reads paged canonical task summaries and
forwards Stop/Continue to the existing runner. It does not register executors or persist tasks.
The authenticated `/v1/runs` read model uses descending timestamp/ID keyset pagination with a
maximum page of 50 and exposes neither payloads nor provider generations. Stop preserves completed
design mutations. Continue requires an interrupted run; Undo remains a Designer action.

## Providers and authority

OpenPCB supports OpenAI, OpenRouter, custom OpenAI-compatible endpoints, LM Studio and oMLX through
the actual compatible transport. Defaults, model discovery, explicit probes and tool-capability
overrides remain app-owned. The supported preference list excludes managed OpenPCB Cloud. No desktop
Copilot run/plan/wallet/seeding route or cloud tool-schema generator remains. Independent cloud
libraries are not assistant inference routes.

Submission pins the selected endpoint, kind, model, effective capabilities and opaque vault
reference. Queued work retains that generation across default changes, key rotation and provider
deletion. Only the trusted process resolves the key; renderer inputs cannot supply an arbitrary
vault reference. Concurrent probes commit only against their original provider snapshot. Streaming
redaction buffers possible raw and URI-encoded credential prefixes before durable publication.
Failed/cancelled streams discard an unresolved prefix; this can trim harmless trailing text.

The application loopback token and external MCP bearer serve different boundaries. Renderer
requests use trusted preload/bootstrap, exact runtime Host/port and approved renderer origins.
The standalone backend is fail-closed without an explicitly supplied programmatic token; there is
no environment token, public bootstrap route or anonymous development exception. See
[credentials](credentials.md), [CLAUDE security rules](../../CLAUDE.md) and
[developer security/bootstrap instructions](../../DEVELOPER.md).

## Native tools and proposals

The contributor catalog preserves all 15 historical native tool names and JSON input schemas.
Tools use underscore names, explicit capabilities and read/write effects. AgentKit validates inputs
before dispatch. Tool responses retain structured model data separately from full UI data; context
budgets use the small (16–32 KiB), medium (64 KiB) and large (128 KiB) profiles, with source and
truncation metadata. Full source text must not silently bypass model context limits.

Every mutation uses the Designer SDK command boundary. Native proposal identity binds actor scope,
tool, argument fingerprint, design, revision and operation ID. Durable domain receipts describe
what committed; replay reconciles them rather than repeating commands. Application SQL does not
persist framework proposal lifecycle or run events. The model's stated risk does not grant authority.

Safe non-destructive writes can auto-apply under the configured policy. Destructive writes require
explicit approval or a scoped grant. Stale/tampered approval fails before mutation. Placement with
unresolved components stays pending; explicit partial approval can commit the valid subset and
records failures. Applied effects remain visible when a provider later fails. Stop never implicitly
undoes a committed action; Designer Undo uses its persisted inverse patches.

[`run-dod.ts`](../../src/modules/assistant/backend/verification/run-dod.ts) checks `bom_placed`,
`nets_wired`, `no_dangling_power` and `erc_clean` against real domain state. The app returns deficiencies;
AgentKit owns the bounded correction loop and stops stalled correction. There is no second app loop.
A bound native mutation cannot silently pass when its design snapshot is unavailable.

## Circuit compilation

`compile_circuit` accepts declarative circuit IR, then deterministically expands block recipes into
installed parts, pin-accurate connections and native commands. Parameter arithmetic, including
Ohm's-law values, belongs to the expander. Missing library roles are reported without invented parts
or substitution. ERC errors stop the plan before apply. The IR remains an internal TypeScript domain
format; only native command batches cross the Designer boundary, retaining receipts and Undo.

## MCP

The native endpoint uses the public AgentKit MCP adapter. It exposes the real contributor catalog,
application resource readers and prompt bodies. Read-only mode advertises 14 tools; write-enabled
mode advertises 22, including scoped policy/proposal helpers. Four prompts and five concrete resource
types are captured by the current catalog fixture.

Each live transport session receives a generated actor scope and separate backing conversation.
Equal client display names do not share bindings or grants. Reconnection starts a fresh session;
the removed legacy stable-header session authority is not retained. MCP has no provider/key/model
editing, task submission, inference, paid traffic or SIWC identity authority.

The accepted AgentKit 0.6.0 public resource extension has no `resources/templates/list` hook.
Concrete URIs remain available, but historical template advertisement is an explicit compatibility
gap. The current fixture records that gap instead of recreating protocol internals in OpenPCB.

## Verification and release

[Compatibility evidence](compatibility.md) maps the retained surfaces to executable tests.
[Parity fixtures](../../src/core/backend/tests/fixtures/assistant-parity/README.md) preserve the
historical catalog and capture the current canonical composition. Fake transports prove contracts
and lifecycle behavior without claiming live-provider quality, electrical correctness, native GUI
Undo, packaged OS vault access or Windows/Linux qualification.

AgentKit and domain-contract archives are reviewed local candidates pending publication. They are
not production release pins. OPENPCB-124's [distribution policy](../../resources/agentkit-release.json)
and [guard](../../scripts/check-agentkit-distribution.mjs) block root production build and Electron
package/make until exact reviewed published pins are configured. Development builds remain usable.
The independent SIWC and CoreLibrary trust gates still apply; no publication or version is inferred.
