const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });
  const page = await browser.newPage();

  // Check lobby thumbnail
  await page.goto('http://localhost:5174/');
  await page.waitForSelector('#track-preview-thumb', { timeout: 5000 });
  const thumbSrc = await page.getAttribute('#track-preview-thumb', 'src');
  console.log('Thumbnail src:', thumbSrc);
  const thumbVis = await page.evaluate(() => {
    const img = document.getElementById('track-preview-thumb');
    return { width: img.naturalWidth, height: img.naturalHeight, complete: img.complete };
  });
  console.log('Thumbnail loaded:', JSON.stringify(thumbVis));

  // Click next button and check thumb changes
  await page.click('#track-next-btn');
  await page.waitForTimeout(200);
  const thumb2 = await page.getAttribute('#track-preview-thumb', 'src');
  const name2 = await page.textContent('#track-carousel-name');
  console.log('After next: thumb=' + thumb2 + ', name=' + name2);

  // Now test game page with STK track — set config FIRST, then navigate
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));

  // Set sessionStorage before navigating to game.html
  await page.goto('http://localhost:5174/');
  await page.evaluate(() => {
    sessionStorage.setItem('gameConfig', JSON.stringify({
      trackId: 'cornfield_crossing',
      mode: 'quick_race',
      players: [{ id: 'test', name: 'Test', isHost: true }]
    }));
  });
  // Now navigate to game
  await page.goto('http://localhost:5174/game.html');
  
  // Wait for game to load
  await page.waitForTimeout(10000);
  
  console.log('All console logs:');
  logs.forEach(l => console.log('  ' + l));
  
  await page.waitForTimeout(8000);
  
  const checkpointLogs = logs.filter(l =>
    l.includes('STK track data') || l.includes('Checkpoint') ||
    l.includes('Start grid') || l.includes('quads') ||
    l.includes('checkpoint')
  );
  console.log('Checkpoint-related logs:');
  checkpointLogs.forEach(l => console.log('  ' + l));
  
  const errorLogs = logs.filter(l =>
    l.toLowerCase().includes('error') && !l.includes('ERR_CONNECTION_REFUSED')
  );
  if (errorLogs.length) {
    console.log('Errors:');
    errorLogs.forEach(l => console.log('  ' + l));
  }
  
  // Check lap counter exists
  const lapEl = await page.evaluate(() => !!document.getElementById('lap-counter'));
  console.log('Lap counter element exists:', lapEl);

  await browser.close();
  console.log('Test complete.');
})();
