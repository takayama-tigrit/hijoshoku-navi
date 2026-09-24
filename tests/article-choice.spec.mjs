import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, devices } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';

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
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const choices = JSON.parse(await readFile('data/food-choices.json', 'utf8')).entries;
const photos = JSON.parse(await readFile('data/product-images.json', 'utf8')).images;
const cans = JSON.parse(await readFile('data/content14-visual.json', 'utf8')).groups.cans.entries;
// Independent approved purpose/order contract; fields come from source data, never generated DOM.
assert.deepEqual(choices.map(e => e.id), ['rice', 'bread', 'sides', 'cans', 'snacks', 'sets']);
const photoFor = entry => entry.photoKind === 'canned'
  ? { image: cans.find(e => e.id === 'hotei').photo.src, href: cans.find(e => e.id === 'hotei').photo.href }
  : photos[entry.photoKey];
const allowedImages = new Set([...Object.values(photos).map(p => p.image), ...cans.map(e => e.photo.src)]);
const browser = await chromium.launch(browserOptions());
const cases = [
  ['/guide/', ['水', '食品']],
  ['/ranking/', choices.map(e => e.name)],
  ['/posts/alpha-mai-osusume/', ['白飯', '五目', 'わかめ']]
];
const measurements = [];
const physicalClick = async (page, link, js) => {
  await link.scrollIntoViewIfNeeded();
  if (js) await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await link.boundingBox();
  assert(box && box.width > 0 && box.height > 0, 'real clickable bounds');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert(await link.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point), 'physical click is not obscured');
  await page.mouse.click(point.x, point.y);
};
try {
  for (const js of [true, false]) for (const width of [390, 320, 1440]) {
    const context = await browser.newContext({ ...(width < 700 ? devices['iPhone 13'] : {}), viewport: { width, height: 844 }, javaScriptEnabled: js });
    const errors = [];
    // Permit only exact ledger image GETs. Never visit ASP links or send analytics.
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base) return route.continue();
      if (request.method() === 'GET' && request.resourceType() === 'image' && allowedImages.has(url.href)) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const [route, candidates] of cases) {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const hub = route === '/ranking/';
      const block = page.locator(hub ? '.food-choices' : '[data-testid="article-choice"]');
      assert.equal(await block.count(), 1, `${route}: visual choice block`);
      const cards = block.locator(hub ? '[data-food-choice]' : '[data-choice-card]');
      assert.equal(await cards.count(), candidates.length);
      const start = await block.boundingBox();
      const jump = page.locator('.article-jump');
      const action = await jump.boundingBox();
      assert(action && action.y + action.height < 750, `${route} ${width}: title-near action below fold ${JSON.stringify({ start, action })}`);
      const jumpTarget = hub ? '#choose-by-prep' : '#article-choice-title';
      assert.equal(await jump.getAttribute('href'), jumpTarget);
      assert.equal(await page.locator(jumpTarget).count(), 1, 'Short action resolves to a unique real target');
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'Untouched initial viewport');
      assert(await page.evaluate(w => document.documentElement.scrollWidth <= w + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, width), 'No page overflow');
      if (hub) assert.deepEqual(await cards.evaluateAll(es => es.map(e => e.dataset.foodChoice)), choices.map(e => e.id));
      for (const [i, candidate] of candidates.entries()) {
        const card = cards.nth(i);
        assert((await card.innerText()).includes(candidate));
        if (hub) {
          const entry = choices[i], photo = photoFor(entry);
          assert.equal(await card.locator('h3').textContent(), entry.title);
          assert.deepEqual(await card.locator('mark strong').allTextContents(), [entry.condition], 'exact per-purpose safety/selection condition');
          assert.equal(await card.locator('.food-detail').getAttribute('href'), entry.href);
          assert.equal(await card.locator('.food-detail').textContent(), entry.label + ' →');
          assert.equal(await card.locator('.food-unit').textContent(), entry.unit);
          assert.equal(await card.locator('.food-media a').getAttribute('href'), photo.href);
          assert.equal(await card.locator('.food-media a').getAttribute('rel'), 'sponsored nofollow');
          assert.equal(await card.locator('img').getAttribute('src'), photo.image);
          assert.equal(await card.locator('img').getAttribute('alt'), entry.photoAlt);
          await card.locator('img').scrollIntoViewIfNeeded();
          await card.locator('img').evaluate(img => img.decode());
          assert(await card.locator('img').evaluate(img => img.naturalWidth > 0 && img.width > 0 && img.height > 0));
        } else {
          assert(await card.locator('[data-choice-condition]').isVisible());
          assert(await card.locator('svg').count() > 0);
          assert(await card.locator('a[data-official]').count() > 0, 'Official confirmation in same card');
        }
        assert(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No card horizontal scrolling');
        for (const link of await card.locator('a').all()) {
          const href = await link.getAttribute('href');
          assert(href.startsWith('https://') || href.startsWith('#') || href.startsWith('/'));
          if (href.startsWith('#')) assert.equal(await page.locator(`[id="${href.slice(1)}"]`).count(), 1, `Missing action target ${href}`);
        }
      }
      await page.evaluate(() => scrollTo(0, 0));
      const name = route.split('/').filter(Boolean).join('-'), mode = js ? 'js' : 'nojs';
      await page.screenshot({ path: path.join(artifacts, `${width}-${mode}-${name}-first.png`) });
      await physicalClick(page, jump, js);
      await page.waitForURL(base + route + jumpTarget);
      const target = hub ? page.locator(jumpTarget).locator('xpath=following-sibling::h2[1]') : page.locator(jumpTarget);
      const reached = await target.boundingBox();
      assert(reached && reached.y >= 0 && reached.y + reached.height <= 844, 'jump reaches actual visible choice heading');
      await block.screenshot({ path: path.join(artifacts, `${width}-${mode}-${name}-cards.png`) });
      measurements.push({ route, width, js, startY: start.y, firstActionY: action.y, firstActionBottom: action.y + action.height });
      if (route !== '/guide/') {
        assert(await page.locator('.article-content table:not(.product-table)').evaluateAll(tables => tables.every(table => table.closest('details'))), 'Detailed specification tables remain supplementary; photo comparisons stay open');
      }
      if (hub) for (const entry of choices) {
        const link = page.locator(`[data-food-choice="${entry.id}"] .food-detail`), url = new URL(entry.href, base + route);
        await physicalClick(page, link, js);
        await page.waitForURL(url.href);
        await page.waitForLoadState('networkidle');
        const destination = url.hash ? page.locator(url.hash).locator('xpath=following-sibling::h2[1]') : page.locator('.article-header h1');
        assert.equal(await destination.count(), 1, 'real destination content exists');
        const box = await destination.boundingBox();
        assert(box && box.y >= 0 && box.y + box.height <= 844, `purpose ${entry.id} reaches visible content`);
        await page.goBack({ waitUntil: 'networkidle' });
        assert.equal(new URL(page.url()).pathname, route);
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify({ status: 'PASS', measurements, artifacts, output }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
