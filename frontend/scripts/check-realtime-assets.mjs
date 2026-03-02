import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5174"; // Dev server port usually 5174 or 5173
const TARGET = `${BASE_URL}/realtime.html?smoke=AssetCheck`;

const browser = await chromium.launch({ headless: true });

async function createPlayer(playerName, playerColor) {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const logs = [];
  const networkRequests = [];

  page.on("console", (msg) => {
    logs.push(msg.text());
  });

  page.on("request", request => {
    if (request.url().includes(".glb")) {
      networkRequests.push(request.url());
    }
  });

  await page.addInitScript((color) => {
    sessionStorage.setItem("carColor", color);
    sessionStorage.setItem("selectedKart", "default");
    sessionStorage.setItem(
      "gameConfig",
      JSON.stringify({
        multiplayerProvider: "colyseus",
        gameMode: "race",
        trackId: "map1",
        maxPlayers: 12,
      })
    );
  }, playerColor);

  return { context, page, logs, networkRequests };
}

console.log("[check] Starting host player...");
const host = await createPlayer("HostPlayer", "red");
await host.page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
await host.page.waitForTimeout(8000); // Give it time to load models

console.log("[check] Starting second player...");
const guest = await createPlayer("GuestPlayer", "blue");
await guest.page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
await guest.page.waitForTimeout(8000); // Give it time to sync remote meshes

// Let's analyze Host's perspective
const hostTrackLoaded = host.logs.some(m => m.includes("Loading track models for map1"));
const hostLocalKartLoaded = host.logs.some(m => m.includes("Loading local player kart"));
const hostGLBRequests = host.networkRequests.filter(req => req.includes(".glb"));

console.log("[check] Host Logs:", host.logs.filter(m => m.startsWith("[realtime]")));
console.log("[check] Host GLB Requests:", hostGLBRequests.map(r => r.split('/').pop()));

// Remote sync check
const guestRemoteKartLoaded = guest.logs.some(m => m.includes("Loaded remote kart for"));
const guestLocalKartLoaded = guest.logs.some(m => m.includes("car_blue.glb") || m.includes("Loading local player kart"));

console.log("[guest] Guest Logs:", guest.logs.filter(m => m.startsWith("[realtime]")));

let failed = false;

if (!hostTrackLoaded || hostGLBRequests.length < 3) {
  console.error("❌ Host failed to load track assets or kart.");
  failed = true;
} else {
  console.log("✅ Host loaded track and local kart properly.");
}

if (!guestRemoteKartLoaded) {
  console.error("❌ Guest failed to load remote kart for the host.");
  failed = true;
} else {
  console.log("✅ Guest successfully loaded remote kart asset.");
}

await browser.close();

if (failed) {
  process.exit(1);
} else {
  console.log("✅ Asset replication verified successfully in Colyseus.");
  process.exit(0);
}
