const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

(async () => {
    const server = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), shell: true });
    await new Promise(r => setTimeout(r, 2000));
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        sessionStorage.setItem('selectedKart', 'adiumy');
        sessionStorage.setItem('gloEffect', 'solid');
    });

    await page.goto('http://localhost:5173/realtime.html?smoke=Player1');
    
    await page.waitForTimeout(5000);
    
    const res = await page.evaluate(() => {
        if (!window.client || !window.client.localMesh) return "No mesh";
        const root = window.client.localMesh.getChildren()[0]; // visualRoot
        if(!root) return "no root";
        let min = new window.BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        let max = new window.BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
        const hierarchy = root.getChildMeshes();
        hierarchy.forEach(m => {
            m.computeWorldMatrix(true);
            const { minimumWorld, maximumWorld } = m.getBoundingInfo().boundingBox;
            min = window.BABYLON.Vector3.Minimize(min, minimumWorld);
            max = window.BABYLON.Vector3.Maximize(max, maximumWorld);
        });
        const extents = max.subtract(min);
        return {
            extents: [extents.x, extents.y, extents.z],
            scale: [root.scaling.x, root.scaling.y, root.scaling.z]
        };
    });
    console.log("Evaluation Result:", res);
    
    await browser.close();
    server.kill();
    process.exit(0);
})();
