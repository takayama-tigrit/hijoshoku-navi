import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const output = await mkdtemp(path.join(tmpdir(), 'hijoshoku-food-memo-'));
execFileSync(process.env.HUGO_BIN || 'hugo', ['--minify', '--destination', output], { stdio: 'inherit' });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(output, '.' + pathname);
    if (!file.startsWith(output + path.sep)) return res.writeHead(403).end();
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
async function memo(page, planner) {
  const pending = page.waitForEvent('download');
  await planner.locator('[data-download]').click();
  const download = await pending;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
  for (const mode of ['normal', 'noJS', 'scriptFailure']) {
    const context = await browser.newContext({ javaScriptEnabled: mode !== 'noJS', viewport: { width: 390, height: 844 } });
    await context.route('**/*', async route => {
      const request = route.request();
      if (mode === 'scriptFailure' && request.resourceType() === 'script') return route.abort();
      const url = new URL(request.url());
      if (url.hostname === 'hijoshoku-navi.com') {
        return route.fulfill({ response: await route.fetch({ url: base + url.pathname }) });
      }
      return route.continue();
    });
    const page = await context.newPage();
    for (const route of ['/', '/guide/']) {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const planner = page.locator('[data-testid="stock-planner"]');
      if (mode === 'normal') {
        const initial = await memo(page, planner);
        assert.match(initial, /初期値は計算例/);
        assert.match(initial, /水：約2日分/);
        assert.match(initial, /未記入/);
        assert(initial.includes('目安の総量：18L'));
      }
      // v7 notes are secondary, but food-only completion remains independent.
      await planner.locator('.stock-notes summary').click();
      if (mode === 'normal') { await planner.locator('[name="litres"]').fill(''); await planner.locator('[name="meals"]').fill(''); }
      await planner.locator('[name="foodNotes"]').fill('卵は食べられない');
      if (mode === 'normal') assert.equal(await planner.locator('[data-download]').isEnabled(), true, 'Food-only memo must save without a water calculation');
      for (const [name, label] of [['foodStaples', '主食'], ['foodMains', '主菜'], ['foodSides', '副菜'], ['foodActions', '買足・確認'], ['foodNotes', '家族の条件']]) {
        const field = planner.locator(`[name="${name}"]`);
        assert(await field.isVisible(), `${label} must be reachable after expanding optional notes`);
        assert((await field.evaluate(el => el.closest('label').textContent)).includes(label));
        assert.equal(await field.evaluate(el => el.form === null), true, 'Private notes cannot belong to a submittable form');
      }
      if (mode !== 'normal') {
        assert(await planner.locator('[data-download]').isDisabled());
        assert(await planner.locator('[data-calculate]').isDisabled());
        assert.equal(await planner.locator('form').count(), 0, 'No native submission when scripts are absent or fail');
        continue;
      }
      let text = await memo(page, planner);
      assert.match(text, /水：未確認/);
      assert(text.includes('卵は食べられない'));
      assert(!text.includes('目安の総量：'));
      const payload = '<img src=x onerror="window.__foodXss=1"><script>window.__foodXss=1</script>';
      for (const [name, value] of [['foodStaples', payload], ['foodMains', '缶詰3缶'], ['foodSides', '乾燥野菜'], ['foodActions', '今は買わない。期限を確認']]) await planner.locator(`[name="${name}"]`).fill(value);
      text = await memo(page, planner);
      for (const value of [payload, '缶詰3缶', '乾燥野菜', '今は買わない。期限を確認', '卵は食べられない']) assert(text.includes(value));
      assert.equal(await page.evaluate(() => window.__foodXss), undefined);
      assert.equal(await planner.locator('img[src="x"], script').count(), 0);
      await planner.locator('[name="people"]').fill('2');
      await planner.locator('[name="litres"]').fill('6');
      await planner.locator('[data-calculate]').click();
      await planner.locator('[name="foodNotes"]').fill('卵不可。味を試す');
      text = await memo(page, planner);
      assert.match(text, /目安の総量：18L/);
      assert.match(text, /不足：12L/);
      assert.match(text, /買い足す2Lボトル：6本/);
      assert(text.includes('卵不可。味を試す'));
      assert(text.includes('https://www.kantei.go.jp/jp/headline/bousai/sonae.html'));
      assert.equal(await planner.locator('.planner-caution a').getAttribute('href'), 'https://www.kantei.go.jp/jp/headline/bousai/sonae.html');
      for (const [name, value] of [['people', '4'], ['days', '7'], ['litres', '18']]) {
        const field = planner.locator(`[name="${name}"]`);
        if (name === 'days') await planner.locator(`[name="days"][value="${value}"]`).check(); else await field.fill(value);
        assert(await planner.locator('[data-results]').isVisible());
        text = await memo(page, planner);
        assert.match(text, /水：約/);
        assert(text.includes('目安の総量：'), 'v7 recalculates immediately, never saves stale result');
        await planner.locator('[data-calculate]').click();
      }
      await planner.locator('[name="people"]').fill('0');
      await planner.locator('[data-calculate]').click();
      assert(await planner.locator('[data-planner-error]').isVisible());
      text = await memo(page, planner);
      assert.match(text, /水：未確認/);
      assert(text.includes('缶詰3缶'));
      assert(await planner.locator('[data-planner-error]').isVisible(), 'Saving food must not clear water errors');
      await planner.locator('[name="people"]').fill('2');
      await planner.locator('[name="days"][value="3"]').check();
      await planner.locator('[name="litres"]').fill('18');
      await planner.locator('[data-calculate]').click();
      assert.match(await memo(page, planner), /買い足す2Lボトル：0本/);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await context.close();
  }
  console.log('PASS: food-only downloads, visible fields, literal XSS, integrated water, stale/invalid water, no-buy, noJS and script-failure safety (home + guide)');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
