const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

(async () => {
    const server = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), shell: true });
    await new Promise(r => setTimeout(r, 2000));
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => {
        if(msg.text().includes('Evaluation')) return;
    });

    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        sessionStorage.setItem('selectedKart', 'adiumy');
        sessionStorage.setItem('gloEffect', 'solid');
    });

    await page.goto('http://localhost:5173/realtime.html?smoke=Player1');
    
    await page.waitForTimeout(6000);
    
    const res = await page.evaluate(() => {
        if (!window.client || !window.client.localMesh) return "No local mesh found";
        const root = window.client.localMesh;
        const traverse = (node, depth) => {
            let str = '  '.repeat(depth) + node.name + ' (' + (node.isVisible !== false) + ')\n';
            node.getChildren().forEach(c => {
                str += traverse(c, depth + 1);
            });
            return str;
        };
        return traverse(root, 0);
    });
    console.log("Evaluation Result:\n", res);
    
    await browser.close();
    server.kill();
    process.exit(0);
})();
