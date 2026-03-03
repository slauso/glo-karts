import { chromium } from 'playwright';

async function run() {
  const b = await chromium.launch({ headless: false });
  const hostCtx = await b.newContext();
  const guestCtx = await b.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  host.on('dialog', d => d.accept().catch(() => {}));
  guest.on('dialog', d => d.accept().catch(() => {}));

  const report = {
    created: false,
    joined: false,
    hostReady: false,
    guestReady: false,
    startVisible: false,
    startEnabled: false,
    hostTransitioned: false,
    guestTransitioned: false,
    hostUrl: '',
    guestUrl: ''
  };

  try {
    await host.goto('http://localhost:5174/index.html?role=host-reg-final');
    await guest.goto('http://localhost:5174/index.html?role=guest-reg-final');

    await host.waitForTimeout(9000);
    await guest.waitForTimeout(9000);

    await host.fill('#player-name-input', 'HostFinalReg');
    await guest.fill('#player-name-input', 'GuestFinalReg');

    await host.click('#create-party-btn', { force: true });
    await host.waitForFunction(() => {
      const info = document.querySelector('#host-info');
      const code = (document.querySelector('#party-code')?.textContent || '').trim();
      return info && !info.classList.contains('hidden') && code && code !== 'XXXXXX';
    }, { timeout: 45000 });
    report.created = true;

    const code = (await host.locator('#party-code').textContent())?.trim();
    await guest.fill('#join-code-input', code || '');
    await guest.click('#join-party-btn', { force: true });
    await guest.waitForFunction(() => document.querySelector('.join-section')?.classList.contains('hidden'), { timeout: 45000 });
    report.joined = true;

    await host.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 2, { timeout: 45000 });

    await host.click('.mode-btn[data-mode="battle"]', { force: true });
    await guest.waitForFunction(() => document.querySelector('.mode-btn[data-mode="battle"]')?.classList.contains('active'), { timeout: 15000 });

    await host.click('#play-btn', { force: true });
    report.hostReady = true;

    await guest.click('#play-btn', { force: true });
    report.guestReady = true;

    await host.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.classList.contains('hidden');
    }, { timeout: 20000 });
    report.startVisible = true;

    await host.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.disabled;
    }, { timeout: 20000 });
    report.startEnabled = true;

    await host.click('#battle-start-btn', { force: true });

    await Promise.all([
      host.waitForURL(/battle\.html|realtime\.html/, { timeout: 35000 }),
      guest.waitForURL(/battle\.html|realtime\.html/, { timeout: 35000 })
    ]);

    report.hostUrl = host.url();
    report.guestUrl = guest.url();
    report.hostTransitioned = /battle\.html|realtime\.html/.test(report.hostUrl);
    report.guestTransitioned = /battle\.html|realtime\.html/.test(report.guestUrl);

    const ok = Object.entries(report).every(([k, v]) => k.endsWith('Url') ? true : v === true);
    console.log('FINAL_READY_START_REGRESSION', JSON.stringify({ ok, report }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await b.close();
  }
}

run().catch((e) => {
  console.error('FINAL_READY_START_REGRESSION', JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
