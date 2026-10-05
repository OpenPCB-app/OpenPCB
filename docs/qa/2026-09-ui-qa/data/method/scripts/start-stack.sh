#!/bin/bash
# usage: start-stack.sh <A|B|C1|C2>   (C2 = prod preview; run build:frontend first)
set -uo pipefail
QA="$(cd "$(dirname "$0")/.." && pwd)"
R=/Users/andrejvysny/workspace/openpcb/OpenPCB
S=$1
case $S in
  A) BP=3100; VP=1520; DATA=A ;;
  B) BP=3200; VP=1620; DATA=B ;;
  C1) BP=3300; VP=1720; DATA=C ;;
  C2) BP=3300; VP=1721; DATA=C ;;
  *) echo "bad stack"; exit 1 ;;
esac
DB="$QA/data/$DATA/openpcb.sqlite"
ORIGINS="http://127.0.0.1:$VP,http://localhost:$VP,http://127.0.0.1:$BP,http://localhost:$BP"
for p in $(seq 1530 1539); do ORIGINS="$ORIGINS,http://127.0.0.1:$p,http://localhost:$p"; done
# backend
if ! lsof -iTCP:$BP -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  BE_ENV=(HOST=127.0.0.1 PORT=$BP OPENPCB_DB_PATH="$DB" OPENPCB_BUNDLED_LIBRARY_PATH="$R/resources/core-library" OPENPCB_ALLOWED_ORIGINS="$ORIGINS")
  if [ "$S" = "C2" ]; then
    BE_ENV+=(NODE_ENV=production)
    for f in CLOUD_DESIGNBROWSER CLOUD_PRESENCE CLOUD_COMMENTS CLOUD_LIBRARY CLOUD_COMPONENTSEARCH CLOUD_ASSISTANTPROVIDERS PCB_ADVANCEDVIAS PCB_ROUTEAUTOFINISH PCB_ROUTEWALKAROUND PCB_LENGTHTUNING PCB_BUNDLEROUTING MCP_SERVER DATASET_CAPTURE; do BE_ENV+=(OPENPCB_FEATURE_$f=0); done
  else
    BE_ENV+=(NODE_ENV=development)
  fi
  if [ "$S" = "A" ] || [ "$S" = "B" ]; then BE_ENV+=(OPENPCB_FEATURE_CLOUD_AUTH=0); fi
  (cd "$R/src/core/backend" && env "${BE_ENV[@]}" nohup bun --watch main.ts > "$QA/logs/backend-$S.log" 2>&1 & echo $! > "$QA/env/pids/backend-$S.pid")
  for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$BP/api/health" >/dev/null && break; sleep 1; done
  curl -sf "http://127.0.0.1:$BP/api/health" >/dev/null || { echo "backend $S failed to start"; tail -20 "$QA/logs/backend-$S.log"; exit 1; }
  BPID=$(lsof -tiTCP:$BP -sTCP:LISTEN -n -P | head -1)
  if [ "$(lsof -p "$BPID" 2>/dev/null | grep -c "$QA/data/$DATA/openpcb.sqlite")" = "0" ]; then
    echo "ABORT: backend $S not using isolated DB"; kill "$BPID"; exit 2
  fi
  echo "backend $S up on $BP (pid $BPID, db $DB)"
fi
# frontend
if ! lsof -iTCP:$VP -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  FE_ENV=()
  case $S in
    A|B) FE_ENV+=(VITE_FEATURE_CLOUD_AUTH=0) ;;
    C1|C2) FE_ENV+=(VITE_CLOUD_API_URL=http://127.0.0.1:9 VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_CLOUD_COPILOT_URL=http://127.0.0.1:9 VITE_CLOUD_WEB_URL=http://127.0.0.1:9 VITE_DEV_CLOUD_EMAIL= VITE_DEV_CLOUD_PASSWORD=) ;;
  esac
  if [ "$S" = "C2" ]; then
    for f in CLOUD_DESIGNBROWSER CLOUD_PRESENCE CLOUD_COMMENTS CLOUD_LIBRARY CLOUD_COMPONENTSEARCH CLOUD_ASSISTANTPROVIDERS PCB_ADVANCEDVIAS PCB_ROUTEAUTOFINISH PCB_ROUTEWALKAROUND PCB_LENGTHTUNING PCB_BUNDLEROUTING MCP_SERVER DATASET_CAPTURE; do FE_ENV+=(VITE_FEATURE_$f=0); done
    (cd "$R/src/core/frontend" && env "${FE_ENV[@]}" nohup npx vite preview --config "$QA/vite/vite.$S.config.mts" > "$QA/logs/vite-$S.log" 2>&1 & echo $! > "$QA/env/pids/vite-$S.pid")
  else
    (cd "$R/src/core/frontend" && env "${FE_ENV[@]}" nohup npx vite --config "$QA/vite/vite.$S.config.mts" > "$QA/logs/vite-$S.log" 2>&1 & echo $! > "$QA/env/pids/vite-$S.pid")
  fi
  for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$VP/" >/dev/null && break; sleep 1; done
  curl -sf "http://127.0.0.1:$VP/api/health" >/dev/null && echo "frontend $S up on $VP (proxy ok)" || { echo "frontend $S proxy FAILED"; tail -30 "$QA/logs/vite-$S.log"; exit 3; }
fi
