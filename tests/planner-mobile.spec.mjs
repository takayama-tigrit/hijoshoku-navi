import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, devices } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
import * as arithmetic from '../assets/js/stock-planner.js';

const output = await mkdtemp(path.join(tmpdir(), 'planner-mobile-'));
const evidence = process.env.ARTIFACT_DIR || await mkdtemp(path.join(tmpdir(), 'planner-mobile-evidence-'));
await mkdir(evidence, { recursive: true });
execFileSync(process.env.HUGO_BIN || 'hugo', ['--minify', '--panicOnWarning', '--destination', output]);
const server = http.createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(output, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(output + path.sep)) return res.writeHead(403).end();
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp' })[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true, ...browserOptions() });
const failures = [], checks = [], metrics = [], screenshots = [], errors = [], external = [];
const probe = async (name, fn) => { try { await fn(); checks.push(name); } catch (e) { failures.push({ name, error:e.message }); } };
try {
  await probe('integer/mL adjustment contract', () => {
    assert.equal(typeof arithmetic.adjustQuantity, 'function', 'one tested adjustment contract for enabled state and arithmetic');
    for (const [name, value, delta, expected] of [
      ['people','2',1,'3'], ['people','1',-1,null], ['people','12',1,null],
      ['mealsPerDay','3',-1,'2'], ['mealsPerDay','1',-1,null], ['mealsPerDay','6',1,null],
      ['meals','0',-1,null], ['meals','9999',1,'10000'], ['meals','10000',1,null],
      ['litres','12',-1,'11'], ['litres','0.5',-0.5,'0'], ['litres','0',-0.5,null],
      ['litres','17.999',0.5,'18.499'], ['litres','1999',2,null], ['litres','0.001',-1,null],
      ['litres','17.9999999999',1,null], ['litres','5e-324',1,null], ['litres','',1,null],
      ['people','0',1,null], ['people','2',0.5,null], ['unknown','2',1,null]
    ]) assert.equal(arithmetic.adjustQuantity(name, value, delta), expected, `${name}/${value}/${delta}`);
  });
  for (const width of [320, 390, 430, 1440]) {
    const mobile = width < 700;
    const context = await browser.newContext({ ...(mobile ? devices['iPhone 13'] : {}), viewport:{width,height:960}, reducedMotion:'reduce', acceptDownloads:true });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(2000);
    page.on('pageerror', e => errors.push(e.message));
    for (const route of ['/', '/guide/']) {
      const label = `${route === '/' ? 'home' : 'guide'}-${width}`;
      await page.goto(base + route, { waitUntil:'networkidle' });
      const planner = page.locator('[data-testid="stock-planner"]');
      await planner.scrollIntoViewIfNeeded();
      const shot = path.join(evidence, `planner-${label}.png`);
      await planner.screenshot({path:shot,scale:'css'}); screenshots.push(shot);
      const geometry = await planner.evaluate(root => {
        const fields = root.querySelector('.planner-fields'), button = root.querySelector('[data-calculate]');
        const style = getComputedStyle(fields), rect = fields.getBoundingClientRect(), action = button.getBoundingClientRect();
        return { columns:style.gridTemplateColumns, width:rect.width, buttonWidth:action.width, buttonBackground:getComputedStyle(button).backgroundColor, pageOverflow:document.documentElement.scrollWidth > innerWidth };
      });
      metrics.push({label,...geometry});
      await probe(label + ': layout and shared brand tokens', async () => {
        if (mobile) assert.equal(geometry.columns.trim().split(/\s+/).length, 1, 'mobile controls must not remain in the legacy two-column grid');
        assert(!geometry.pageOverflow, 'no page overflow');
        assert(geometry.buttonWidth >= geometry.width - 2, 'primary action spans the control area');
        assert.equal(geometry.buttonBackground, 'rgb(229, 222, 84)', 'primary action uses existing brand yellow');
      });
      for (const name of ['people','litres','meals','mealsPerDay']) {
        await probe(label + ': tap-only ' + name, async () => {
          const input = planner.locator(`[name="${name}"]`), initial = await input.inputValue();
          for (const delta of ['1','-1']) {
            const button = planner.locator(`[data-adjust="${name}"][data-delta="${delta}"]`);
            assert.equal(await button.count(), 1, name + ' needs visible ±1 controls');
            assert.match(await button.innerText(), /1/);
            const box = await button.boundingBox(); assert(box.width >= 48 && box.height >= 48);
            assert(await button.getAttribute('aria-label'));
            if (mobile) await button.tap(); else await button.click();
            assert.equal(await input.inputValue(), String(Number(initial) + (delta === '1' ? 1 : 0)));
            assert(!await page.evaluate(() => document.activeElement?.matches('input[type="number"],textarea,select')), 'tap must not focus a typing/picker field');
          }
          const parts = await planner.locator(`[data-adjust="${name}"][data-delta="1"]`).evaluate(button => {
            const input = button.parentElement.querySelector('input'); const b = button.getBoundingClientRect(), i = input.getBoundingClientRect();
            return { topDifference:Math.abs(b.top-i.top), heightDifference:Math.abs(b.height-i.height), inputWidth:i.width };
          });
          assert(parts.topDifference <= 1 && parts.heightDifference <= 1 && parts.inputWidth >= 60, 'aligned, readable stepper');
        });
      }
      await probe(label + ': tap period and keyboard', async () => {
        const radio = planner.locator('input[name="days"][value="7"]');
        assert.equal(await radio.count(), 1, '3/7 days should be visible choices, not a picker');
        await radio.check(); assert.equal(await planner.locator('[data-output="required"]').innerText(), '42L');
        await radio.focus(); await page.keyboard.press('ArrowLeft');
        assert(await planner.locator('input[name="days"][value="3"]').isChecked());
        const plus = planner.locator('[data-adjust="people"][data-delta="1"]');
        await plus.focus(); await page.keyboard.press('Enter');
        assert.equal(await planner.locator('[name="people"]').inputValue(),'3');
        await planner.locator('[data-adjust="people"][data-delta="-1"]').click();
      });
      await probe(label + ': boundaries and precise water', async () => {
        for (const [name, value, delta] of [['people','1','-1'],['people','12','1'],['meals','0','-1'],['mealsPerDay','6','1'],['mealsPerDay','1','-1'],['litres','0','-1']]) {
          await planner.locator(`[name="${name}"]`).fill(value);
          assert(await planner.locator(`[data-adjust="${name}"][data-delta="${delta}"]`).isDisabled());
        }
        await planner.locator('[name="litres"]').fill('0.5');
        await planner.locator('[data-adjust="litres"][data-delta="-0.5"]').click();
        assert.equal(await planner.locator('[name="litres"]').inputValue(),'0');
      });
      // Fresh page: prove a task from initial example through changed value and real saved file, without typing.
      await page.goto(base + route, {waitUntil:'networkidle'});
      await probe(label + ': tap-only completion and real file', async () => {
        await planner.locator('[data-adjust="people"][data-delta="1"]').click();
        await planner.locator('[data-adjust="litres"][data-delta="1"]').click();
        await planner.locator('[data-adjust="meals"][data-delta="-1"]').click();
        await planner.locator('[data-adjust="mealsPerDay"][data-delta="-1"]').click();
        await planner.locator('[data-calculate]').click();
        const pos = await planner.locator('[data-results]').boundingBox();
        assert(pos.y >= (mobile ? 73 : 70), 'fixed navigation must not cover result');
        const downloadEvent = page.waitForEvent('download'); await planner.locator('[data-download]').click();
        const dl = await downloadEvent, filename = path.join(evidence, `memo-${label}.txt`); await dl.saveAs(filename);
        const memo = await readFile(filename,'utf8');
        for (const text of ['人数：3人／目標：3日','在庫：13L','不足：14L','在庫：17食分','1人1日：2食分','買い足す主食：1食分','水の数量：入力値','主食の数量：入力値']) assert(memo.includes(text),text);
        assert.equal(await page.evaluate(() => localStorage.length),0);
        assert.equal(new URL(page.url()).search,'');
      });
    }
    await context.close();
  }
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  await writeFile(path.join(evidence,'planner-mobile-report.json'),JSON.stringify({status:failures.length?'FAIL':'PASS',checks:checks.length,failures,metrics,screenshots},null,2));
  console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks:checks.length,failures,evidence},null,2));
  assert.equal(failures.length,0,'mobile planner contract');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
