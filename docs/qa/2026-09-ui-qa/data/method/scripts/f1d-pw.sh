#!/bin/bash
# usage: f1d-pw.sh <session> <cmd> [args...]  — prints only Result/Error sections
cd /private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/f18aac79-e8af-4eed-b528-c505e87cbf8a/scratchpad/qa
s="$1"; shift
out=$(playwright-cli -s="$s" "$@" 2>&1)
echo "$out" | awk '/^### Result/{p=1} /^### Ran Playwright code/{p=0} /^### Error/{p=1} /^### Page/{p=0} /^### Snapshot/{p=1} /^### Events/{p=1} p' | grep -v '^```' | head -n ${PW_LINES:-40}
