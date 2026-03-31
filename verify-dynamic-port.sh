#!/bin/bash
# Verification script for dynamic port configuration

echo "=== Dynamic Port Configuration Verification ==="
echo ""

# Check if Bun is running
echo "1. Checking if Bun is running..."
BUN_PIDS=$(ps aux | grep "bun --watch" | grep -v grep | awk '{print $2}')
if [ -z "$BUN_PIDS" ]; then
    echo "   ❌ Bun is not running"
    exit 1
else
    echo "   ✅ Bun is running (PIDs: $BUN_PIDS)"
fi

# Check what port Bun is listening on
echo ""
echo "2. Checking Bun's listening port..."
BUN_PORTS=$(lsof -i -P -n | grep bun | grep LISTEN | awk '{print $9}' | cut -d: -f2 | sort -u)
if [ -z "$BUN_PORTS" ]; then
    echo "   ❌ Cannot detect Bun's port"
    exit 1
else
    echo "   ✅ Bun is listening on port(s): $BUN_PORTS"
    # Check if any port is 3000 (should NOT be)
    if echo "$BUN_PORTS" | grep -q "^3000$"; then
        echo "   ⚠️  WARNING: Bun is on port 3000 (should be dynamic)"
    else
        echo "   ✅ Port is NOT 3000 (good - dynamic allocation working)"
    fi
fi

# Check if Vite is running
echo ""
echo "3. Checking if Vite is running..."
VITE_PIDS=$(ps aux | grep "vite" | grep -v grep | awk '{print $2}')
if [ -z "$VITE_PIDS" ]; then
    echo "   ❌ Vite is not running"
    exit 1
else
    echo "   ✅ Vite is running (PIDs: $VITE_PIDS)"
fi

# Test health endpoint on discovered port
echo ""
echo "4. Testing health endpoint..."
for PORT in $BUN_PORTS; do
    echo "   Testing http://localhost:$PORT/api/health..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/health)
    if [ "$RESPONSE" = "200" ]; then
        echo "   ✅ Health check passed on port $PORT"
    else
        echo "   ❌ Health check failed on port $PORT (HTTP $RESPONSE)"
    fi
done

echo ""
echo "=== Verification Steps for Manual Testing ==="
echo ""
echo "1. Open browser DevTools console"
echo "2. Look for these log messages:"
echo "   - [BackendURL] Received backend-ready event: {url: \"http://localhost:XXXXX\", port: XXXXX}"
echo "   - [SDK] Updated API_BASE to: http://localhost:XXXXX"
echo ""
echo "3. Check Network tab:"
echo "   - All /api/* requests should go to http://localhost:XXXXX (NOT 3000)"
echo "   - No CORS errors"
echo "   - No 404 errors"
echo ""
echo "4. Check application loading:"
echo "   - Should see 'Connecting to backend...' screen first"
echo "   - Then 'Loading OneMind...' screen"
echo "   - Then main UI"
echo ""
echo "5. Verify workspaces and projects load correctly"
echo ""
