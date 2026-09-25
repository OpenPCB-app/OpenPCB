---
name: openpcb-connection-help
description: Troubleshoot the connection between Claude Code and the OpenPCB desktop app — tools missing, "OpenPCB is not running", MCP disabled, writes unavailable, stale results. Use when OpenPCB tools fail or are not listed.
---

# OpenPCB connection help

The `openpcb` MCP server is a bridge to the OpenPCB desktop app on this computer. It stays connected
even while the app is closed and picks the app up again when it starts.

| Symptom | Cause | What the user should do |
|---|---|---|
| Tool results say "OpenPCB is not running" | The app is closed | Start OpenPCB; the tool list refreshes by itself |
| "MCP server is disabled" | Setting off | OpenPCB → Settings → Assistant → MCP → Enable MCP server |
| Only read tools are listed | Writes off | Settings → Assistant → MCP → Allow writes |
| "does not serve MCP" / update message | Old OpenPCB build | Update OpenPCB |
| "OpenPCB is no longer at …" from the launcher | App moved or reinstalled | Start OpenPCB once; it rewrites the launcher |
| A proposal stays pending | Waiting for approval | Approve or reject it in OpenPCB's assistant panel (design dock) |

Other facts:

- Every tool call appears in OpenPCB's assistant panel in a chat named "MCP · <client> · <design>".
- The user can undo any change you applied with Ctrl+Z in OpenPCB.
- In OpenPCB's Settings → Assistant → MCP the user can see connected clients and reconnect Claude Code.
