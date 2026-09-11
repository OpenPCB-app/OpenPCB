# 09 — DRC execution contract (Session 10)

Status: **in progress** (2026-09-09). Owner: S10 — DRC execution responsiveness. Closes B5-SYNC.

This contract states how a batch DRC run is *executed*: where it runs, how it is started, joined,
cancelled and observed, what it persists and when, and why the report it produces is the same
bytes the in-thread engine produces. It changes no rule, no geometry, no check and no candidate
discovery — those are contracts 05, 02, 06 and 08. The engine gains one results-neutral option
(`tick`, §6); every check body and every exhaustive block is untouched.

## 0. Scope

In scope: the batch run behind `POST /designs/:id/drc/run`, the SDK `runDrc` (assistant read
tool, MCP resource, proposal apply), the three cloud apply sites (autoroute, autoplace, composite
autolayout — "reported, never gating"), the new run lifecycle routes, the frontend run surface,
and the copper-pour stage *inside* that run.

Out of scope, with owners:

- The live gate (`checkPendingCopper` in the route tool and the server commit gate) — contract
  07; it runs on the caller's thread by design (§9).
- The frontend copper fill (`CopperFillLayer`, `CopperPour`) and the live legality context built
  per projection in `usePcbWorkspace` — renderer main thread; a Web Worker for the fill is a
  separate filing (§9).
- Gerber export, the cloud `BoardSnapshot` pours and the `pcb_cleanup_pour_traces` command's
  fill inside its write transaction — synchronous today (§9).
- Pour kernel budgets and arrangement-size cliffs — 04 §13.
- The commit-gate context memo filed by 07 §9 — retired here (§9).

## 1. The run state machine

A **run** is an in-memory record owned by `DrcRunService` (designer module,
`backend/drc/run-service.ts`):

```
DrcRun {
  runId: string            // uuid
  designId: string
  revision: number         // projection.revision the run computes over
  optionsDigest: string    // §5
  status: "queued" | "running" | "completed" | "cancelled" | "failed"
  progress: { stage: DrcStage | "queued" | "pour"; index: number; total: number;
              fraction: number; violationsSoFar: number }
  startedAt: string        // ISO, when created
  finishedAt?: string
  summary?: DrcReport["summary"]   // completed only
  error?: string                   // failed only
  cancelReason?: "user" | "superseded" | "design-deleted" | "shutdown"
}
```

Transitions, and who drives them:

| From | To | Driver | Persists |
|---|---|---|---|
| — | `queued` | `start(designId)` (routes, SDK, cloud apply) | nothing |
| `queued` | `running` | the single worker becomes free (FIFO across designs) | nothing |
| `queued` / `running` | `cancelled` | explicit cancel (route), supersede (§5), design deleted (§3), shutdown | nothing |
| `running` | `completed` | the worker posts `done` and the head still exists | the `designer_drc_results` row, ONE synchronous upsert (§3) |
| `running` | `failed` | the worker posts `error`, crashes, cannot be spawned, or the upsert throws | nothing |

`completed`, `cancelled` and `failed` are terminal. A terminal run is retained in memory for
`RUN_RETENTION_MS = 600_000` and then dropped; `GET /runs/:runId` on a dropped run is 404. The
report itself is never part of the run record — `GET /designs/:id/drc` serves the persisted row.

**What a waiting caller receives.** `runAndWait(designId)` — the SDK, `POST /drc/run` and the
cloud apply sites — resolves with the report of the run it joined, *or of the run that superseded
it* (a superseded caller is re-attached to the newer run, §5). It rejects only on an explicit
user cancel (`DrcRunCancelledError`), `design-deleted`, `shutdown` or `failed`. It never resolves
with a partial report.

## 2. The worker

The engine runs on ONE persistent `node:worker_threads` worker per backend process
(`src/shared/drc/worker/`):

