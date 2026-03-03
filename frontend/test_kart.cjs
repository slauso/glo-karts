const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

(async () => {
    // start dev server
    const server = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), shell: true });
    
    await new Promise(r => setTimeout(r, 3000));
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    await page.goto('http://localhost:5173/'); // Vite default port
    await page.evaluate(() => {
        sessionStorage.setItem('selectedKart', 'adiumy');
        sessionStorage.setItem('gloEffect', 'solid');
    });

    await page.goto('http://localhost:5173/realtime.html?smoke=Player1');
    
    // wait a bit
    await page.waitForTimeout(5000);
    
    await browser.close();
    server.kill();
    process.exit(0);
})();
