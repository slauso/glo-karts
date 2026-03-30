import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();

  try {
    await Promise.all([
      host.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' }),
      guest.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' }),
    ]);

    await host.click('.mode-card[data-mode-id="battle_online"]');
    await host.waitForSelector('#battle-settings:not(.hidden)', { timeout: 10000 });
    await host.click('.weapon-loadout-btn[data-loadout="custom"]');
    await host.waitForSelector('.custom-weapon-chip[data-weapon-id="crimson_hydra"]', { timeout: 10000 });

    const summary = await host.evaluate(() => ({
      title: document.title,
      battleSettingsVisible: !document.getElementById('battle-settings')?.classList.contains('hidden'),
      selectedLoadout: document.querySelector('.weapon-loadout-btn.active')?.getAttribute('data-loadout') || '',
      hydraLabel: document.querySelector('.custom-weapon-chip[data-weapon-id="crimson_hydra"] .custom-weapon-label')?.textContent?.trim() || '',
      weaponChipCount: document.querySelectorAll('.custom-weapon-chip').length,
    }));

    assert(summary.title.includes('GLO KARTS'), 'Lobby page should load the live game title');
    assert(summary.battleSettingsVisible, 'Battle settings should be visible after selecting Online Battle');
    assert(summary.selectedLoadout === 'custom', 'Custom loadout should be active before checking the weapon pool');
    assert(summary.hydraLabel === 'Crimson Hydra', 'Hydra chip should be present in the live battle customization UI');
    assert(summary.weaponChipCount >= 10, 'Battle customization should render the live weapon chip grid');

    console.log('HYDRA_LOBBY_SMOKE', JSON.stringify({ ok: true, summary }, null, 2));
  } catch (error) {
    console.error('HYDRA_LOBBY_SMOKE', JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('HYDRA_LOBBY_SMOKE', JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
});