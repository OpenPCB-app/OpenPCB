# Desktop AgentKit runtime

## Ownership and storage

[Assistant activation](../../src/modules/assistant/backend/index.ts) creates one
[app service](../../src/modules/assistant/backend/agentkit-service.ts) and one
[AgentKit host](../../src/modules/assistant/backend/agentkit-host.ts). Electron hosts that service
inside its main process; standalone development uses Node. The Node SQLite adapter must not run
inside Bun: the host rejects that runtime before opening its native database.

AgentKit owns conversation trees, task attempts, leases, event replay, proposal state, immutable
provider generations, and generic loop budgets in a separate `agentkit.sqlite`. OpenPCB's
`openpcb.sqlite` remains the domain database. The host rejects the actual application database path
and symlink aliases before opening AgentKit's schema manager. Legacy assistant/task rows are inert;
activation does not import or execute their history. The Tasks monitor reads the same host and
forwards cancellation/resume to the same local runner.

The app provides native tool contributors, context/mention/prompt adapters, domain proposal apply
and receipt recovery, verification, provider preferences, and the credential vault. Generic loops,
correction passes, task lifecycle, and proposal state transitions remain in AgentKit. Public routes
use the app wrapper; generic framework provider CRUD does not own credentials or provider history.
See [compatibility](compatibility.md) and [credential storage](credentials.md) for those boundaries.

## Admission, recovery and shutdown

Each submitted turn pins its endpoint, selected model, effective tool capability override, and
opaque vault reference into an immutable provider generation. Rotation, clear, deletion, and default
changes cannot replace a queued or running turn's generation. Client construction resolves that
reference only in the trusted process. Local providers without a configured key do not consult the
vault. Configured but unavailable credentials fail rather than silently falling back.

The host hashes original caller intent before resolving defaults. That fingerprint is persisted
inside the same framework transaction as the turn's messages/task; retries compare it before
consulting current configuration. Trusted submission metadata captures app prompt choice, and a
provider message adapter supplies app prompt/mention content without replacing pinned model,
transport credentials, cancellation, or dispatch budget callbacks.

Boot uses manual recovery. Queued work becomes interrupted; crashed running work waits for its
lease to expire. A serialized 10-second app lifecycle sweep calls the framework's manual recovery
method so a lease that was fresh at boot is eventually interrupted. It never redispatches inference
or reapplies domain writes. Proposal reconciliation runs only at boot and asks the native receipt
adapter what already landed. Credential migration may separately persist verified vault references;
it does not invoke a model. Resume requires explicit intent.

Shutdown aborts pending admission, stops claiming, cancels running execution, waits for execution and
recovery to settle, disposes contributors, and closes the native handle. Repeated close is
idempotent; duplicate boot against the same canonical file is refused.
Electron defers `before-quit` until the same backend shutdown promise settles, including a backend
still starting. Runtime close precedes DRC-worker disposal and MCP-discovery cleanup; all cleanup
steps are attempted before final `app.quit()`, preserving updater quit hooks. A failed cleanup emits
a bounded static log message and does not strand application quit.

| Budget | Remote API endpoint | Local endpoint |
| --- | --- | --- |
| First provider byte | 60 seconds | 180 seconds |
| Stream idle | 60 seconds | 90 seconds |
| Overall turn | 600 seconds | 600 seconds |
| Provider requests | 24 | 24 |
| Tool calls | 64 | 64 |
| Correction passes | 3 | 3 |
| Tool execution | 60 seconds | 60 seconds |

Counters and the overall deadline span retries and correction passes. LM Studio and oMLX use the
local profile; custom compatible endpoints use it only for loopback hosts. Other custom endpoints,
OpenAI and OpenRouter use the remote profile.

## Development artifact provenance

The root npm lockfile is dependency truth. These checked-in development archives are explicitly
unpublished candidates, not final production pins:

| Package | Candidate | Archive SHA-256 |
| --- | --- | --- |
| `agentkit` | Second-pass FOUNDATION `0.6.0` | `a37680d7d7d5b73735ddf4a710d576744e7a2ed9ba8ecee59e5e84c60f8a58c6` |
| `@openpcb/contracts` | Clean domain-only `1.0.0-candidate.0` | `22a03f6b47b5b3244244102984972d79027e28ffbd8dc39364f9b91ada0d8312` |

The archives live under [vendor/agentkit](../../vendor/agentkit/README.md) and
[vendor/contracts](../../vendor/contracts/README.md). Do not modify archives, import sibling
framework source, overlay framework implementations, or patch installed dependencies. The clean
contracts candidate exports domain contracts without an assistant runtime dependency. FOUNDATION
has no public Responses client; the separate Responses profile must fail explicitly when that
export is absent.

## Verification

Run the native-store host suite with Node, separately from the Bun domain suite:

