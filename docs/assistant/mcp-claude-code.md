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

43 tools with writes enabled, 22 with writes disabled (write tools are not registered at all when
"Allow writes" is off). The authoritative list is `tools/list` against a running app; the
`assistant-mcp-parity.test.ts` and `mcp-claude-code-setup.test.ts` suites pin it down (every tool
a plugin skill names must exist).

Conventions shared by every tool:

- **Targeting.** Tools that act on a design accept an optional `designId`. Without one, the
  design is the connection's pin (`designer_use_design`), else the design focused in the OpenPCB
  window, else the connection's last design (the result carries a warning saying so).
- **Units and addressing.** Millimetres at the tool boundary, stored as integer nanometres.
  Parts by reference designator (`U1`), pins and pads as `REF.PIN` / `REF.PAD`, nets by name —
  net ids are ephemeral and never cross the MCP boundary.
- **Results.** Every result has `{ok, status, summary, warnings, error, proposal, data}` in
  `structuredContent` and the same information as text, because Claude Code forwards only the
  structured half and Claude Desktop only the text half.
- **Idempotency.** Write tools take an optional `action_id`; a repeat with the same id returns the
  original proposal instead of applying twice.

### 3.1 The in-app Assistant's 15 tools (parity, projected 1:1)

| Tool | Kind |
|---|---|
| `library_search_components`, `library_get_component_detail`, `library_resolve_bom` | read |
| `designer_resolve_design`, `designer_get_design_summary`, `designer_get_part_detail`, `designer_get_schematic_connectivity` | read |
| `designer_create_design` | write |
| `compile_circuit`, `designer_place_components` | write (auto-applies, undoable) |
| `designer_propose_schematic_edits`, `designer_propose_schematic_wires`, `designer_propose_schematic_updates`, `designer_arrange_schematic` | write (auto-applies, undoable) |
| `designer_propose_schematic_deletions` | write — **waits for approval** |

### 3.2 MCP-only reads and parity tools

| Tool | Purpose |
|---|---|
| `designer_list_designs`, `designer_use_design` | discover designs; pin this session to one |
| `designer_get_pcb_state`, `designer_get_pcb_layout` | PCB summary; full geometry for placement and routing |
| `designer_run_erc`, `designer_run_drc`, `designer_get_bom` | checks and bill of materials |
| `designer_export_manufacturing` | manufacturing bundle manifest (nothing is written to disk) |
| `designer_get_history` | shared undo/redo state |
| `designer_verify_build` | the in-app Definition-of-Done verifier, run against the intent captured from the last `library_resolve_bom` / `compile_circuit` |
| `knowledge_search_pages`, `knowledge_get_page` | the user's OpenPCB Docs pages (same content an @mention gives the in-app assistant) |
| `assistant_get_proposal`, `assistant_list_pending_proposals`, `assistant_await_proposal` | follow a proposal waiting in the panel; `await` long-polls up to 240 s and returns `pending` on timeout |

### 3.3 MCP-only writes (PCB, board, rules, design management)

| Tool | Approval tier |
|---|---|
| `pcb_place_footprints` — move / rotate / flip by reference | auto-applies, undoable |
| `pcb_route` — traces through waypoints + vias, per net, one atomic commit, refused if it breaks legality | auto-applies, undoable |
| `pcb_set_board_outline` | auto-applies, undoable |
| `pcb_set_drc_waivers` | auto-applies, undoable |
| `pcb_manage_zone`, `pcb_manage_keepout` — add / update | auto-applies, undoable |
| `pcb_manage_zone`, `pcb_manage_keepout` — delete; `pcb_delete_routing` | **waits for approval** |
| `pcb_set_design_rules` — clearances, net classes, net → class | **waits for approval** (not undoable) |
| `designer_rename_design`, `designer_focus_design` | applies immediately |
| `designer_delete_design` | **waits for approval** (irreversible) |
| `designer_undo`, `designer_redo` | applies; refuses unless the entry on top of the stack was made by this client, and — when `expectedRevision` is given — unless the design is still at that revision |

Every applied PCB write reports the DRC violation count afterwards. New net classes must carry
explicit values: the tool never invents manufacturing constants.

### 3.4 Also exposed

- **Server instructions** (≤ 2,000 chars): targeting, write rules, approvals, "verify after
  every build".
