import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const TARGET = `${BASE_URL}/realtime.html?smoke=HavokCheck`;
const FALLBACK_LOG = "[realtime] Havok init failed, continuing without physics";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const consoleLogs = [];
const pageErrors = [];

page.on("console", (msg) => {
  const text = msg.text();
  consoleLogs.push(text);
});

page.on("pageerror", (error) => {
  pageErrors.push(error?.message || String(error));
});

await page.addInitScript(() => {
  sessionStorage.setItem(
    "gameConfig",
    JSON.stringify({
      multiplayerProvider: "colyseus",
      gameMode: "race",
      trackId: "cocoa_temple",
      maxPlayers: 12,
    })
  );
});

await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

const statusText = await page.locator("#rt-status").textContent();
const hasFallbackLog = consoleLogs.some((line) => line.includes(FALLBACK_LOG));
const hasWasmMagicError = consoleLogs.some(
  (line) => line.includes("magic word") || line.includes("WebAssembly")
) || pageErrors.some((line) => line.includes("WebAssembly") || line.includes("magic word"));

console.log("[check] target:", TARGET);
console.log("[check] status:", (statusText || "").trim());
console.log("[check] fallbackLog:", hasFallbackLog ? "YES" : "NO");
console.log("[check] wasmErrors:", hasWasmMagicError ? "YES" : "NO");

if (pageErrors.length) {
  console.log("[check] pageErrors:");
  for (const err of pageErrors) {
    console.log(" -", err);
  }
}

await browser.close();

if (hasFallbackLog || hasWasmMagicError) {
  process.exit(2);
}