- `drc-worker.ts` — the entry. Receives `{ type: "run", runId, projection, rawFootprints,
  cancel: SharedArrayBuffer }`, rebuilds `lookupRawFootprint` (§2.2), calls
  `runDrc(projection, { lookupRawFootprint, tick })` and posts `{ type: "done", runId, report }`,
  `{ type: "cancelled", runId }` or `{ type: "error", runId, message, stack }`. Progress is
  posted as `{ type: "progress", runId, stage, index, total, violationsSoFar }` from `tick`,
  throttled to one message per `PROGRESS_MIN_MS = 50` (the first and the last tick of every stage
  always post). The worker never touches a database and imports nothing outside
  `src/shared/**` and `src/sdks/**` types.
- `drc-worker-client.ts` — the main-thread owner. `run(input, { signal, onProgress }) →
  Promise<DrcReport>`; spawns lazily on first use; serialises runs (one at a time, FIFO);
  respawns after `terminate()` or a crash; `disposeDrcWorker()` terminates it (tests call it in
  `afterAll`; Electron's `closeCurrentRuntime` calls it before `runtime.close()`).
  `setDrcWorkerEntry(url)` overrides the entry (§2.1); `setDrcWorkerFactoryForTesting(factory)`
  substitutes the transport for lifecycle tests (§8).
- `protocol.ts` — the message types above.

### 2.1 Entry resolution (the one bundler-aware seam)

| Runtime | Entry | Why |
|---|---|---|
| Bun (`npm run dev`, `bun test`, Playwright `chromium`) | `new URL("./drc-worker.ts", import.meta.url)` | Bun transpiles a `.ts` worker entry natively (spike, §8) |
| tsup bundle, no override | `new URL("./drc-worker.js", import.meta.url)` | in the bundle `import.meta.url` is defined to the bundle entry's own URL, so this is `dist/main/drc-worker.js` |
| Electron dev (`npm run dev:electron`) | `setDrcWorkerEntry(dist/main/drc-worker.js)` from `backend-server.ts` | explicit; `wait-on` also waits for the file |
| Electron packaged | `setDrcWorkerEntry(<resources>/app.asar.unpacked/dist/main/drc-worker.js)` | `asarUnpack` lists `dist/main/drc-worker.js*`; a worker entry inside the archive is not relied on |

The worker is a **fourth tsup config** (`electron/tsup.config.ts`, placed after the main config,
`clean: false`, the same `banner` / `format` / `platform` / `target` / `define`, `external:
["electron", "better-sqlite3", "electron-updater"]`). A spawn failure (missing file, bad path)
ends the run `failed` with the error message; it never throws out of the service.

### 2.2 The clone boundary

The worker input is exactly `{ projection, rawFootprints }`:

- `projection` — the `DesignerPcbProjection` the route loaded. Structured clone preserves float
  bits, `-0`, `NaN`, `±Infinity`, `undefined`-valued own properties and property order; the
  engine never mutates the projection (the frontend already shares one projection object
  between the live context and React).
- `rawFootprints: [footprintId, data][] | null` — the Map behind `buildRawFootprintLookup`'s
  closure, or `null` when that helper returns `undefined` (no library module, no footprint
  ids). The worker rebuilds the SAME value: `undefined` for `null`, a Map-backed function
  otherwise. (`courtyard.ts:322` treats "no lookup" and "lookup returning null" alike, but the
  worker reproduces the exact value rather than rely on it.)

Nothing else crosses: suppressions, severity overrides and the broad-phase mode keep defaulting
inside `runDrc` from the projection (05 §8, 08 §3), exactly as the in-thread entry points do.
`stats` and `tick` are worker-local. The report returns by structured clone and the service
persists `drcOptionsFromProjection(projection)` on the main thread, so `optionsJson` is
byte-identical to the pre-S10 row.

### 2.3 Runtime facts established by the WP0 spike (2026-09-09, Bun 1.3, this machine)

- A `node:worker_threads` `Worker` with a `.ts` entry runs under Bun; the worker sees the `Bun`
  global.
- An `Int32Array` over a `SharedArrayBuffer` passed in `workerData` is visible to the worker
  mid-loop (`Atomics.load`); a flag set by the parent cancelled a busy loop within one check
  interval.
- `parentPort.postMessage` from a busy (never-yielding) worker is delivered to the parent while
  the worker keeps running: two progress messages arrived at 644 ms into a 2 s busy loop, and
  120 main-thread 5 ms timer ticks fired during a 669 ms run.
- **`worker.unref()` does NOT let a Bun process exit** while the worker is alive — the spike
  process hung until killed. Explicit `terminate()` is the shutdown path (`disposeDrcWorker`).
- Spawn + import of the real engine: 20 ms (13 ms of it the worker's own import). Byte identity
  held on all six goldens and the 10k synthetic board. Clone overhead: ≤ 0.8 ms on the goldens
  (20–30 KB projections, 9–25 KB reports); 50 ms on the 10k board (2.0 MB projection, 6.3 MB
  report) against a 223 ms run.

## 3. Cancellation and "no partial persistence"

Cancellation is **cooperative first, hard second**:

1. The client sets the shared flag (`Atomics.store(flag, 0, 1)`). The engine reads it in `tick`
   (§6) — before every stage of `drcDrafts` and before every zone of `ensurePourResults` — and
   throws `DrcCancelledError`; the worker catches it, posts `cancelled` and stays alive for the
   next run. A throw abandons the whole per-run context: every engine cache is per-context
   closure state (`drc-context.ts`: placement extents, copper items, connectivity, pour results)
   or a per-call `WeakMap` (`broad-phase.ts`), so nothing leaks into the next run on the same
   worker. The one module-level mutable in the graph is the log-only `warned` flag in
   `copper-geometry-kernel.ts` — it differs between a reused and a respawned worker and affects
   no output.
2. If neither `cancelled` nor `done` arrives within `CANCEL_GRACE_MS = 250`, the client calls
   `worker.terminate()` and respawns on the next run. This is the runaway-kernel case: one pour
   zone is indivisible (04 §13) and can only be stopped by terminating the thread.

Why nothing partial is ever persisted: persistence is main-thread only, happens once, after
`done`, and the three checks before it — run not cancelled, run not superseded, design head
exists — and the upsert are all synchronous in one tick (`saveDrcResult` is a synchronous Drizzle
call under both drivers). No `await` separates the checks from the write. A cancel that lands
after the write is a no-op on a `completed` run. A run whose design was deleted while it ran
ends `cancelled (design-deleted)` instead of hitting the FK on `designer_design_heads`; any
other persistence error ends the run `failed` with the message. Every run promise is settled
inside the service — nothing can surface as an unhandled rejection in Electron's main process.

A worker crash (`error` event, exit without `done`) fails the current run, drops the queued
runs of that worker back to `queued`, and respawns; the next `start` proceeds normally.

## 4. Progress and partial results

Progress is **counts only**. `progress = { stage, index, total, fraction, violationsSoFar }`,
where `stage` walks the exported `DRC_STAGES` order (§6) plus the per-item labels `pour` (per
zone) and `copperShapeUnit` (per copper-shape unit and per erosion, S12 — contract 11 §5.5) and
`queued`;
`index / total` are the stage index over 17 stages, or the zone index inside `pour`; `fraction`
is `(stageIndex + zoneFraction) / 17`; `violationsSoFar` is the draft count so far. No partial
violation list is returned, streamed or persisted. The previous stored report stays what
`GET /drc` serves until the new one replaces it in one upsert; the view shows it dimmed as
"previous run" while a run is active (§7).

A completed run's report is the report of its `revision`. If the design moved while the run
executed, the row is still written (correct for that revision) and the existing stale banner
(`report.revision !== projection.revision`) applies; there is no auto re-run.

## 5. Concurrency

- **One worker, FIFO across designs.** Runs of different designs queue in creation order.
- **Per design, at most one non-terminal run.** The join key is `(revision, optionsDigest)`
  with `optionsDigest = sha1(JSON.stringify({ ...drcOptionsFromProjection(projection),
  severityOverrides: board.drcSeverityOverrides ?? null }))`. A `start` whose key equals the
  active run's **joins** it (same `runId`, `202` with `status` as is). A `start` with a
  different key **supersedes** it: the active run is cancelled with reason `superseded`, its
  waiters are re-attached to the new run, and the new run is queued. (View-state suppressions
  are written by the `pcb_set_view_state` command and therefore bump `revision` — the digest is
  insurance, not the mechanism.)
- **No interaction with command dispatch.** A run computes over a projection snapshot cloned
  into the worker; commands keep dispatching on the main thread; the report's `revision` says
  what it describes. The legality gate inside command dispatch is unchanged (07 §6).
- **SSE subscribers never drive the run.** A stream disconnect unsubscribes; it does not cancel.

## 6. Determinism

The report is a pure function of `(projection, lookupRawFootprint)` — no `Date`, environment,
locale or randomness anywhere under `src/shared/drc` — and the worker runs the identical code on
an identical clone, so:

```
JSON.stringify(await runOnWorker(P, R)) === JSON.stringify(runDrc(P, { lookupRawFootprint: R }))
```

is asserted on the six goldens, the determinism fixture, three corpus boards and an
empty-`rawFootprints` fixture (§8). The only engine change is `DrcOptions.tick`, read by `drcDrafts`
and by `buildDrcContext` (no context field — the seam is two call sites): `drcDrafts` iterates the exported `DRC_STAGES`
table — the same 17 checks in the same order the spread expression ran them, pinned by a test
on the stage list, not only on report bytes — calling `tick(stage, i, 17)` before each; and
`ensurePourResults` runs its zones in a loop with `tick("pour", i, n)` before each, and since S12
`checks/copper-shape.ts` ticks `tick("copperShapeUnit", i, n)` per unit and per erosion through
`ctx.tick` (the same `DrcOptions.tick` seam, forwarded by the context). `tick`
never reads or writes a draft. The S9 oracle harness (goldens in both modes, corpus, fixture
reversals) is the regression for the seam. No intra-check ticks exist: at 10k primitives every
check is ≤ 50 ms, so stage granularity bounds cancel latency at about that, and the pour is the
only stage that needed finer grain.

## 7. Consumers

| Consumer | Path | Behaviour after S10 |
|---|---|---|
| DRC tab "Run DRC" (`DesignerDrcView`) | `POST /drc/runs` → SSE `/runs/:id/stream` → `GET /drc` | progress bar + Cancel; previous report dimmed while running; poll fallback on stream error |
| PCB toolbar / status chip | store `run` | spinner while a run is active; counts from the stored report |
| Export dialog pre-export gate (`PcbExportDialog`) | `POST /drc/run` (unchanged) | needs a report, not progress; may wait behind another design's run on the single worker (its "Running DRC…" state covers it) |
| `usePcbWorkspace.runDrc` | `POST /drc/run` (unchanged) | as above |
| SDK `runDrc` — assistant `designer_run_drc`, MCP `openpcb://design/{id}/drc`, proposal apply | `runAndWait` | joins an active run; resolves with the report; `null` for a missing design AND for a run cancelled under the caller (the proposal apply reads it after a committed change) |
| Cloud apply ×3 | `runAndWait` via `drcAfterApply` | post-apply report, never gating: a run cancelled or superseded under the caller yields `null`, never a failed request for a committed board change |
| `drc-entry-point-parity.test.ts` | SDK vs route | still byte-equal (both are `runAndWait`) |

Routes (designer module):

| Route | Response |
|---|---|
| `POST /designs/:id/drc/runs` | `202 { runId, revision, status }` — start or join |
| `GET /designs/:id/drc/runs/:runId` | `200 { runId, revision, status, progress, summary?, error?, cancelReason? }`; 404 when dropped |
| `POST /designs/:id/drc/runs/:runId/cancel` | `202 { runId, status }`; idempotent; terminal runs unchanged |
| `GET /designs/:id/drc/runs/:runId/stream` | SSE: the current state replayed as the first frame, then `run.progress`, `run.completed { summary }`, `run.cancelled { reason }`, `run.failed { message }`; closes on terminal; loopback, no token, CORS as every other route |
| `POST /designs/:id/drc/run` | `200 { report }` — unchanged contract, now `runAndWait` |
| `GET /designs/:id/drc` | unchanged |

Core HTTP: the request `AbortController` also fires when the RESPONSE closes before it finished
(`outgoing.on("close")` with `!writableFinished`), not only on the deprecated `aborted` event, so
an SSE handler learns of a client disconnect on both runtimes. The request's own `close` is NOT
used: it fires as soon as a body-carrying request has been read, which would pre-abort every
POST's signal (R2 #2; verified on Bun 1.4 and Node 22 with a real socket).

## 8. Tests and numbers

- `drc-worker-client.test.ts` — bytes identical to `runDrc` (goldens ×6, the determinism
  fixture, three corpus boards, empty `rawFootprints`); progress monotone and stage-ordered;
  cancel via the flag → `cancelled`, worker reused; stalled worker (fake factory) → terminate +
  respawn; crash → `failed` + respawn; spawn failure → `failed`; **loop freedom**: while the 10k
  synthetic board runs, ≥ 5 `setTimeout(10)` ticks fire, an in-process `GET /api/health`
  resolves, and a `run.progress` SSE frame is received — all before the run promise resolves.
- `drc-run-service.test.ts` — join returns the same `runId`; supersede cancels the old run and
  the joined caller resolves with the new report; FIFO across designs; design deleted mid-run →
  `cancelled (design-deleted)`, no row, no unhandled rejection; SSE replay on a late connect and
  unsubscribe on disconnect; the SDK and the three cloud apply sites go through the service.
- `drc-audit-b5.test.ts` — **B5-SYNC**, two legs (honesty, R2 #10: leg (a)'s held fake worker
  proves the LIFECYCLE — the route returned, a command dispatched while the run reported
  `running`, the persisted row is the worker's report unmodified, a cancel persists nothing;
  it is leg (b) that proves the bytes with the real worker, and the off-thread claim itself
  rests on the loop-freedom test above): (a) lifecycle with a held fake worker —
  `POST /drc/runs` 202; a `dispatchCommand` completes while `GET /runs/:id` reports `running`;
  release → `completed`; `GET /drc` bytes equal `runDrc(projection)`; cancel → `cancelled` and
  no row; (b) the real worker on the census golden design — 202, terminal `completed`, bytes
  equal.
- The S9 suites unchanged: goldens byte-identical in both modes, six shasums equal to the S9
  close, `git diff src/shared/drc/checks` empty.
- Frontend: the store state machine under a fake transport (start / progress / complete /
  cancel / fail / supersede / join); one Playwright spec (`pcb-drc.spec.ts`).
- Electron: `npm run build --workspace electron` emits `dist/main/drc-worker.js`; a Node smoke
  spawns it on a golden and matches the expected bytes.

Numbers (this machine, Bun 1.4, WP3 measurement; the §2.3 spike agrees):

| board | projection / report | clone (both ways) | in-thread `runDrc` | warm worker, end to end |
|---|---|---|---|---|
| `golden-small-2l` … `golden-rules-2l` | 21–29 KB / 8–24 KB | 0.2–0.7 ms | census 12.5 ms · areas 24.8 ms · pours 89.1 ms | census 13.4 ms · areas 34.1 ms · pours 112.6 ms |
| synthetic 10 000 (seed 1) | 1 995 KB / 6 275 KB | 41.4 ms | 176.8 ms | 255.1 ms (78 ms overhead, 41 of it the clone) |

Spawn + engine import: 22.5 / 12.6 / 11.8 ms over three spawns; the worker is persistent, so this
is paid once per process and once per respawn after a terminate or a crash.

## 9. Stated limits

- The frontend copper fill and the live legality context run on the renderer's main thread; a
  Web Worker for `CopperFillLayer` / `CopperPour` is a separate filing.
- Gerber export, the cloud `BoardSnapshot` pours and `pcb_cleanup_pour_traces` (a fixed-point
  fill loop inside a write transaction) stay synchronous; the cleanup command needs a
  command-level redesign, filed as its own item.
- Pour kernel budgets and arrangement-size cliffs stay open (04 §13); S10 makes a runaway zone
  cancellable, not bounded.
- **The commit-gate context memo (07 §9) is retired.** `legalityFor` builds the context from
  the before-snapshot rows of each copper envelope; a memo keyed by `(designId, baseRevision)`
  cannot hit on a sequence of successful commits because every applied command advances the
  revision — it would hit only after a refused or failed command. The saving is incremental
  context maintenance, which is not execution placement.
- One worker; no pool sizing; runs of different designs serialise.
- No run history table; runs are in-memory records with a retention window.
- No auto re-run on change.
- The `rawFootprints` transfer is not cached across runs (benched; §8).
- The packaged asar-unpacked entry is exercised only by the electron Playwright project, which
  is not in the standard gate; the Node smoke on the built bundle stands in for it.
- `worker.unref()` is not relied on (§2.3); shutdown is explicit (`disposeDrcWorker` from
  Electron's `stopBackendServer` / `closeCurrentRuntime`, from `afterAll` in every test file that
  spawns the real worker, and from the designer module's SIGTERM hook).
- `electron/tsup.config.ts` builds its configs concurrently while config[0] `clean: true`s
  `dist/`; the observed order is safe (the clean logs before any write) but it is a latent race
  shared by every `clean: false` bundle, pre-existing, not introduced here.
- The Node smoke on the built worker needs a projection JSON dumped by Bun (the golden loader is
  TypeScript); the one-liner is in the script header. Not wired into CI.
- The worker client's queue is unbounded; admission (one non-terminal run per design, §5) is the
  service's job, and every caller goes through the service.
- The standalone Bun backend (`bun main.ts`) does not exit on SIGTERM whether or not a worker is
  alive — pre-existing (R1 verified with a no-worker control); the designer module's SIGTERM
  hook still disposes the worker. Any `bun run` script that imports the client must call
  `disposeDrcWorker()` or it never exits.
- `electron/` now imports one thing from `src/shared/`: the worker entry override + dispose
  (`CLAUDE.md` layering diagram updated).
- A run id is addressable only under its own design (the four run routes 404 otherwise).
- Progress frames are throttled (`PROGRESS_MIN_MS`): a fast pour stage posts its first, last and
  some middle zones, never necessarily every zone; a consumer must not count frames.

## 10. Amendments

`PROGRAM.md` (S10 row, exit-gate evidence, decisions) · `docs/drc/OPEN_FINDINGS.md` (B5-SYNC
closed by `drc-audit-b5.test.ts`) · `TODO.md` §5 (S10 closed; P7 "sync at ≤ 2 000, else 202"
retired; the 136 ms → 195.5 ms drift) · 04 §13 (the DRC run's pour is off-thread and
cancellable; the other three sites unchanged) · 07 §9 (memo retired) · 08 §9 (memo line) ·
`src/modules/designer/AGENTS.md` · `electron/AGENTS.md` (four bundles; the asar-unpacked worker)
· `CLAUDE.md` tree (`shared/drc/worker/`) · the hardening skill's `scope-and-invariants.md` ·
memory.

## 11. Review ledger

- Plan-critique (Opus, 2026-09-09): 17 findings — 3 blockers (the fourth tsup entry needs the
  banner / `clean: false` / order; the B5-SYNC seeding was quadratic and its liveness assertion a
  race; a deleted design mid-run hit the FK in an unawaited path), 7 majors (`req.signal` only on
  `aborted`; `dev:electron` wait-on; asar; the clone boundary described from options no entry
  point builds; the join key; `runAndWait` under supersede; two more `api.runDrc` consumers),
  7 minors (stage-boundary ticks only; the cache argument; the `undefined` equivalence; clone
  cost; two verification lines; SSE in the loop-freedom test; reuse). All folded.
- R1 (`reviewer-critical`, WP2 + WP3, 2026-09-10): the seam and the client held under 25
  adversarial tests (the pre-S10 spread reconstructed and compared draft by draft on the goldens,
  both modes and the corpus; `pourResults()` bytes against a `git archive f6ffb7c` build; queued
  cancel, abort during spawn, dispose with in-flight + queued runs, throwing `onProgress`, 100
  sequential runs → one spawn and no listener growth, a fresh `SharedArrayBuffer` per run,
  duplicate terminal messages, late `done` inside the grace window, the 10 s ready timeout,
  `structuredClone` round-trips on the goldens, the 10k board and a real `loadPcbProjection`
  output). Findings: 2 majors — (1) tsup's `clean: true` on the main config wiped every sibling
  bundle on each watch rebuild (reproduced: `dist/main/drc-worker.js` gone after one
  `src/main/**` edit), fixed by removing `clean` from every config and cleaning once in the
  electron `build` script; (2) the Node smoke compared sorted ids and was wired to nothing —
  rewritten to compare report BYTES against a Bun-computed reference and wired as
  `npm run test:drc-worker-smoke` + a CI step. 5 minors fixed: the stage test now pins the
  label→function pairing by name; `dropWorker` rejects a pending `ready`; the loop-freedom
  test's progress assertion now requires two distinct stages before resolve; the client's
  queue admission is documented as the service's; `electron/AGENTS.md` bundle order. Recorded,
  not changed: the loop-freedom test leaks a runtime (`bun test` force-exits); the standalone
  Bun backend never exited on SIGTERM before this session either (control run); `before-quit`
  fires `stopBackendServer` without awaiting (pre-existing); `electron/` now imports the worker
  entry override from `src/shared/` (layering diagram updated).
- R2 (`reviewer`, WP4 + WP5, 2026-09-10): the state machine, the persistence boundary (no
  `await` between the head check and the upsert; the row before `notify`), join / supersede /
  FIFO, the cross-design 404s, the 409 problem, the SSE wire format over a REAL socket (frames
  incremental, disconnect unsubscribes and does not cancel) all held under direct probing.
  Findings: 2 majors — (1) the frontend controller never re-attached to an in-flight run after
  the conditionally-mounted DRC view remounted (button stuck on "Running…", report never
  fetched) → the controller now re-opens the stream for an active run of its design on
  construction and detaches an active run of another design; (2) `incoming.on("close")`
  pre-aborted every body-carrying request's signal (the request's `close` fires once the body is
  read) → gated on the response closing unfinished. 2 mediums: the SDK propagated a cancelled
  run into the assistant's proposal apply after a committed change → `null` like the cloud
  sites; `dispose()` racing an in-flight `start` left a run `queued` forever → re-checked after
  the await. 5 minors: `/drc/runs` maps a disposed start to the 409; the dead
  `resetDrcRunServiceForTesting` removed; one SIGTERM hook per process; coverage (poll
  exhaustion, terminal join, the 409, dispose race, the e2e pinned to the 202 of `/drc/runs`);
  the autolayout apply summary distinguishes "DRC not run" from a clean board. Test honesty
  recorded in §8.
- Astra / Codex: not run (user decision 2026-09-09: program default).
