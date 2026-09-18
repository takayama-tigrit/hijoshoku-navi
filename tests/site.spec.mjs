import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { checkVisualAction } from './action-ui-checks.mjs';

const root = process.cwd();
const output = await mkdtemp(path.join(tmpdir(), 'hijoshoku-site-test-'));
const artifacts = process.env.ARTIFACT_DIR || path.join(output, 'screenshots');
await mkdir(artifacts, { recursive: true });
execFileSync(process.env.HUGO_BIN || 'hugo', ['--minify', '--destination', output], { cwd: root, stdio: 'inherit' });
const routes = ['/', '/guide/', '/ranking/', '/posts/alpha-mai-osusume/', '/about/', '/privacy/'];
const viewports = [320, 390, 768, 1440];
for (const route of routes) {
  const file = path.join(output, route, 'index.html');
  assert((await stat(file)).size > 0, `Missing page: ${route}`);
}
for (const file of ['sitemap.xml', 'robots.txt']) assert((await stat(path.join(output, file))).size > 0);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(output, '.' + pathname);
    if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
else if (process.platform === 'darwin') launchOptions.channel = 'chrome';
let browser;
const broken = [];
const consoleErrors = [];
const links = new Set();
const anchors = new Map();
try {
  browser = await chromium.launch(launchOptions);
  // Keep production canonical URLs while serving their assets from the same test build.
  for (const width of viewports) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    await context.route('https://hijoshoku-navi.com/**', async route => {
      const original = new URL(route.request().url());
      const response = await route.fetch({ url: base + original.pathname + original.search });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) broken.push(`${response.status()} ${response.url()}`); });
    for (const route of routes) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, route);
      assert.equal(await page.locator('h1').count(), 1, `One h1: ${route}`);
      assert.equal(await page.locator('main').count(), 1, `One main: ${route}`);
      assert.match(await page.locator('html').getAttribute('lang'), /^ja/);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://hijoshoku-navi.com' + route);
      assert((await page.locator('meta[name="description"]').getAttribute('content'))?.length > 10, `Description: ${route}`);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(dimensions.scroll <= dimensions.width + 1, `Horizontal overflow ${route} width=${width}: ${JSON.stringify(dimensions)}`);
      for (const image of await page.locator('img').all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(img => img.decode());
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const imgs = await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth || !img.hasAttribute('alt')).map(img => img.src));
      assert.deepEqual(imgs, [], `Broken or unlabelled image: ${route}`);

      const body = await page.locator('body').innerText();
      assert(!/要確認|おすすめ10選|第[1-5]位/.test(body), `Unverified claim/unsupported ranking: ${route}`);
      for (const href of await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))) {
        const url = new URL(href, base + route);
        assert(!['javascript:', 'data:'].includes(url.protocol), `Unsafe link scheme: ${url.protocol}`);
        if ([base, 'https://hijoshoku-navi.com'].includes(url.origin)) {
          links.add(url.pathname);
          if (url.hash) {
            if (!anchors.has(url.pathname)) anchors.set(url.pathname, new Set());
            anchors.get(url.pathname).add(decodeURIComponent(url.hash.slice(1)));
          }
          if (url.pathname === route && url.hash) {
            const id = decodeURIComponent(url.hash.slice(1));
            assert(await page.evaluate(id => !!document.getElementById(id), id), `Broken anchor ${route}${url.hash}`);
          }
        }
      }
      if (route === '/') {
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(':focus').getAttribute('href'), '#main-content', 'Skip link first');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator(':focus').getAttribute('id'), 'main-content', 'Skip link target');
        for (const target of routes.slice(1)) assert(await page.locator(`a[href="${target}"]`).count() > 0, `Home missing ${target}`);
      }
      await checkVisualAction(page, route, width);
      const toc = page.locator('details.article-toc');
      if (await toc.count()) {
        await toc.locator('summary').focus();
        await page.keyboard.press('Enter');
        assert(await toc.evaluate(el => el.open), 'Keyboard TOC opens');
        await page.keyboard.press('Enter');
        assert(!(await toc.evaluate(el => el.open)), 'Keyboard TOC closes');
      }
      for (const table of await page.locator('.table-scroll').all()) {
        const disclosure = table.locator('xpath=ancestor::details[1]');
        const wasClosed = await disclosure.count() && !(await disclosure.evaluate(el => el.open));
        if (wasClosed) await disclosure.locator(':scope > summary').click();
        const before = await table.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        if (before.scroll > before.client) {
          await table.focus();
          for (let n = 0; n < 5; n++) await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(250);
          assert(await table.evaluate(el => el.scrollLeft > 0), `Keyboard table scroll: ${route} width=${width}`);
          await table.evaluate(el => { el.scrollLeft = 0; });
        }
        if (wasClosed) await disclosure.locator(':scope > summary').click();
      }
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(artifacts, `${width}-${route === '/' ? 'home' : route.split('/').filter(Boolean).join('-')}.png`), fullPage: true });
    }
    await context.close();
  }
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const noJSPage = await noJS.newPage();
  await noJSPage.goto(base + '/');
  assert(await noJSPage.locator('[data-calculate]').isDisabled(), 'No-JS form must not submit input to the server');
  assert(await noJSPage.locator('noscript').isVisible(), 'No-JS alternative is visible');
  await noJS.close();
  for (const pathname of links) {
    const local = path.join(output, decodeURIComponent(pathname), pathname.endsWith('/') ? 'index.html' : '');
    assert((await stat(local)).isFile(), `Broken internal link: ${pathname}`);
    if (anchors.has(pathname)) {
      const html = await readFile(local, 'utf8');
      for (const id of anchors.get(pathname)) {
        assert(html.includes(`id="${id}"`) || html.includes(`id=${id}>`) || html.includes(`id=${id} `), `Broken cross-page anchor: ${pathname}#${id}`);
      }
    }
  }
  assert.deepEqual(broken, [], 'Failed browser responses');
  assert.deepEqual(consoleErrors, [], 'Browser errors');
  console.log(JSON.stringify({ status: 'PASS', routes, viewports, internalPathsChecked: links.size, artifacts, output }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
