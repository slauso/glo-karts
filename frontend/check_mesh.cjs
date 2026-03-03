const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

(async () => {
    const server = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), shell: true });
    await new Promise(r => setTimeout(r, 2000));
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        sessionStorage.setItem('selectedKart', 'adiumy');
        sessionStorage.setItem('gloEffect', 'solid');
    });

    // Check if the mesh actually loads and what its bounding box is. We can eval.
    await page.goto('http://localhost:5173/realtime.html?smoke=Player1');
    
    await page.waitForTimeout(5000);
    
    const res = await page.evaluate(() => {
        if (!window.client || !window.client.localMesh) return "No local mesh found";
        const root = window.client.localMesh.getChildren()[0];
        if (!root) return "No visual child of localMesh";
        return {
            childName: root.name,
            childScaling: [root.scaling.x, root.scaling.y, root.scaling.z],
            visible: root.isVisible,
            childrenCount: root.getChildren().length
        };
    });
    
    console.log("Evaluation Result:", res);
    
    await browser.close();
    server.kill();
    process.exit(0);
})();
