#!/usr/bin/env bash
# post-deploy-smoke.sh — Quick smoke check after deployment
# Usage: ./post-deploy-smoke.sh [FRONTEND_URL] [REALTIME_URL]
#
# Defaults to local dev URLs if no arguments provided.

set -euo pipefail

FRONTEND="${1:-http://localhost:5173}"
REALTIME="${2:-http://localhost:2567}"

PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expect="$3"

  if curl -sf --max-time 10 "$url" | grep -q "$expect"; then
    echo "  [PASS] $label"
    ((PASS++))
  else
    echo "  [FAIL] $label ($url)"
    ((FAIL++))
  fi
}

echo "=== TwistedKart Post-Deploy Smoke ==="
echo "Frontend: $FRONTEND"
echo "Realtime: $REALTIME"
echo ""

echo "-- Frontend checks --"
check "Lobby page loads"        "$FRONTEND/"            "GLO KARTS"
check "Game page loads"         "$FRONTEND/game.html"   "canvas"
check "Battle page loads"       "$FRONTEND/battle.html" "canvas"

echo ""
echo "-- Realtime checks --"
check "Health endpoint"         "$REALTIME/health"      '"ok":true'

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
