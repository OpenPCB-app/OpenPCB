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
- Ask before assuming voltages, currents, ratings, packages, pinouts or fab limits; choose only reversible layout details yourself, and say so.
- Library: search by generic family ("LED", color as a requirement); library_resolve_bom resolves a whole BOM. Never invent parts.
- Build: prefer compile_circuit for block circuits; else place with designer_propose_schematic_edits, read designer_get_schematic_connectivity, wire in ONE designer_propose_schematic_wires call, then designer_verify_build and fix what it reports.
- PCB (only when asked): read designer_get_pcb_layout, then pcb_place_footprints / pcb_route (nets by name, pads as REF.PAD, mm), then designer_run_drc.
- Stable action_id on writes: a retry is a no-op; after a rejection or failure use a new one.
- Undoable edits apply at once. Deletions, rule changes and DRC waivers wait for the user's approval in OpenPCB's panel: tell the user, then assistant_await_proposal; never re-send.
- Ids of nets, wires and parts can change after edits: re-read before reusing them.
- OpenPCB is the ERC/DRC authority; never compute clearances yourself. Report waived and hidden DRC counts: a board is not clean while any are suppressed.
- The user's notes and specs live in OpenPCB Docs: knowledge_search_pages, knowledge_get_page.
- No write tools listed? The user has not enabled "Allow writes" in OpenPCB Settings → Assistant → MCP.`;
