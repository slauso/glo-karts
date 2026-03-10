const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER: ' + msg.text()));

  console.log('Navigating to gloflux test...');
  await page.goto('http://localhost:5173/gloflux.html');
  await page.evaluate(() => {
    sessionStorage.setItem('gameConfig', JSON.stringify({gameMode: 'gloflux', multiplayer: false, variant: 'arena'}));
  });
  await page.reload();

  console.log('Waiting for game to boot (10s)...');
  await page.waitForTimeout(10000); // Wait for countdown and physics load

  console.log('Simulating user test: Driving kart...');
  
  // Press W to drive forward
  await page.keyboard.down('W');
  await page.waitForTimeout(2000);
  
  // Turn left
  await page.keyboard.down('A');
  await page.waitForTimeout(1500);
  await page.keyboard.up('A');

  // Drive forward a bit more
  await page.waitForTimeout(2000);

  // Turn right
  await page.keyboard.down('D');
  await page.waitForTimeout(1500);
  await page.keyboard.up('D');
  await page.keyboard.up('W');

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'gloflux_drive_test.png' });

  const res = await page.evaluate(() => {
    const o = window.__gloflux && window.__gloflux._orch;
    if (!o) return null;
    const player = o.players[0];
    return {
      pos: player.mesh.position,
      trackScale: o.arenaRoot.scaling,
      cameraPos: o.camera.position
    };
  });
  
  console.log('Game State after driving:');
  console.log(res);

  await browser.close();
  console.log('Simulation complete.');
})();
