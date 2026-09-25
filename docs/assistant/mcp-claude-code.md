# OpenPCB × Claude Code (MCP) — review, architecture and user guide

> Goal: someone who installs OpenPCB can use **Claude Code** — and therefore the Claude
> subscription they already pay for — as the agent for anything the in-app Assistant can do,
> and for PCB work the in-app Assistant cannot do yet.
>
> This file records the review that started the hardening program (§1), the architecture it
> produced (§2), the tool surface (§3), and the user guide (§4). Operational rules that code
> must respect stay in `CLAUDE.md` (MCP section); this is the long-form reasoning and the
> user-facing documentation.

---

## 1. Review (September 2026, before hardening)

The review was done against `master` at `63e90ea`. Every finding below was verified in code.

### 1.1 Blockers — Claude Code could not be used by an installed-app user

| # | Finding | Evidence |
|---|---|---|
| B1 | `mcp.server` was `availability: "dev"`. Packaged builds run with `NODE_ENV=production`, so `/api/modules/assistant/mcp` was never registered — while Settings still showed the toggles and copy-paste commands, and Electron still wrote the portfile. Users got a 404 behind a working-looking UI. | `core/contracts/feature-flags/registry.ts`, `assistant/backend/routes.ts`, `AssistantPanel.tsx` |
| B2 | Tool results lost information. `content` carried only the one-line `summary`; `structuredContent` carried only `modelData`, so warnings and error messages were dropped and a failing read returned the text `"null"`. Claude Code (≥ 2.1.27x) forwards **only** `structuredContent` to the model when both are present; Claude Desktop reads only `content`. | `mcp/tool-projection.ts` |
| B3 | MCP tool calls were never persisted as chat messages or tool events. The panel renders proposal cards only from tool events, so a deletion Claude Code proposed had **no approval card anywhere**, and the proposal id was never returned to the client. | `mcp/tool-projection.ts`, `run-service.ts`, `MessageCard.tsx` |
| B4 | There was no backend→frontend design change stream. The designer only refreshes after in-app assistant runs, so the canvas and history went stale while Claude Code edited. | `designer/frontend/Space.tsx` (`handleAssistantDesignChanged`) |
| B5 | `designer_create_design` refuses once the chat is bound, and the projection re-bound the one MCP chat on every design-targeted call — so Claude Code could not create a design after its first design call. | `designer-tools.ts`, `mcp/session.ts` |
| B6 | Setup was fragile: the advertised shim path lives inside the app bundle (moves for AppImage, the portable Windows build and translocated macOS apps); Windows `.cmd` files cannot be spawned without `cmd /c`; the snippet used `local` scope (one project only); the HTTP snippet embedded a per-launch token and port; the shim read the portfile once, exited if the app was down, went dead after an app restart, and reported upstream failures only on stderr so the client hung. | `electron/src/main/diagnostics-ipc.ts`, `McpSection.tsx`, `electron/src/mcp-shim/index.ts` |

### 1.2 Hardening findings

- **H1** Every shim client sent the same client key, so Claude Code, Claude Desktop and every
  concurrent Claude Code session shared one chat, one pinned design and one run counter.
- **H2** Tool annotations: the destructive set was hardcoded; `idempotentHint` was claimed for
  every write although `action_id` is optional; `designer_use_design` claimed read-only while
  re-binding the chat.
- **H3** No progress notifications and no cancellation; Claude Code aborts idle HTTP tool calls
  after 5 minutes.
- **H4** `designer_export_manufacturing` pointed the model at a resource that does not exist.
- **H5** The per-mode registry cache was never invalidated; `McpEndpoint.close()` was never
  called; the session map was never evicted.
- **H6** MCP chat creation required an in-app LLM provider row — irrelevant to an external agent.
- **H7** The portfile was not written atomically and could overwrite a live instance's file;
  the token comparison leaked length.
- **H8** No `list_changed`: toggling "allow writes" never reached connected clients.

### 1.3 Parity gaps with the in-app Assistant

- **P1** The Definition-of-Done verifier (`verification/run-dod.ts`) and BuildIntent capture
  run only inside the in-app loop.
- **P2** The grounding rules reached MCP clients only through optional prompts — nothing in the
  server `instructions`.
- **P3** Knowledge pages are reachable in-app through @mentions, not over MCP.
- **P4** Proposal approve/reject had no MCP counterpart.
- **P5** Cancellation.

The PCB side had **no** write tools at all (none of the ~40 `pcb_*` commands was projected), so
"any action" was schematic-only.

### 1.4 External facts that shaped the design

- `@modelcontextprotocol/server` 2.0.0 implements the 2026-07-28 spec. `createMcpHandler`
  serves 2025-era clients **statelessly** (a fresh server per POST, no `Mcp-Session-Id`, GET and
  DELETE answer 405). Per-connection state therefore cannot come from the transport.
- Claude Code truncates server `instructions` and each tool description at 2,048 characters,
  caps MCP output at 25k tokens by default (per-tool `_meta["anthropic/maxResultSizeChars"]`
  raises it), and supports `list_changed`.
- `claude mcp add` defaults to `local` scope (one project); `--scope user` applies everywhere.
- Claude Code copies installed plugins into its own cache; a local-directory marketplace must be
  refreshed with `claude plugin marketplace update` + `claude plugin update`.

---

## 2. Architecture

```
Claude Code ──stdio──► openpcb-mcp launcher   (<userData>/mcp/, rewritten on every app launch)
                         └─ resilient stdio proxy (shim)
                              · answers initialize/ping itself — works while OpenPCB is closed
                              · re-reads mcp.json on every failure → survives app restarts
                              · synthesizes notifications/*/list_changed
                              · x-openpcb-mcp-instance header per process
                                   │ Streamable HTTP POST + per-launch bearer token
                                   ▼
OpenPCB backend  /api/modules/assistant/mcp      (stateless per request)
   ├─ McpConnectionRegistry
   │     client  → one "home" chat (never bound) + one chat per design (bound once, never rebound)
   │     instance→ pinned design, last design, lastSeen (idle eviction)
   ├─ tool projection → result envelope · call recorder (message + tool event) · signal/progress
   ├─ registries: in-app 15 (unchanged) + MCP-only reads + parity tools + expansion writes
   └─ events: designer revision bus ─SSE─► canvas refresh
              assistant chat bus    ─SSE─► panel refresh (approval cards appear live)
```

The operational contract (endpoint, auth, identity headers, chat model, tool registration rules)
is in `CLAUDE.md` → *MCP server*.

---

## 3. Tool surface

Filled in as the hardening phases land; the authoritative list is `tools/list` against a
running app with writes enabled.

---

## 4. User guide

Filled in with the setup UX (see Phase 7 of the hardening plan).
