@
const { chromium } = require('@playwright/test');

(async () => {
    // Vite server is running at 5175
    const browser = await chromium.launch({ headless: true });

    // Host
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    page1.on('console', msg => console.log('HOST CONSOLE:', msg.text()));

    // Guest
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    page2.on('console', msg => console.log('GUEST CONSOLE:', msg.text()));

    console.log('Host setting up session...');
    await page1.goto('http://localhost:5175');
    await page1.evaluate(() => {
        sessionStorage.setItem('gameConfig', JSON.stringify({
            gameMode: 'gloflux', subMode: 'arena',
            multiplayer: true, roomName: 'testroom', host: true
        }));
    });

    console.log('Guest setting up session...');
    await page2.goto('http://localhost:5175');
    await page2.evaluate(() => {
        sessionStorage.setItem('gameConfig', JSON.stringify({
            gameMode: 'gloflux', subMode: 'arena',
            multiplayer: true, roomName: 'testroom', host: false
        }));
    });

    console.log('Host navigating to gloflux.html...');
    await page1.goto('http://localhost:5175/gloflux.html');
    await page1.waitForTimeout(1000);

    console.log('Guest navigating to gloflux.html...');
    await page2.goto('http://localhost:5175/gloflux.html');
    
    console.log('Waiting 6 seconds for lobby interaction...');
    await page1.waitForTimeout(6000);

    let hostLobbyVisible = await page1.evaluate(() => {
        const el = document.getElementById('prematch-lobby');
        return el ? !el.classList.contains('hidden') : false;
    });
    
    let guestLobbyVisible = await page2.evaluate(() => {
        const el = document.getElementById('prematch-lobby');
        return el ? !el.classList.contains('hidden') : false;
    });

    console.log('Host Lobby Visible?', hostLobbyVisible);
    console.log('Guest Lobby Visible?', guestLobbyVisible);

    await browser.close();
    process.exit(0);
})();
@
