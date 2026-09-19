import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const output = await mkdtemp(path.join(tmpdir(), 'hijoshoku-choice-'));
const artifacts = process.env.ARTIFACT_DIR || path.join(output, 'evidence');
await mkdir(artifacts, { recursive: true });
execFileSync(process.env.HUGO_BIN || 'hugo', ['--minify', '--destination', output], { stdio: 'inherit' });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    let name = new URL(req.url, 'http://localhost').pathname;
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(output, '.' + name);
    assert(file.startsWith(output + path.sep));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {});
const cases = [
  ['/guide/', ['水', '食品']],
  ['/ranking/', ['ひだまりパン', 'えいようかん', '白飯']],
  ['/posts/alpha-mai-osusume/', ['白飯', '五目', 'わかめ']]
];
const measurements = [];
try {
  for (const width of [390, 320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, javaScriptEnabled: false });
    await context.route('https://hijoshoku-navi.com/**', async route => {
      const response = await route.fetch({ url: base + new URL(route.request().url()).pathname });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    for (const [route, candidates] of cases) {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const block = page.locator('[data-testid="article-choice"]');
      assert.equal(await block.count(), 1, `${route}: missing first-screen visual choice block`);
      const cards = block.locator('[data-choice-card]');
      assert.equal(await cards.count(), candidates.length);
      const start = await block.boundingBox();
      const jump = page.locator('.article-jump');
      const action = await jump.boundingBox();
      assert(action && action.y + action.height < 750, `${route} ${width}: title-near action below fold ${JSON.stringify({ start, action })}`);
      assert.equal(await jump.getAttribute('href'), '#article-choice-title');
      assert.equal(await page.locator('#article-choice-title').count(), 1, 'Short action resolves to real choice cards');
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'Untouched initial viewport');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page overflow');
      for (const [i, candidate] of candidates.entries()) {
        const card = cards.nth(i);
        assert((await card.innerText()).includes(candidate));
        assert(await card.locator('[data-choice-condition]').isVisible());
        assert(await card.locator('svg').count() > 0);
        assert(await card.locator('a[data-official]').count() > 0, 'Official confirmation in same card');
        assert(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No card horizontal scrolling');
        for (const link of await card.locator('a').all()) {
          const href = await link.getAttribute('href');
          assert(href.startsWith('https://') || href.startsWith('#') || href.startsWith('/'));
          if (href.startsWith('#')) assert(await page.locator(`[id="${href.slice(1)}"]`).count() === 1, `Missing action target ${href}`);
        }
      }
      const name = route.split('/').filter(Boolean).join('-');
      await page.screenshot({ path: path.join(artifacts, `${width}-${name}-first.png`) });
      await block.screenshot({ path: path.join(artifacts, `${width}-${name}-cards.png`) });
      measurements.push({ route, width, startY: start.y, firstActionY: action.y, firstActionBottom: action.y + action.height });
      if (route !== '/guide/') {
        assert(await page.locator('.article-content table').evaluateAll(tables => tables.every(table => table.closest('details'))), 'Decision tables are supplementary disclosures');
      }
    }
    await context.close();
  }
  await writeFile(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify({ status: 'PASS', measurements, artifacts, output }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
