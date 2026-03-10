const { chromium } = require('@playwright/test');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:5175');
    await page.waitForTimeout(2000);
    // Click online tab
    await page.click('button[data-cat="online"]');
    await page.waitForTimeout(1000);

    const cards = await page.evaluate(() => {
        const cat = document.querySelectorAll('#mode-cards .mode-card');
        return Array.from(cat).map(c => ({
            id: c.getAttribute('data-mode-id'),
            label: c.querySelector('.mode-card-label').innerText,
        }));
    });
    console.log('Cards in online category:');
    console.table(cards);
    await browser.close();
    process.exit(0);
})();