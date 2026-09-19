import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';

const origin = 'https://hijoshoku-navi.com';
const id = 'G-28DEZ2ELZ3';
const sentinel = 'PRIVATE_SENTINEL_analytics_7f30';
const output = await mkdtemp(path.join(tmpdir(), 'analytics-build-'));
const artifacts = process.env.ARTIFACT_DIR || path.join(output, 'evidence');
await mkdir(artifacts, { recursive: true });
const build = (destination, source) => execFileSync(process.env.HUGO_BIN || 'hugo', ['--panicOnWarning', '--minify', '--destination', destination, ...(source ? ['--source', source] : [])], { stdio: 'inherit' });
build(output);
const browser = await chromium.launch(browserOptions());
const evidence = { kind: 'LOCAL FIXTURE ONLY — not Google receipt', cases: [], outboundLinks: [] };
// The remote tag is a deliberately small transport fixture, NOT Google's implementation.
// It serializes the REAL site's queued commands; all external traffic is intercepted.
const remoteFixture = `(() => {
 const transmit = args => { if (args[0] === 'config') navigator.sendBeacon('https://www.google-analytics.com/g/collect', JSON.stringify(Array.from(args))); };
 window.dataLayer.forEach(transmit);
 const push = window.dataLayer.push.bind(window.dataLayer);
 window.dataLayer.push = function(args) { transmit(args); return push(args); };
})();`;
async function visit(url, { root = output, mode = 'normal', mutate = null, referrer = '', fallback = false } = {}) {
 const context = await browser.newContext({ javaScriptEnabled: mode !== 'noJS' });
 const requests = [], errors = [];
 await context.route('**/*', async route => {
  const req = route.request(), u = new URL(req.url());
  requests.push({ url: req.url(), body: req.postData(), headers: req.headers() });
  if (u.hostname === 'www.googletagmanager.com') {
   if (mode === 'remoteFailure') return route.abort();
   return route.fulfill({ contentType: 'text/javascript', body: remoteFixture });
  }
  if (u.hostname === 'www.google-analytics.com') return route.fulfill({ status: 204 });
  if (u.origin !== new URL(url).origin) return route.abort();
  if (mode === 'analyticsFailure' && /\/analytics\.[^/]+\.js$/.test(u.pathname)) return route.abort();
  try {
   let file = path.join(root, u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname);
   if (fallback && req.isNavigationRequest()) file = path.join(root, 'index.html');
   let body = await readFile(file);
   if (mutate && file.endsWith('.html')) body = Buffer.from(mutate(body.toString()));
   return route.fulfill({ body, contentType: { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream' });
  } catch { return route.fulfill({ status: 404, contentType: 'text/html', body: await readFile(path.join(root, '404.html')) }); }
 });
 const page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 await page.goto(url, { waitUntil: 'networkidle', ...(referrer ? { referer: referrer } : {}) });
 return { page, context, requests, errors, google: () => requests.filter(r => /google(?:tagmanager|\-analytics)\.com/.test(new URL(r.url).hostname)) };
}
async function close(v, name) {
 evidence.cases.push({ name, googleRequests: v.google(), errors: v.errors });
 await v.context.close();
}
async function usePlanner(page) {
 const planner = page.locator('[data-testid="stock-planner"]');
 for (const name of ['foodStaples', 'foodMains', 'foodSides', 'foodActions', 'foodNotes']) await planner.locator(`[name="${name}"]`).fill(sentinel + name);
 await planner.locator('[name="people"]').fill('2');
 await planner.locator('[name="bottles"]').fill('3');
 await planner.locator('[data-calculate]').click();
 assert.match(await planner.locator('[data-output="shortage"]').innerText(), /12\s*L/);
 const pending = page.waitForEvent('download');
 await planner.locator('[data-download]').click();
 const download = await pending, chunks = [];
 for await (const chunk of await download.createReadStream()) chunks.push(chunk);
 const text = Buffer.concat(chunks).toString('utf8');
 assert(text.includes(sentinel + 'foodNotes'));
 assert.match(text, /12\s*L/);
}
try {
 const v = await visit(origin + '/?email=' + sentinel + '#memo-' + sentinel, { referrer: 'https://referrer.example/private/' + sentinel + '?q=' + sentinel });
 assert.equal(v.google().filter(r => r.url.startsWith('https://www.googletagmanager.com/gtag/js?id=' + id)).length, 1, 'approved production page loads one tag');
 const commands = await v.page.evaluate(() => window.dataLayer.map(x => Array.from(x)));
 assert.deepEqual(commands[0], ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' }]);
 assert.equal(commands[1][0], 'js');
 const configs = commands.filter(c => c[0] === 'config');
 assert.equal(configs.length, 1);
 assert.equal(configs[0][1], id);
 assert.deepEqual(configs[0][2], { page_location: origin + '/', page_referrer: 'https://referrer.example/', page_title: await v.page.title(), allow_google_signals: false, allow_ad_personalization_signals: false, send_page_view: true, cookie_domain: 'hijoshoku-navi.com', cookie_flags: 'SameSite=Lax;Secure' });
 await usePlanner(v.page);
 await v.page.evaluate(() => { history.pushState({}, '', '#local-anchor'); history.replaceState({}, '', '#another-anchor'); });
 assert.equal(await v.page.evaluate(() => window.dataLayer.filter(x => x[0] === 'config' || x[0] === 'event').length), 1, 'site adds no history or interaction events (vendor history setting is a separate release check)');
 assert(v.google().some(r => r.url.includes('/g/collect')), 'fixture transport exercised');
 assert(!JSON.stringify(v.google()).includes(sentinel), 'no private query/referrer/input values in Google-bound fixture requests or headers');
 assert(!JSON.stringify(await v.page.evaluate(() => window.dataLayer)).includes(sentinel));
 assert.deepEqual(v.errors, []);
 await close(v, 'production + private inputs + download + hash history');
 const article = await visit(origin + '/guide/?q=' + sentinel + '#private-' + sentinel);
 const articleConfig = await article.page.evaluate(() => Array.from(window.dataLayer.find(x => x[0] === 'config')));
 assert.equal(articleConfig[2].page_location, origin + '/guide/');
 assert.equal(articleConfig[2].page_referrer, '');
 const beforeInput = article.requests.length;
 await usePlanner(article.page);
 assert(!JSON.stringify(article.requests.slice(beforeInput)).includes(sentinel), 'no private inputs sent to any destination after editing');
 assert(!JSON.stringify(article.google()).includes(sentinel));
 await close(article, 'production guide + private inputs + real download');

 for (const url of ['http://localhost/', 'http://127.0.0.1/', 'https://preview.pages.dev/', 'https://hijoshoku-navi.pages.dev/', 'http://hijoshoku-navi.com/', 'https://www.hijoshoku-navi.com/', 'https://hijoshoku-navi.com.evil.example/', 'https://hijoshoku-navi.com:8443/', origin + '/unknown-' + sentinel + '/', origin + '/404.html']) {
  const v = await visit(url); assert.deepEqual(v.google(), [], url + ': zero Google requests'); await close(v, url);
 }
 const fallback = await visit(origin + '/unknown-' + sentinel + '/', { fallback: true });
 assert.deepEqual(fallback.google(), [], 'home HTML fallback is not a known canonical page'); await close(fallback, 'unknown path with 200 home fallback');
 for (const [name, mutate] of [
  ['disabled', html => html.replace(/data-analytics-enabled=(?:"true"|true)/, 'data-analytics-enabled="false"')],
  ['invalid ID', html => html.replaceAll(id, 'G-bad&injected=1')],
  ['missing ID', html => html.replaceAll(id, '')],
  ['short ID', html => html.replaceAll(id, 'G-1')],
 ]) {
  const v = await visit(origin + '/', { mutate }); assert.deepEqual(v.google(), [], name); await close(v, name);
 }
 for (const mode of ['analyticsFailure', 'remoteFailure', 'noJS']) {
  const v = await visit(origin + '/', { mode });
  if (mode !== 'noJS') await usePlanner(v.page);
  else {
   const planner = v.page.locator('[data-testid="stock-planner"]');
   await planner.locator('[name="foodNotes"]').fill(sentinel);
   assert.equal(await planner.locator('form').count(), 0);
   assert(await planner.locator('[data-calculate]').isDisabled());
   assert(await planner.locator('[data-download]').isDisabled());
  }
  if (mode !== 'remoteFailure') assert.deepEqual(v.google(), []);
  assert(!JSON.stringify(v.google()).includes(sentinel));
  await close(v, mode);
 }
 // Inspect every published HTML's actual static external link destinations/text.
 const audit = await browser.newContext({ javaScriptEnabled: false });
 const page = await audit.newPage();
 for (const file of (await readdir(output, { recursive: true })).filter(f => f.endsWith('.html'))) {
  await page.setContent(await readFile(path.join(output, file), 'utf8'));
  const links = await page.locator('a[href^="https://"], a[href^="http://"]').evaluateAll(as => as.map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
  for (const link of links) {
   const u = new URL(link.href);
   if (u.origin === origin) continue;
   assert(!u.username && !u.password, 'no credentials in links');
   if (u.search) {
    assert.equal(u.origin, 'https://www.amazon.co.jp', 'only fixed product search URLs have queries');
    assert.deepEqual([...u.searchParams.keys()], ['k']);
    assert(['井村屋 えいようかん', '尾西 ひだまりパン プレーン', '尾西 わかめごはん 100g', '尾西 五目ごはん 100g', '尾西 白飯 100g'].includes(u.searchParams.get('k')), 'query is a reviewed product name, not visitor input');
   }
   assert(!/email|user_?id|phone|address|name|memo|note|gclid|fbclid/i.test([...u.searchParams.keys()].join(' ')), 'no personal/advertising query fields');
   assert(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(link.href), 'no email in outbound URL');
   evidence.outboundLinks.push({ file, ...link });
  }
 }
 await audit.close();
 // Copy the real source, then swap only the topic in an isolated fixture.
 const fixture = await mkdtemp(path.join(tmpdir(), 'analytics-topic-'));
 for (const file of ['layouts', 'assets', 'static', 'themes', 'hugo.toml', 'docs', 'data']) await cp(file, path.join(fixture, file), { recursive: true });
 const topic = JSON.parse(await readFile('data/editorial.json', 'utf8'));
 topic.identity.title = '小さな庭の手帖'; topic.featured = []; topic.tools.stockPlanner = false;
 await writeFile(path.join(fixture, 'data/editorial.json'), JSON.stringify(topic));
 await mkdir(path.join(fixture, 'content/garden'), { recursive: true });
 await writeFile(path.join(fixture, 'content/garden/index.md'), '---\ntitle: 庭の記録（テスト用）\n---\n植物の記録。\n');
 const altOutput = path.join(fixture, 'public'); build(altOutput, fixture);
 for (const file of ['index.html', 'garden/index.html']) assert.doesNotMatch(await readFile(path.join(altOutput, file), 'utf8'), /G-28DEZ2ELZ3|data-analytics|\/analytics\./, 'topic fixture contains no site analytics');
 const alt = await visit(origin + '/', { root: altOutput }); assert.deepEqual(alt.google(), []); await close(alt, 'different topic at production origin');
 // Build-time off switch must omit the loader as well as runtime requests.
 const config = JSON.parse(await readFile('data/analytics.json', 'utf8')); config.enabled = false;
 await writeFile(path.join(fixture, 'data/analytics.json'), JSON.stringify(config));
 await cp('data/editorial.json', path.join(fixture, 'data/editorial.json'));
 const disabledOutput = path.join(fixture, 'disabled'); build(disabledOutput, fixture);
 assert.doesNotMatch(await readFile(path.join(disabledOutput, 'index.html'), 'utf8'), /data-analytics|\/analytics\./);
 const privacy = await readFile('content/privacy/index.md', 'utf8');
 assert.match(privacy, /Google Analytics/); assert.match(privacy, /Cookie/);
 assert.match(privacy, /https:\/\/policies.google.com\/privacy/); assert.match(privacy, /https:\/\/tools.google.com\/dlpage\/gaoptout/);
 console.log('PASS production-only analytics, local/preview/topic/404 exclusion, privacy, private input non-transmission, failure/noJS — LOCAL MOCK, NOT GOOGLE RECEIPT');
} finally {
 await writeFile(path.join(artifacts, 'analytics-fixture-evidence.json'), JSON.stringify(evidence, null, 2));
 await browser.close();
}
