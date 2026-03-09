#!/usr/bin/env python3
"""
start-local-multiplayer.py — Local multiplayer testing harness for GLO KARTS.

Starts the Colyseus realtime server and Vite frontend dev server, waits for
them to come online, then launches a Playwright-driven two-browser lobby test:
  - Browser 1 creates a private party
  - Browser 2 joins via the party code
  - Both players ready up, host starts match
  - Both arrive on realtime.html, join Colyseus room, reach matchLive
  - Player sync is verified (playerCount >= 2 on both sides)
  - Results are printed; cleanup kills all child processes.

Usage:
    python start-local-multiplayer.py            # default: race mode
    python start-local-multiplayer.py --battle    # battle mode
    python start-local-multiplayer.py --headed    # show browsers (not headless)
    python start-local-multiplayer.py --skip-servers  # assume servers already running

Requirements:
    - Node.js / npm installed
    - Python 3.8+
    - Playwright installed: cd frontend && npx playwright install chromium
    - Ports 5173 (Vite) and 2567 (Colyseus) free

Django backend is NOT required for multiplayer gameplay (confirmed: no
frontend code references Django endpoints at runtime). Bypassed.

Existing infrastructure reused:
    - Bypassed: start-realtime.ps1 — referenced for npm run dev command in realtime/
    - Bypassed: start-backend.ps1  — Django not needed for multiplayer testing
    - Bypassed: playwright.config.js — reuse Chrome launch args for WebGL/SharedArrayBuffer
    - Bypassed: tests/helpers/game-helpers.js — existing PvP flow shows how __gloDebug works;
      we replicate the pattern here for lobby-based (not direct-connect) testing
    - Bypassed: tests/03-pvp-session.spec.js — tests direct room joins; we test the full
      lobby UI flow (create party → join by code → ready → start → matchLive)
"""

import argparse
import atexit
import json
import os
import platform
import signal
import subprocess
import sys
import textwrap
import time
import urllib.request
import urllib.error

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
REALTIME_DIR = os.path.join(ROOT_DIR, "realtime")

VITE_PORT = 5173
COLYSEUS_PORT = 2567
VITE_URL = f"http://localhost:{VITE_PORT}"
COLYSEUS_HEALTH = f"http://localhost:{COLYSEUS_PORT}/health"
LOBBY_URL = f"{VITE_URL}/index.html"

IS_WINDOWS = platform.system() == "Windows"

# Tracks child processes for cleanup
_child_procs: list[subprocess.Popen] = []

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
# Force UTF-8 output on Windows to avoid charmap encoding errors
if IS_WINDOWS:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def log(level: str, msg: str):
    ts = time.strftime("%H:%M:%S")
    prefix = {"INFO": "[INFO]", "OK": "[ OK ]",
              "WARN": "[WARN]", "FAIL": "[FAIL]",
              "STEP": "[STEP]"}
    tag = prefix.get(level, f"[{level}]")
    print(f"  {ts} {tag} {msg}", flush=True)

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────────────────────────────────────
def cleanup():
    """Kill all child processes on exit."""
    for proc in _child_procs:
        if proc.poll() is None:
            log("INFO", f"Stopping PID {proc.pid}...")
            try:
                if IS_WINDOWS:
                    # On Windows, subprocess trees need taskkill /T
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        capture_output=True,
                    )
                else:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
    log("INFO", "Cleanup complete.")

atexit.register(cleanup)

