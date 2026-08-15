#!/bin/bash
# Multiplayer Sync Verification Script

echo "=== GloKarts Multiplayer Synchronization Fix Verification ==="
echo ""
echo "Checking service status..."
echo ""

# Check frontend
if lsof -i :5173 > /dev/null 2>&1; then
    echo "✓ Frontend (Vite) running on port 5173"
else
    echo "✗ Frontend (Vite) NOT running on port 5173"
fi

# Check backend
if lsof -i :8000 > /dev/null 2>&1; then
    echo "✓ Backend (Django) running on port 8000"
else
    echo "✗ Backend (Django) NOT running on port 8000"
fi

# Check realtime
if lsof -i :2567 > /dev/null 2>&1; then
    echo "✓ Realtime (Colyseus) running on port 2567"
else
    echo "✗ Realtime (Colyseus) NOT running on port 2567"
fi

echo ""
echo "=== Critical Fix Applied ==="
echo ""
echo "File: frontend/src/multiplayer-editor3-main.js"
echo "Lines: 1753-1759"
echo "Change: proj.px/py/pz → proj.x/y/z"
echo ""
echo "This fix ensures projectiles render at correct positions"
echo "instead of being positioned at (0, 0, 0)."
echo ""

# Check if fix is in place
if grep -q "mesh.position.set(proj.x || 0, proj.y || 0, proj.z || 0)" frontend/src/multiplayer-editor3-main.js; then
    echo "✓ Fix verified in source code"
else
    echo "✗ Fix NOT found in source code"
fi

echo ""
echo "=== Testing Instructions ==="
echo ""
echo "1. Open TWO browser tabs:"
echo "   - Tab 1: http://localhost:5173/"
echo "   - Tab 2: http://localhost:5173/"
echo ""
echo "2. Both players join multiplayer race"
echo ""
echo "3. Test item pickup:"
echo "   - Drive within 16m of item box"
echo "   - Item should flash and play sound on BOTH screens"
echo ""
echo "4. Test weapon firing:"
echo "   - Press E to fire secondary weapon"
echo "   - Projectile should be visible in Player 2's view"
echo "   - Ammo counter should decrease"
echo ""
echo "5. Test player sync:"
echo "   - Drive around track"
echo "   - Remote player should move smoothly on other screen"
echo "   - No teleporting or jerky movement"
echo ""
echo "6. Test collision:"
echo "   - Projectile hits player"
echo "   - Both players see knockback effect"
echo "   - Hit flash and screen shake triggers on both clients"
echo ""
