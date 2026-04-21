/**
 * Quick smoke test: loads builder page and verifies no JS errors.
 */
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] || 'http://localhost:5173';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const requests404 = [];

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  page.on('response', resp => {
    if (resp.status() >= 400) requests404.push(`${resp.status()} ${resp.url()}`);
  });

  console.log(`Loading ${BASE_URL}/builder.html ...`);
  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Give JS modules time to initialize
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log('Page title:', title);

  const canvas = await page.$('canvas');
  console.log('Canvas found:', !!canvas);

  // Check that the road tool button exists
  const roadBtn = await page.$('#bv2-tool-road');
  console.log('Road tool button:', !!roadBtn);

  // Check for JS errors
  if (errors.length) {
    console.log('JS Errors:');
    for (const e of errors.slice(0, 10)) console.log('  -', e);
  } else {
    console.log('No JS errors detected');
  }
  if (requests404.length) {
    console.log('404 requests:');
    for (const r of requests404.slice(0, 10)) console.log('  -', r);
  }

  await browser.close();
  const hasIssues = errors.length > 0;
  console.log(hasIssues ? 'SMOKE TEST: ISSUES FOUND' : 'SMOKE TEST: PASSED');
  if (hasIssues) process.exitCode = 1;
}

main().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exit(1);
});