```sh
npm run test:agentkit-host
npx tsc -p electron/tsconfig.json --noEmit
bun test electron/tests scripts/core-library src/core/backend/tests/library-dev-watcher.test.ts
node --test scripts/check-agentkit-distribution.test.mjs
node scripts/qualify-assistant-candidate.mjs --package-dir node_modules/agentkit --fixture src/core/backend/tests/fixtures/assistant-parity/catalog.json --tarball vendor/agentkit/agentkit-0.6.0-foundation-pending-publication.tgz
AGENTKIT_QUALIFICATION_PACKAGE_DIR="$PWD/node_modules/agentkit" node --test scripts/qualify-assistant-candidate.test.mjs
```

The host runner bundles checked-in Node tests into a fresh temporary directory and removes it after
execution. It opens real app/AgentKit SQLite stores with synthetic provider transports and an
injected credential vault. It verifies admission pinning, replay conflicts, manual recovery,
cancel shutdown, schema refusal, cumulative budgets, and credential redaction before durable event
publication. Synthetic host read tools do not prove native domain behavior; run the owning HTTP/domain
integration gates separately.

The desktop combination is pinned to Electron `41.6.1` and `better-sqlite3` `13.0.3`. To run the same
host suite under that installed Electron runtime with an isolated copy of its macOS ARM64 addon:

```sh
mkdir -p /tmp/openpcb-agentkit-electron-native
cp node_modules/better-sqlite3/prebuilds/darwin-arm64.node /tmp/openpcb-agentkit-electron-native/better_sqlite3-13.0.3-darwin-arm64.node
ELECTRON_RUN_AS_NODE=1 OPENPCB_AGENTKIT_TEST_EXECUTABLE="$PWD/node_modules/.bin/electron" OPENPCB_AGENTKIT_TEST_NATIVE_BINDING=/tmp/openpcb-agentkit-electron-native/better_sqlite3-13.0.3-darwin-arm64.node npm run test:agentkit-host
```

This explicit profile selects the copied binding for both app and AgentKit fixture databases. The
normal command uses system Node. Record actual runtime versions, addon hash and results; an Electron
run-as-Node test is not a packaged GUI or OS credential-vault qualification.
The shell typecheck includes the already imported in-process backend graph and resolves the official
npm Electron declarations explicitly, avoiding the repository's `electron/` directory shadowing
that package. Shell tests exercise shutdown events and simulated launches; the development library
watcher handles filesystem errors and its module deactivation awaits any active import before the
domain database can close.

Development bundles can be built with `npm run build --workspace electron`. AgentKit's pure
JavaScript adapters, scheduler, host, provider transport, and HTTP code must be bundled into the main
entry; `better-sqlite3` remains external. Native `.node` files and the DRC worker are unpacked from
ASAR by the packaging configuration. A successful bundle build does not authorize redistribution.

### Authenticated browser integration

Run the dedicated Chromium fixture separately from the default browser suite:

```sh
npx playwright test --config tests/e2e/support/assistant-agentkit.config.ts
```

The fixture starts the actual Node backend and Vite frontend with isolated temporary app and
AgentKit databases, a real packed CoreLibrary fixture, and a deterministic loopback OpenAI-compatible
HTTP model server. It imports a real KiCad capacitor symbol and footprint through the normal library
HTTP routes. Only model responses are scripted; AgentKit execution, native Designer writes, receipt
readback, verification, history, and authenticated HTTP transport use the app implementations.

An ephemeral per-launch token reaches the browser through a test-only substitute for the narrow
preload bootstrap. It is never placed in an environment variable, public URL, or saved credential.
The dedicated config and spec disable traces and video, including when the spec is discovered by
another config. Requests are restricted to the isolated frontend/backend and the renderer's public
font assets; no paid provider or user database is used.

The two scenarios verify a shared Space/dock run, actual component and distinct part IDs, passing
final verification, and Designer Undo from two parts to one to zero. They also verify visible live
SSE output, the same active run across Space/dock navigation and page reload, and Stop reaching the
canonical cancelled state. This is browser integration evidence against the real Node runtime;
it does not qualify the full unrelated EDA suite, Electron GUI, OS credential vault, or packaged app.

## Production publication gate

[Release policy](../../resources/agentkit-release.json) currently has `productionRelease: null`.
The [distribution guard](../../scripts/check-agentkit-distribution.mjs) refuses production packaging
until independently reviewed published AgentKit and domain-contract releases are configured.
The known candidate identities in that policy document never grant production eligibility.

```sh
npm run check:agentkit-distribution
```

The expected current failure is:

```text
AgentKit distribution is blocked by OPENPCB-124: no reviewed published AgentKit/contracts release pin is configured.
```

A future reviewed policy must identify both package names with exact published versions, canonical
HTTPS npm registry archive URLs, and exact SHA-512 npm integrity strings. The guard requires root
manifest and npm lock entries to match, checks workspace/duplicate pins, and rejects local files,
mutable refs, aliases, missing/mismatched lock integrity, and a retained `ai-core` production graph.
There is no environment bypass and no guessed final version or artifact hash.

Root production `build` and Electron `package`/`make` commands run this guard before producing a
redistributable. Development build/start remain available for qualified local candidates. The
independent SIWC guard and CoreLibrary release policy remain in force. Passing a dependency pin
check alone does not qualify licensing, signing, native packaging, renderer behavior, live provider
support, or professional PCB correctness.
