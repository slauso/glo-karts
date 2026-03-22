import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 30_000,
    };

/**
 * GLO KARTS — Playwright Configuration
 *
 * Test suites:
 *   01-spawn-sequence  — validates kart hidden pre-match, revealed at GO
 *   02-map-viability   — audits every track/arena, writes reports/map-viability.json
 *   03-pvp-session     — two-player battle room: join, pickup, fire, positions
 *   04-kart-scaling    — asserts per-arena kart scale matches content-registry
 *   phase1-smoke       — legacy smoke suite (lobby, canvas, health endpoint)
 *
 * All suites run serially by default to avoid port contention on the shared
 * Colyseus server (:2567).  The map-viability suite is run with fullyParallel:
 * false because it writes a shared JSON report file.
 *
 * Services must be running before test execution:
 *   - Vite dev server  : http://localhost:5173  (npm run dev)
 *   - Colyseus server  : http://localhost:2567  (realtime/ with node --watch)
 */
export default defineConfig({
  testDir: './tests',

  // Global timeout per individual test (map loading can take 20+ s for large GLBs)
  timeout: 90_000,

  // Expect timeout (waitForDebug uses waitForFunction which is bounded separately)
  expect: { timeout: 30_000 },

  // Retry once on flake — network timing and map-load are inherently async
  retries: 1,

  // Run all spec files serially to avoid contending on the shared Colyseus room
  fullyParallel: false,
  workers: 1,

  reporter: [
    ['list'],
    ['json', { outputFile: 'tests/reports/playwright-results.json' }],
    ['html',  { outputFolder: 'tests/reports/html', open: 'never' }],
  ],

  use: {
    baseURL,
    headless:           true,
    screenshot:         'only-on-failure',
    video:              'retain-on-failure',
    trace:              'retain-on-failure',
    // Give the Babylon/Havok init time before timeout
    navigationTimeout:  30_000,
    actionTimeout:      10_000,
  },

  projects: [
    {
      name: 'chromium-game',
      use: {
        ...devices['Desktop Chrome'],
        // WebGL & SharedArrayBuffer are needed by Babylon + Havok WASM
        launchOptions: {
          args: [
            '--ignore-gpu-blocklist',
            '--enable-gpu-rasterization',
            '--enable-zero-copy',
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            '--enable-features=SharedArrayBuffer',
            '--no-sandbox',
          ],
        },
      },
    },
  ],

  // Re-use the already-running Vite dev server (started by run-tests.ps1 / task)
  webServer,
});