if not IS_WINDOWS:
    signal.signal(signal.SIGINT, lambda *_: sys.exit(1))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def run_bg(cmd: list[str], cwd: str, label: str) -> subprocess.Popen:
    """Start a background process with its own process group (for cleanup)."""
    log("INFO", f"Starting {label}: {' '.join(cmd)}")
    kwargs = dict(
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["preexec_fn"] = os.setsid

    proc = subprocess.Popen(cmd, **kwargs)
    _child_procs.append(proc)
    log("INFO", f"  → PID {proc.pid}")
    return proc


def wait_for_url(url: str, label: str, timeout: int = 60, interval: float = 1.5):
    """Poll a URL until it returns 200 or timeout expires."""
    log("INFO", f"Waiting for {label} at {url}...")
    deadline = time.time() + timeout
    last_err = ""
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    log("OK", f"{label} is ready.")
                    return True
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = str(e)
        time.sleep(interval)
    log("FAIL", f"{label} did not respond within {timeout}s (last error: {last_err})")
    return False


def npm_cmd():
    """Return the npm executable (npm.cmd on Windows)."""
    return "npm.cmd" if IS_WINDOWS else "npm"


def ensure_node_modules(directory: str, label: str):
    """Run npm install if node_modules is missing."""
    nm = os.path.join(directory, "node_modules")
    if not os.path.isdir(nm):
        log("INFO", f"Installing {label} dependencies...")
        subprocess.run([npm_cmd(), "install"], cwd=directory, check=True,
                       capture_output=True)
        log("OK", f"{label} deps installed.")


def ensure_playwright_browsers():
    """Ensure Playwright Chromium browser is installed."""
    log("INFO", "Ensuring Playwright Chromium is available...")
    result = subprocess.run(
        [npm_cmd(), "exec", "--", "playwright", "install", "chromium"],
        cwd=FRONTEND_DIR,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        log("WARN", f"Playwright install output: {result.stderr[:300]}")
    else:
        log("OK", "Playwright Chromium ready.")


# ─────────────────────────────────────────────────────────────────────────────
# Service startup
# ─────────────────────────────────────────────────────────────────────────────
def start_colyseus() -> subprocess.Popen:
    """Start the Colyseus realtime server (node --watch src/index.js)."""
    ensure_node_modules(REALTIME_DIR, "Colyseus realtime")
    # Use node directly (cross-platform) rather than npm run dev
    node = "node.exe" if IS_WINDOWS else "node"
    return run_bg(
        [node, "--watch", "src/index.js"],
        cwd=REALTIME_DIR,
        label="Colyseus server (:2567)",
    )


def start_vite() -> subprocess.Popen:
    """Start the Vite frontend dev server."""
    ensure_node_modules(FRONTEND_DIR, "Frontend")
    return run_bg(
        [npm_cmd(), "run", "dev"],
        cwd=FRONTEND_DIR,
        label="Vite dev server (:5173)",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Playwright browser automation — full lobby flow
# ─────────────────────────────────────────────────────────────────────────────
PLAYWRIGHT_SCRIPT = textwrap.dedent(r'''
    /**
     * local-multiplayer-test.mjs
     *
     * Playwright script that simulates two players using the full lobby UI:
     *   1. Player 1 opens lobby, selects mode, clicks "Create Party"
     *   2. Player 1 reads the party code from the UI
     *   3. Player 2 opens lobby, enters the party code, clicks "Join"
     *   4. Both players click "Ready Up"
     *   5. Host clicks "Start Match"
     *   6. Both are redirected to realtime.html
     *   7. Wait for Colyseus roomJoined + matchLive on both sides
     *   8. Verify player sync (playerCount >= 2)
     *
     * Exits with code 0 on success, 1 on failure.
     */
    import { chromium } from 'playwright';

    const LOBBY = process.env.LOBBY_URL || 'http://localhost:5173/index.html';
    const HEADED = process.env.HEADED === '1';
    const GAME_MODE = process.env.GAME_MODE || 'race';  // 'race' or 'battle'
    const TIMEOUT = 90_000;

    // Chrome flags matching playwright.config.js — needed for WebGL + SharedArrayBuffer
    const CHROME_ARGS = [
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--disable-software-rasterizer',
        '--enable-features=SharedArrayBuffer',
        '--no-sandbox',
    ];

    function log(tag, msg) {
        const ts = new Date().toLocaleTimeString();
        console.log(`  ${ts} [${tag}] ${msg}`);
    }

    async function waitForSelector(page, selector, opts = {}) {
        return page.waitForSelector(selector, { timeout: opts.timeout || 15_000, ...opts });
    }

    async function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // ── Main ─────────────────────────────────────────────────────────────────
    (async () => {
        log('INIT', `Mode: ${GAME_MODE}, Headed: ${HEADED}, Lobby: ${LOBBY}`);

        const browser = await chromium.launch({
            headless: !HEADED,
            args: CHROME_ARGS,
        });

        // Two separate browser contexts (like normal + incognito)
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();

        const errors1 = [];
        const errors2 = [];
        page1.on('pageerror', e => errors1.push(e.message));
        page2.on('pageerror', e => errors2.push(e.message));

        let exitCode = 0;

        try {
            // ── Step 1: Player 1 — open lobby ──────────────────────────────
            log('P1', 'Opening lobby...');
            await page1.goto(LOBBY, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await sleep(2000);  // let lobby JS init

            // ── Step 2: Player 1 — set name ────────────────────────────────
            const nameInput1 = await page1.$('#player-name-input');
            if (nameInput1) {
                await nameInput1.fill('');
                await nameInput1.type('Player-1');
                log('P1', 'Name set to Player-1');
            }

            // ── Step 3: Player 1 — select game mode ────────────────────────
            // Click the ONLINE category tab
            const onlineTab = await page1.$('#mode-category-tabs [data-cat="online"]');
            if (onlineTab) {
                await onlineTab.click();
                log('P1', 'Switched to ONLINE category');
                await sleep(500);
            }

            // Click the appropriate mode card
            const modeTarget = GAME_MODE === 'battle' ? 'battle_online' : 'race_online';
            const modeCard = await page1.$(`.mode-card[data-mode="${modeTarget}"]`);
            if (modeCard) {
                await modeCard.click();
                log('P1', `Selected mode: ${modeTarget}`);
                await sleep(500);
            }

            // ── Step 4: Player 1 — Create Party ────────────────────────────
            log('P1', 'Clicking Create Party...');
            await page1.click('#create-party-btn');

            // Wait for the party code to appear
            log('P1', 'Waiting for party code...');
            let partyCode = '';
            for (let i = 0; i < 30; i++) {
                await sleep(1000);
                const codeEl = await page1.$('#party-code');
                if (codeEl) {
                    const text = await codeEl.textContent();
                    if (text && text !== 'XXXXXX' && text !== '------' && text.length >= 4) {
                        partyCode = text.trim();
                        break;
                    }
                }
            }

            if (!partyCode) {
                log('FAIL', 'Could not read party code from P1 lobby. Colyseus server may be down.');
                // Check join status for error message
                const statusEl = await page1.$('#join-status');
                if (statusEl) {
                    const statusText = await statusEl.textContent();
                    if (statusText) log('FAIL', `Lobby status: ${statusText}`);
                }
                exitCode = 1;
                throw new Error('Party code not obtained');
            }
            log('P1', `Party code: ${partyCode}`);

            // ── Step 5: Verify P1 is in lobby (host-info visible) ─────────
            const hostInfo = await page1.$('#host-info:not(.hidden)');
            if (!hostInfo) {
                log('WARN', 'host-info panel not visible — might not be connected');
            } else {
                log('P1', 'Host panel visible — connected to Colyseus lobby.');
            }

            // ── Step 6: Player 2 — open lobby, join by code ───────────────
            log('P2', 'Opening lobby...');
            await page2.goto(LOBBY, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await sleep(2000);

            const nameInput2 = await page2.$('#player-name-input');
            if (nameInput2) {
                await nameInput2.fill('');
                await nameInput2.type('Player-2');
                log('P2', 'Name set to Player-2');
            }

            // Type party code and click Join
            log('P2', `Entering party code: ${partyCode}`);
            const joinInput = await page2.$('#join-code-input');
            if (joinInput) {
                await joinInput.fill(partyCode);
            }
            await page2.click('#join-party-btn');
            log('P2', 'Clicked Join...');

            // Wait for P2 to connect (join-status should show "Connected")
            for (let i = 0; i < 20; i++) {
                await sleep(1000);
                const statusEl = await page2.$('#join-status');
                if (statusEl) {
                    const text = await statusEl.textContent();
                    if (text && /connected/i.test(text)) {
                        log('P2', `Join status: ${text}`);
                        break;
                    }
                    if (text && /fail|error|not found|offline/i.test(text)) {
                        log('FAIL', `P2 join failed: ${text}`);
                        exitCode = 1;
                        throw new Error(`P2 join failed: ${text}`);
                    }
                }
            }

            // ── Step 7: Verify both players appear in lobby ───────────────
            await sleep(2000);

            const checkPlayerList = async (page, label) => {
                const items = await page.$$('#player-list li');
                log(label, `Players in lobby: ${items.length}`);
                return items.length;
            };

            const p1Count = await checkPlayerList(page1, 'P1');
            const p2Count = await checkPlayerList(page2, 'P2');

            if (p1Count < 2) log('WARN', 'P1 does not see 2 players in list');
            if (p2Count < 2) log('WARN', 'P2 does not see 2 players in list');

            // ── Step 8: Both click Ready Up ───────────────────────────────
            log('P2', 'Clicking Ready Up...');
            const readyBtn2 = await page2.$('#ready-btn:not(.hidden)');
            if (readyBtn2) {
                await readyBtn2.click();
                log('P2', 'Ready!');
            } else {
                log('WARN', 'P2 ready button not found or hidden');
            }
            await sleep(1000);

            // P1 (host) also readies up then starts
            log('P1', 'Clicking Ready Up...');
            const readyBtn1 = await page1.$('#ready-btn:not(.hidden)');
            if (readyBtn1) {
                await readyBtn1.click();
                log('P1', 'Ready!');
            }
            await sleep(1000);

            // ── Step 9: Host starts match ─────────────────────────────────
            log('P1', 'Clicking Start Match...');
            const startBtn = await page1.$('#start-match-btn:not(.hidden)');
            if (startBtn) {
                await startBtn.click();
                log('P1', 'Match starting...');
            } else {
                log('WARN', 'Start Match button not visible — checking if already in countdown...');
            }

            // ── Step 10: Wait for navigation to realtime.html ─────────────
            log('SYNC', 'Waiting for both players to reach realtime.html...');
            const waitForRealtime = async (page, label) => {
                for (let i = 0; i < 40; i++) {
                    await sleep(1000);
                    const url = page.url();
                    if (url.includes('realtime.html') || url.includes('/realtime')) {
                        log(label, `Arrived at ${url}`);
                        return true;
                    }
                }
                log(label, `Still at ${page.url()} after 40s`);
                return false;
            };

            const [nav1, nav2] = await Promise.all([
                waitForRealtime(page1, 'P1'),
                waitForRealtime(page2, 'P2'),
            ]);

            if (!nav1 || !nav2) {
                log('FAIL', 'Not all players reached realtime.html');
                exitCode = 1;
                throw new Error('Navigation timeout');
            }

            // ── Step 11: Wait for Colyseus room join + match live ─────────
            log('SYNC', 'Waiting for Colyseus room join and matchLive...');

            const waitForGloDebug = async (page, label, predicate, timeoutMs = TIMEOUT) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    try {
                        const result = await page.evaluate((pred) => {
                            const d = window.__gloDebug;
                            if (!d) return null;
                            return {
                                roomJoined: !!d.roomJoined,
                                matchLive: !!d.matchLive,
                                playerCount: d.playerCount || 0,
                                sessionId: d.sessionId || '',
                                startSequence: !!d.startSequence,
                            };
                        });
                        if (result && result[predicate]) {
                            log(label, `${predicate} = true (players: ${result.playerCount})`);
                            return result;
                        }
                    } catch { /* page may not be ready */ }
                    await sleep(1500);
                }
                log(label, `Timeout waiting for ${predicate}`);
                return null;
            };

            // Wait for both to join room
            const [join1, join2] = await Promise.all([
                waitForGloDebug(page1, 'P1', 'roomJoined', 30_000),
                waitForGloDebug(page2, 'P2', 'roomJoined', 30_000),
            ]);

            if (!join1 || !join2) {
                log('FAIL', 'Not all players joined Colyseus room');
                exitCode = 1;
                throw new Error('Room join timeout');
            }

            // Wait for matchLive
            const [live1, live2] = await Promise.all([
                waitForGloDebug(page1, 'P1', 'matchLive', 60_000),
                waitForGloDebug(page2, 'P2', 'matchLive', 60_000),
            ]);

            if (!live1 || !live2) {
                log('WARN', 'matchLive not reached on both sides — partial sync');
                // Still check what we got
            }

            // ── Step 12: Verify player sync ───────────────────────────────
            log('SYNC', '─── RESULTS ───');

            const getDebug = async (page) => {
                try {
                    return await page.evaluate(() => {
                        const d = window.__gloDebug || {};
                        return {
                            roomJoined: !!d.roomJoined,
                            matchLive: !!d.matchLive,
                            playerCount: d.playerCount || 0,
                            sessionId: d.sessionId || '',
                        };
                    });
                } catch {
                    return { roomJoined: false, matchLive: false, playerCount: 0, sessionId: '' };
                }
            };

            const final1 = await getDebug(page1);
            const final2 = await getDebug(page2);

            log('P1', `roomJoined=${final1.roomJoined} matchLive=${final1.matchLive} players=${final1.playerCount} session=${final1.sessionId}`);
            log('P2', `roomJoined=${final2.roomJoined} matchLive=${final2.matchLive} players=${final2.playerCount} session=${final2.sessionId}`);

            // Assertions
            let pass = true;

            if (!final1.roomJoined) { log('FAIL', 'P1 did not join room'); pass = false; }
            if (!final2.roomJoined) { log('FAIL', 'P2 did not join room'); pass = false; }
            if (!final1.matchLive)  { log('FAIL', 'P1 match not live');    pass = false; }
            if (!final2.matchLive)  { log('FAIL', 'P2 match not live');    pass = false; }
            if (final1.playerCount < 2) { log('FAIL', 'P1 sees < 2 players'); pass = false; }
            if (final2.playerCount < 2) { log('FAIL', 'P2 sees < 2 players'); pass = false; }

            if (final1.sessionId && final2.sessionId) {
                if (final1.sessionId === final2.sessionId) {
                    log('FAIL', 'Both players have same sessionId — not unique');
                    pass = false;
                } else {
                    log('OK', 'Session IDs are unique');
                }
            }

            // Check for critical JS errors
            const critFilter = (msg) =>
                !msg.includes('WebSocket') && !msg.includes('net::') &&
                !msg.includes('favicon') && !msg.includes('404') &&
                !msg.includes('Failed to fetch') && !msg.includes('Havok') &&
                !msg.includes('ResizeObserver') && !msg.includes('AudioContext') &&
                !msg.includes('NotSupportedError');

            const crit1 = errors1.filter(critFilter);
            const crit2 = errors2.filter(critFilter);
            if (crit1.length) {
                log('WARN', `P1 JS errors (${crit1.length}): ${crit1.slice(0, 3).join('; ')}`);
            }
            if (crit2.length) {
                log('WARN', `P2 JS errors (${crit2.length}): ${crit2.slice(0, 3).join('; ')}`);
            }

            if (pass) {
                log('OK', '==================================================');
                log('OK', '  MULTIPLAYER TEST PASSED -- both players synced!  ');
                log('OK', '==================================================');
            } else {
                log('FAIL', '==================================================');
                log('FAIL', '  MULTIPLAYER TEST FAILED -- see errors above.    ');
                log('FAIL', '==================================================');
                exitCode = 1;
            }

        } catch (err) {
            if (err.message !== 'Party code not obtained' &&
                err.message !== 'Navigation timeout' &&
                err.message !== 'Room join timeout') {
                log('FAIL', `Unexpected error: ${err.message}`);
            }
            if (!exitCode) exitCode = 1;
        } finally {
            // If headed is on, give 10s to visually inspect
            if (HEADED) {
                log('INFO', 'Headed mode — keeping browsers open 10s for inspection...');
                await sleep(10_000);
            }
            await ctx1.close();
            await ctx2.close();
            await browser.close();
            log('INFO', 'Browsers closed.');
        }

        process.exit(exitCode);
    })();
''')


def run_playwright_test(headed: bool, game_mode: str) -> int:
    """Write and execute the Playwright lobby test script."""
    script_path = os.path.join(FRONTEND_DIR, "_tmp_mp_test.mjs")
    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(PLAYWRIGHT_SCRIPT)

        env = os.environ.copy()
        env["LOBBY_URL"] = LOBBY_URL
        env["HEADED"] = "1" if headed else "0"
        env["GAME_MODE"] = game_mode

        # Use npx playwright's node (which has the playwright module) to run our script
        # Actually we can just run with node since playwright is installed in frontend/node_modules
        node = "node.exe" if IS_WINDOWS else "node"

        log("STEP", f"Running multiplayer lobby test ({game_mode} mode)...")
        result = subprocess.run(
            [node, script_path],
            cwd=FRONTEND_DIR,
            env=env,
            timeout=180,
        )
        return result.returncode
    except subprocess.TimeoutExpired:
        log("FAIL", "Test script timed out after 180 seconds.")
        return 1
    finally:
        try:
            os.remove(script_path)
        except OSError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="GLO KARTS — Local multiplayer testing harness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python start-local-multiplayer.py                 # race mode, headless
              python start-local-multiplayer.py --battle        # battle mode
              python start-local-multiplayer.py --headed        # show browsers
              python start-local-multiplayer.py --skip-servers  # servers already running
        """),
    )
    parser.add_argument("--battle", action="store_true", help="Test battle mode instead of race")
    parser.add_argument("--headed", action="store_true", help="Show browser windows (not headless)")
    parser.add_argument("--skip-servers", action="store_true", help="Skip starting servers (assume already running)")
    args = parser.parse_args()

    game_mode = "battle" if args.battle else "race"

    print()
    print("  ==============================================================")
    print("  |  GLO KARTS -- Local Multiplayer Testing Harness            |")
    print("  ==============================================================")
    print()

    # ── Preflight checks ──
    log("STEP", "Preflight checks...")

    if not os.path.isdir(FRONTEND_DIR):
        log("FAIL", f"frontend/ directory not found at {FRONTEND_DIR}")
        sys.exit(1)
    if not os.path.isdir(REALTIME_DIR):
        log("FAIL", f"realtime/ directory not found at {REALTIME_DIR}")
        sys.exit(1)

    # Check node is available
    try:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True)
        log("OK", f"Node.js {result.stdout.strip()}")
    except FileNotFoundError:
        log("FAIL", "Node.js not found. Install Node.js and ensure 'node' is in PATH.")
        sys.exit(1)

    # ── Start servers ──
    if not args.skip_servers:
        log("STEP", "Starting services...")

        # 1. Colyseus realtime server
        colyseus_proc = start_colyseus()
        if not wait_for_url(COLYSEUS_HEALTH, "Colyseus", timeout=30):
            log("FAIL", "Colyseus server did not start. Check realtime/src/index.js.")
            # Dump last output for debugging
            try:
                colyseus_proc.terminate()
                out, _ = colyseus_proc.communicate(timeout=3)
                if out:
                    log("INFO", f"Colyseus output:\n{out.decode('utf-8', errors='replace')[:500]}")
            except Exception:
                pass
            sys.exit(1)

        # 2. Vite frontend dev server
        vite_proc = start_vite()
        if not wait_for_url(VITE_URL, "Vite", timeout=30):
            log("FAIL", "Vite dev server did not start. Check frontend/.")
            sys.exit(1)
    else:
        log("INFO", "Skipping server startup (--skip-servers).")
        # Quick check that servers are actually running
        if not wait_for_url(COLYSEUS_HEALTH, "Colyseus", timeout=5):
            log("FAIL", "Colyseus not running at :2567. Start it or remove --skip-servers.")
            sys.exit(1)
        if not wait_for_url(VITE_URL, "Vite", timeout=5):
            log("FAIL", "Vite not running at :5173. Start it or remove --skip-servers.")
            sys.exit(1)

    # ── Ensure Playwright browsers ──
    log("STEP", "Checking Playwright browsers...")
    ensure_playwright_browsers()

    # ── Run the test ──
    print()
    log("STEP", "=== LAUNCHING MULTIPLAYER TEST ===")
    print()

    exit_code = run_playwright_test(headed=args.headed, game_mode=game_mode)

    print()
    if exit_code == 0:
        log("OK", "All multiplayer tests passed!")
    else:
        log("FAIL", f"Tests exited with code {exit_code}.")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
