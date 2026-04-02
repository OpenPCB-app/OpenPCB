# OpenPCB Architecture Plan

## 1. Purpose, Scope, Goals

This document defines the target architecture for OpenPCB.

It is intentionally focused on **architecture direction** and **system boundaries**, not historical cleanup work.

### Scope

- Runtime architecture (React + Bun + Rust/Tauri)
- Dependency boundaries and contract ownership
- Internal module model and capability surface
- Routing direction for future evolution
- Architecture risk register and mitigation roadmap

### Goals

1. Preserve the current three-layer runtime and browser-first development flow.
2. Harden the frontend/backend contract boundary.
3. Keep modules internal, capability-isolated, and operable without process sandboxing.
4. Reduce generated-contract drift and make generation ownership explicit.
5. Incrementally reduce high-coupling areas without functional regressions.

### Non-Goals

- No major runtime redesign (no layer collapse, no sidecar removal).
- No public plugin ABI/API compatibility promise for external module authors yet.
- No process-level sandboxing for modules in this phase.

---

## 2. Runtime Architecture

### Three-Layer Runtime (Target to Preserve)

```
┌─────────────────────────────────────────────────────────────────┐
│                   React Frontend (Vite :1420)                  │
│  UI Components ─ Stores ─ Hooks ─ API Adapters ─ Canvas/Editor │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│                  Bun Sidecar (dynamic port)                    │
│  Transport ─ Domain Services ─ Infrastructure ─ SQLite/Drizzle │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Bridge IPC (namespace routing)
┌──────────────────────────▼──────────────────────────────────────┐
│                     Rust Tauri Shell                            │
│  Bridge Router ─ Sidecar Runtime ─ Secrets Vault ─ Native APIs │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

#### React Frontend (`src-react/`)

- Application UI, interaction state, editor UX, and route-driven composition.
- Consumes shared contracts and generated clients.
- Should avoid dependency on backend implementation internals.

#### Bun Sidecar (`src-ts/`)

- Primary business-domain runtime and API surface.
- Owns HTTP/WS contracts, orchestration, persistence, and module host runtime.
- Generates contracts consumed by frontend and integrations.

#### Rust Tauri Shell (`src-tauri/`)

- Native process host, sidecar management, secure secret storage, update/runtime integration.
- Provides narrow bridge APIs for native/bootstrap concerns.

### Browser-First Policy

Primary development target is browser mode (`npm run dev`).
Desktop mode remains for native integration verification, not day-to-day feature development.

---

## 3. Known Architectural Risks

### P1 — Frontend/Backend Boundary Leakage

**Problem:** frontend currently imports some backend implementation-level modules.

**Impact:** refactor blast radius expands; backend internal changes can break frontend unexpectedly.

**Mitigation target:** frontend consumes only shared contract surfaces (`shared/types`, `shared/sdk`, `shared/generated`) and frontend-owned adapters.

### P1 — Generated Contract Drift

**Problem:** multiple generated outputs can drift semantically when generation and checks are not aligned.

**Impact:** stale SDK/bridge types, compile-time/runtime contract mismatch, fragile releases.

**Mitigation target:** one canonical generated contract surface for frontend consumers and strict generation checks in CI.

### P1 — Module Isolation Ambiguity

**Problem:** architecture language can be interpreted as sandboxed modules, while runtime model is capability isolation in-process.

**Impact:** inconsistent design assumptions and incorrect security/containment expectations.

**Mitigation target:** explicitly define internal, same-process, capability-isolated module model and capability boundaries.

### P2 — High-Coupling Service/State Areas

**Problem:** some stores/services are large and aggregate multiple concerns.

**Impact:** harder reasoning, testing, and low-risk refactoring.

**Mitigation target:** incremental decomposition by concern boundaries (state session, persistence, orchestration, formatting, etc.).

### P2 — Transitional Routing Model

**Problem:** route parsing/serialization/state ownership are currently coupled to custom hash handling.

**Impact:** complex navigation behavior, weaker route contracts, harder long-term scale.

**Mitigation target:** adopt a real router later with centralized route model and typed route contracts.

### P3 — Documentation Drift

**Problem:** architecture docs with manual inventory counts become stale quickly.

**Impact:** reduced trust in architecture documentation.

**Mitigation target:** avoid fragile count-heavy sections unless auto-generated.

---

## 4. Target Architecture Invariants

### 4.1 Runtime Invariant

OpenPCB keeps the three-layer runtime:

- React frontend for UI and interaction orchestration.
- Bun sidecar for domain workflows and API contracts.
- Rust/Tauri shell for native host lifecycle and secure local capabilities.

### 4.2 Frontend Contract Invariant

Frontend must consume contracts via shared surfaces only:

- `src-ts/shared/types`
- `src-ts/shared/sdk`
- `src-ts/shared/generated`

Frontend must not depend on backend implementation internals under `src-ts/src/**`.

### 4.3 Bridge Scope Invariant

Rust bridge remains intentionally narrow:

- sidecar/runtime status/bootstrap
- secrets/native secure storage
- native host concerns

Domain workflows and business data exchanges should use Bun HTTP/WS contracts.

### 4.4 Module Invariant

Modules are:

- internal-only
- same-process
- capability-isolated via context (`ctx.*`)

Modules are not process-sandboxed in this phase.

Raw DB access through module-scoped handles is allowed by policy.

### 4.5 Codegen Invariant

`src-ts/shared/generated/**` is the canonical generated contract surface for frontend consumers.

Generation and validation must run consistently so generated artifacts match runtime contracts.

### 4.6 Routing Invariant

Current custom hash routing is transitional.

OpenPCB will adopt a real router later, with:

- centralized route definitions
- typed route parameters/state
- deterministic parse/serialize behavior

### 4.7 Decomposition Invariant

Architecture evolution should progressively reduce multi-concern units.

Refactoring should extract clear collaborators rather than growing aggregate services/stores.

---

## 5. Dependency and Contract Ownership

| Area | Owner | Allowed Dependencies | Forbidden Dependencies | Source of Truth |
| --- | --- | --- | --- | --- |
| Frontend (`src-react`) | UI layer | shared contracts, frontend adapters/components | `src-ts/src/**` backend internals | Shared contracts + frontend adapters |
| Bun Transport (`src-ts/src/transport`) | API layer | domain services, shared contract types | frontend code | Transport controllers + OpenAPI |
| Bun Domain (`src-ts/src/domain`) | Business layer | kernel/infrastructure/db abstractions | frontend imports | Domain service contracts |
| Module Runtime (`modules/*/ts`) | Internal extension layer | module context capabilities, module db, shared types | implicit global/core reach-through beyond declared capabilities | Module manifest + ModuleContext |
| Tauri Shell (`src-tauri`) | Native host | bridge runtime, secrets, sidecar lifecycle | Bun domain/business logic | Rust bridge + runtime code |
| Generated Contracts | Codegen pipeline | generated outputs consumed by frontend/backend | manual edits in generated files | `npm run gen` + CI checks |

### Contract Authority

- Shared DTO/type authority: `src-ts/shared/types`
- HTTP client authority: generated SDK artifacts
- Bridge type authority: Specta + bridge generation pipeline

---

## 6. Module Architecture (Internal Extension System)

### Module Model

- Internal extension system for OpenPCB product evolution.
- Same-process execution in Bun runtime.
- Capability-oriented integration through module context.

### Capability Rules

- Module APIs should rely on explicit capabilities exposed through context.
- Capability surface should stay minimal and explicit.
- Cross-module and module-core coupling should be intentional, documented, and test-covered.
- Capabilities are declared in manifest via `coreCapabilities` and enforced by host context shaping.

### Data Access Policy

- Module-scoped DB handle is first-class and supported.
- Raw DB access is allowed where required by module implementation.
- Table naming/prefix conventions and module-owned migrations remain mandatory.
- Raw DB access can be explicitly controlled per module through `db.rawAccess`.

### Compatibility Policy

- Internal compatibility only at this stage.
- External/public module API stability is not guaranteed.

---

## 7. Routing and UI Composition Strategy

### Current State

- Custom hash-based routing coordinates screen transitions.
- Route parsing and navigation state are currently implementation-coupled.

### Target State

- Adopt a real router later.
- Move to centralized route definitions with typed contracts.
- Keep screen ownership explicit, including module-hosted spaces.
- Ensure route parsing/serialization lives in one authoritative implementation.

### Migration Constraints

- Avoid behavior regressions during transition.
- Keep deep-link compatibility where practical.
- Prioritize deterministic navigation behavior over rapid API churn.

---

## 8. Architecture Roadmap (Risk-First)

### Phase 1 — Boundary Hardening

- Remove frontend imports of backend implementation internals.
- Route frontend usage through shared contracts and frontend-owned adapters.

### Phase 2 — Codegen Unification

- Ensure shared generated contracts are canonical for frontend consumption.
- Align generation outputs and CI checks to prevent semantic drift.

### Phase 3 — Module Contract Clarity

- Document and enforce capability-isolated internal module model.
- Keep raw DB policy explicit and module-scoped.

### Phase 4 — Routing Modernization

- Introduce real router incrementally.
- Centralize route schema and route-state ownership.

### Phase 5 — Decomposition of High-Coupling Units

- Incrementally split large stores/services by concern boundaries.
- Improve testability and replacement cost of key orchestration paths.

---

## 9. Verification Matrix

### Contract and Type Integrity

1. `npm run gen`
2. `npm run gen:check`
3. `npm run typecheck`

### Backend Integrity

1. `cargo check --manifest-path src-tauri/Cargo.toml`
2. `npm run test:ts`

### Frontend Integrity

1. `npm run test:react`
2. `npx tsc -p src-react/tsconfig.json --noEmit`

### Runtime and End-to-End Integrity

1. `npm run dev`
2. `npm run test:e2e`

### UI Verification Requirement

All UI-affecting changes require Playwright-based verification.

---

## 10. Success Criteria

The architecture plan is considered successfully executed when:

1. Frontend contract boundaries are enforced in practice.
2. Generated artifacts are consistently aligned with runtime contracts.
3. Module model language and implementation expectations are consistent.
4. Routing has a clear migration path to a real router.
5. High-coupling areas show measurable decomposition progress without functional regressions.
