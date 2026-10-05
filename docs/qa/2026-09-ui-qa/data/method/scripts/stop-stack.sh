#!/bin/bash
# usage: stop-stack.sh <A|B|C1|C2> [frontend|backend|all]
QA="$(cd "$(dirname "$0")/.." && pwd)"
S=$1; what=${2:-all}
case $S in A) BP=3100; VP=1520;; B) BP=3200; VP=1620;; C1) BP=3300; VP=1720;; C2) BP=3300; VP=1721;; esac
kill_port() { for pid in $(lsof -tiTCP:$1 -sTCP:LISTEN -n -P 2>/dev/null); do kill $pid 2>/dev/null; done; }
if [ "$what" = all ] || [ "$what" = frontend ]; then [ -f "$QA/env/pids/vite-$S.pid" ] && pkill -P $(cat "$QA/env/pids/vite-$S.pid") 2>/dev/null; kill $(cat "$QA/env/pids/vite-$S.pid" 2>/dev/null) 2>/dev/null; kill_port $VP; rm -f "$QA/env/pids/vite-$S.pid"; fi
if [ "$what" = all ] || [ "$what" = backend ]; then [ -f "$QA/env/pids/backend-$S.pid" ] && pkill -P $(cat "$QA/env/pids/backend-$S.pid") 2>/dev/null; kill $(cat "$QA/env/pids/backend-$S.pid" 2>/dev/null) 2>/dev/null; kill_port $BP; rm -f "$QA/env/pids/backend-$S.pid"; fi
sleep 1; echo "stopped $S $what"
