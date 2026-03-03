const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

(async () => {
    const server = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), shell: true });
    await new Promise(r => setTimeout(r, 2000));
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    page.on('response', response => {
        if (response.url().includes('glb')) {
            console.log('NETWORK:', response.url(), response.status());
        }
    });

    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        sessionStorage.setItem('selectedKart', 'adiumy');
        sessionStorage.setItem('gloEffect', 'solid');
    });

    await page.goto('http://localhost:5173/realtime.html?smoke=Player1');
    
    await page.waitForTimeout(5000);
    
    const res = await page.evaluate(() => {
        if (!window.client || !window.client.localMesh) return "No local mesh found";
        return window.client.localMesh.id;
    });
    console.log("Evaluation Result:", res);
    
    await browser.close();
    server.kill();
    process.exit(0);
})();