- **Prompts:** `openpcb-review-schematic`, `openpcb-drc-triage`, `openpcb-bom-check`, and — only
  with writes on — `openpcb-build-circuit` (for clients without the plugin's skills).
- **Resources:** `openpcb://design/{designId}/{schematic|pcb|bom|erc|drc}` and
  `openpcb://knowledge/{pageId}` Docs pages.

### 3.5 Deliberately not exposed

Writing export files to disk, library authoring (component wizard, symbol/footprint editors,
KiCad import), cloud features (sync, auto-layout, cloud library) and app settings. Approving or
rejecting a proposal is never an MCP operation.

---

## 4. User guide

### 4.1 Requirements

- OpenPCB desktop, running. The agent talks to the open app; tool calls fail with
  "OpenPCB is not running" while it is closed (the connection itself stays up and recovers when
  the app starts).
- Claude Code (<https://code.claude.com>) signed in with your Claude subscription. Claude Desktop
  and other MCP clients work through the same server; only the one-click setup is Claude
  Code-specific.

### 4.2 Connect (one click)

1. OpenPCB → **Settings → Assistant → MCP server · Claude Code**.
2. Tick **Enable MCP server**. Tick **Allow writes from MCP clients** too if the agent should
   edit designs; leave it off for read-only use (inspect, ERC/DRC, BOM, Docs).
3. Click **Connect Claude Code**. OpenPCB finds your `claude` CLI and installs the **OpenPCB
   plugin** for every project: the MCP server plus workflow skills. **MCP server only**
   registers just the tools. **Details** under the result shows every `claude` command that ran.
4. Restart open Claude Code sessions (or run `/mcp`). `claude mcp list` should show OpenPCB as
   connected.

The plugin's skills (invoke with `/openpcb:<skill>` or let Claude pick them):

| Skill | Use it to |
|---|---|
| `openpcb-build-circuit` | design a circuit from a description — resolve parts, place, wire, verify |
| `openpcb-review-schematic` | review connectivity and ERC without changing anything |
| `openpcb-drc-triage` | triage DRC violations by root cause, most severe first |
| `openpcb-bom-check` | find BOM rows that would block ordering or assembly |
| `openpcb-pcb-layout` | outline → placement → routing → pours → DRC |
| `openpcb-connection-help` | troubleshoot a missing or failing connection |

After an OpenPCB update the panel shows **Update plugin**; click it so Claude Code picks up the new
tools and skills (Claude Code keeps its own copy of installed plugins).

### 4.3 Connect by hand

**Set up by hand** in the same panel shows the exact commands for your machine. They point at a
launcher OpenPCB rewrites on every start, so they stay valid when the app moves or updates:

```sh
# plugin (recommended)
claude plugin marketplace add "<app data>/claude-code/marketplace"
claude plugin install openpcb@openpcb-desktop --scope user

# or the MCP server only
claude mcp add --scope user openpcb -- "<app data>/mcp/openpcb-mcp"          # macOS / Linux
claude mcp add --scope user openpcb -- cmd /c "<app data>\mcp\openpcb-mcp.cmd" # Windows
```

`--scope user` matters: without it Claude Code registers the server for the current directory
only. Claude Desktop gets a JSON block for `claude_desktop_config.json`. **Advanced: direct HTTP
endpoint** exists for clients that cannot spawn a process; its port and token change on every
launch, so prefer the launcher.

### 4.4 Working with it

- **Which design?** Claude works on the design focused in OpenPCB unless you name one, or it pins
  one with `designer_use_design`. Each Claude Code session keeps its own pin.
- **Seeing the work.** The canvas refreshes as Claude edits. Each design gets an
  "MCP · Claude Code" chat in the assistant dock that logs every call.
- **Approvals.** Deletions, design-rule and net-class changes, and deleting a design stop at an
  approval card in the assistant panel. Claude waits (`assistant_await_proposal`) and continues
  after you approve or reject. "Allow this tool this session" on a card works as it does in-app.
- **Undo.** Claude's edits land in the same undo history as yours: Ctrl+Z in OpenPCB undoes them.
  Claude can undo only its own most recent change, never yours.
- **Not supported over MCP:** see §3.5.

### 4.5 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Tools say "OpenPCB is not running" | Start OpenPCB; the connection recovers by itself. |
| "The MCP server is disabled" | Settings → Assistant → **Enable MCP server**. |
| Write tools missing | **Allow writes from MCP clients** is off. Clients are told the tool list changed; restart the session if yours does not refresh. |
| "Connect" says Claude Code was not found | Install Claude Code, or run the **Set up by hand** commands in a terminal where `claude` works. |
| A macOS warning about a temporary location | OpenPCB is running from the disk image or Downloads. Move it to Applications and reopen it. |
| Tools listed twice | Both the plugin and a plain `openpcb` server are registered. **Connect Claude Code** removes the plain one, or run `claude mcp remove openpcb --scope user`. |
| Stale skills after an update | Click **Update plugin**. |

Diagnostics: `claude mcp get openpcb`, the **Connected clients** list in Settings, and Claude
Code's debug output (`claude --debug`) for MCP connection errors.

### 4.6 Security

The server listens on loopback only, requires a per-launch bearer token that only processes
running as you can read (`<app data>/mcp.json`, mode 0600), and is off until you enable it.
Treat enabling writes like giving a local program edit access to your designs: anything that can
run as your user can use it. Destructive changes still need your approval in the app.

### 4.7 Platform notes and known limits

- The launcher runs OpenPCB's own binary as Node (`ELECTRON_RUN_AS_NODE`), so no system Node is
  needed. That relies on Electron's `RunAsNode` fuse staying enabled; if it is ever turned off,
  the launcher falls back to a system `node`.
- AppImage and the portable Windows build are handled by pointing the launcher at `$APPIMAGE` /
  `%PORTABLE_EXECUTABLE_FILE%`. Whether those wrappers pass `ELECTRON_RUN_AS_NODE` through was
  not verified on real builds at the time of writing; the `node` fallback covers a failure.
- Very long operations are kept alive with progress heartbeats every 10 s; Claude Code's own
  per-call limits still apply.
