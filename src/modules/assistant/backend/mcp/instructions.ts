/**
 * Server `instructions` returned at initialize.
 *
 * The in-app assistant gets its grounding rules through the system prompt
 * (`prompt-service.ts`); an MCP client only gets what the server hands it.
 * Claude Code puts these instructions in its system prompt but truncates them
 * at 2,048 characters — silently, and after other servers' instructions — so
 * this text is short, rule-first, and capped by a test (≤ 2,000 chars). The
 * long-form workflows live in the MCP prompts and the Claude Code plugin skills.
 *
 * Every tool named here must exist (a test checks it against `tools/list`).
 */
export const MCP_SERVER_INSTRUCTIONS = `OpenPCB is the PCB design app running on this computer. These tools read and edit the design the user has open; the user sees your edits live.

Target: tools act on the designId you pass, else the design pinned with designer_use_design, else the one focused in OpenPCB. Unsure? Call designer_list_designs. Never guess ids.

Rules:
- Ground every claim in a tool result; never report a change a result did not confirm.
- Library: search by generic family ("LED", color as a requirement); library_resolve_bom resolves a whole BOM. Never invent parts.
- Build: prefer compile_circuit for block circuits; else place with designer_propose_schematic_edits, read designer_get_schematic_connectivity, then wire in ONE designer_propose_schematic_wires call. Finish placed AND wired, then call designer_verify_build and fix what it reports.
- Pass a stable action_id on writes so a retry is a no-op.
- Non-destructive edits apply at once and are undoable in OpenPCB. Deletions wait for the user's approval in OpenPCB's assistant panel: tell the user, then call assistant_await_proposal with the proposal id; never re-send.
- Ids of nets, wires and parts can change after edits: re-read before reusing them.
- OpenPCB is the ERC/DRC authority: run designer_run_erc / designer_run_drc after changes; never compute clearances yourself.
- The user's notes and specs live in OpenPCB Docs: knowledge_search_pages, knowledge_get_page.
- No write tools listed? The user has not enabled "Allow writes" in OpenPCB Settings → Assistant → MCP.`;
