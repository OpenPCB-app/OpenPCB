# OpenPCB plugin for Claude Code (template)

This directory is the template OpenPCB turns into a local Claude Code plugin
marketplace at `<userData>/claude-code/marketplace/` on every launch
(`electron/src/main/claude-plugin.ts`). The generated copy adds
`.claude-plugin/plugin.json` (version = the app version) and `.mcp.json`
(pointing at this machine's stable `openpcb-mcp` launcher), so the skills here
always ship with — and describe — the tool set of the installed app.

Tool names in the skills are the MCP tool names the OpenPCB server lists;
`assistant-mcp-plugin.test.ts` fails if a skill names a tool that does not
exist.
