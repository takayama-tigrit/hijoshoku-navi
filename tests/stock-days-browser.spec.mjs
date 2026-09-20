import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, devices } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
const output=await mkdtemp(path.join(tmpdir(),'stock-days-'));
const evidence=process.env.ARTIFACT_DIR || await mkdtemp(path.join(tmpdir(),'stock-days-evidence-'));
await mkdir(evidence,{recursive:true});
execFileSync(process.env.HUGO_BIN || 'hugo',['--baseURL', 'http://localhost/', '--minify','--panicOnWarning','--destination',output]);
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(p.endsWith('/'))p+='index.html';const file=path.join(output,p);const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...browserOptions()});
const network=[],errors=[],shots=[];
async function download(page,p,name){const event=page.waitForEvent('download');await p.locator('[data-download]').click();const d=await event;await d.saveAs(path.join(evidence,name));return readFile(path.join(evidence,name),'utf8');}
try{
 for(const mode of ['normal','noJS','scriptFailure']){
  const context=await browser.newContext({...devices['iPhone 13'],javaScriptEnabled:mode!=='noJS',acceptDownloads:true});
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(mode==='scriptFailure'&&u.pathname.includes('stock-planner'))return route.abort();if(u.origin!==base){network.push({external:u.origin,path:u.pathname});return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>network.push({mode,url:r.url(),method:r.method()}));
  for(const route of ['/','/guide/']){
   await page.goto(base+route,{waitUntil:'networkidle'});const p=page.locator('[data-testid="stock-planner"]');assert.equal(await p.count(),1);
   assert.equal(await p.locator('form').count(),0);assert.equal(await page.locator('#stock-check').count(),1);assert.equal(await p.locator('#water-check').count(),1);assert.equal(await p.locator('#food-inventory-help').count(),1);
   if(mode!=='normal'){assert(await p.locator('[data-calculate]').isDisabled(), mode + ': initial action must stay disabled');assert(await p.locator('[data-download]').isDisabled());assert(await p.locator('[data-results]').isHidden());assert(await p.locator('.planner-formula').isVisible());continue;}
   assert.equal(await p.locator('[name="people"]').inputValue(),'2');assert.match(await p.locator('[data-example]').innerText(),/計算例/);
   assert.equal(await p.locator('[data-output="waterDays"]').innerText(),'水 約2日分');assert.equal(await p.locator('[data-output="foodDays"]').innerText(),'主食 約3日分');
   const label=route==='/'?'home':'guide';await p.scrollIntoViewIfNeeded();let shot=path.join(evidence,`${label}-390-default.png`);await p.screenshot({path:shot});shots.push(shot);
   // Independent review repros: retain per-stock provenance, helper safety, precision UI/save.
   const failures=[];
   const reset=async()=>{await page.goto(base+route,{waitUntil:'networkidle'});};
   const origin=(key)=>p.locator(`[data-stock-origin="${key}"]`).innerText({timeout:1500});
   const repro=async(name,fn)=>{try{await reset();await fn();}catch(e){failures.push(name+': '+e.message);}};
   await repro('UX01 partial examples',async()=>{
    for(const key of ['people','days','confirm','litres','meals']){
     await reset();
     if(key==='confirm')await p.locator('[data-calculate]').click();
     else if(key==='days')await p.locator('[name="days"][value="7"]').check();
     else await p.locator(`[name="${key}"]`).fill(key==='people'?'4':key==='litres'?'13':'19');
     for(const stock of ['litres','meals'])assert.match(await origin(stock),stock===key?/入力値/:/初期例/);
     const text=await download(page,p,`${label}-origin-${key}.txt`);
     assert.match(text,key==='litres'?/水の数量：入力値/:/水の数量：初期例/);
     assert.match(text,key==='meals'?/主食の数量：入力値/:/主食の数量：初期例/);
    }
    await reset();await p.locator('[name="litres"]').evaluate(e=>e.value='13');
    const text=await download(page,p,`${label}-eventless-origin.txt`);
    assert.match(text,/水の数量：入力値/);assert.match(text,/主食の数量：初期例/);
    assert.match(await origin('litres'),/入力値/);
   });
   await repro('UX02 mobile helpers',async()=>{
    const helper=(name,delta)=>p.locator(`[data-adjust="${name}"][data-delta="${delta}"]`);
    for(const button of await p.locator('[data-adjust]').all()){
     assert.equal(await button.getAttribute('type'),'button');assert(await button.getAttribute('aria-label'));
     const box=await button.boundingBox();assert(box.width>=44&&box.height>=44);
    }
    await helper('people','1').click({timeout:1500});assert.equal(await p.locator('[name="people"]').inputValue(),'3');
    await helper('people','-1').click();assert.equal(await p.locator('[name="people"]').inputValue(),'2');
    await helper('litres','0.5').click();assert.equal(await p.locator('[name="litres"]').inputValue(),'12.5');
    await helper('litres','2').click();assert.equal(await p.locator('[data-output="shortage"]').innerText(),'3.5L');assert.match(await origin('meals'),/初期例/);
    await helper('meals','1').click();await helper('meals','-1').click();assert.equal(await p.locator('[name="meals"]').inputValue(),'18');
    for(const [name,value,delta] of [['litres','','2'],['litres','-1','2'],['litres','17.9999999999','2'],['litres','5e-324','2'],['litres','2001','2'],['litres','1999','2'],['people','12','1'],['people','0','1'],['meals','0','-1']]){
     await p.locator(`[name="${name}"]`).fill(value);assert(await helper(name,delta).isDisabled());await helper(name,delta).evaluate(e=>e.click());assert.equal(await p.locator(`[name="${name}"]`).inputValue(),value, 'do not clamp or repair');
    }
    await p.locator('[name="litres"]').fill('0');await helper('litres','0.5').click();assert.equal(await p.locator('[name="litres"]').inputValue(),'0.5');
    await reset();await p.locator('[name="people"]').fill('4');
    await p.locator('[name="litres"]').scrollIntoViewIfNeeded();let s=path.join(evidence,`${label}-390-helpers-viewport.png`);await page.screenshot({path:s,scale:'css'});shots.push(s);
    await p.locator('[data-results]').scrollIntoViewIfNeeded();s=path.join(evidence,`${label}-390-partial-results-viewport.png`);await page.screenshot({path:s,scale:'css'});shots.push(s);
   });
   await repro('CODE01/02 water precision UI and save',async()=>{
    assert.equal(await p.locator('[name="litres"]').getAttribute('step'),'0.001');
    for(const value of ['17.9999999999','15.9999999999','5e-324','0.0001']){
     await p.locator('[name="litres"]').fill(value);assert.equal(await p.locator('[data-output="waterDays"]').innerText(),'水：未確認');
     assert.match(await p.locator('[data-planner-error]').innerText(),/小数第3位/);
     const text=await download(page,p,`${label}-precision-${value}.txt`);assert.match(text,/水：未確認/);assert(!text.includes('買い足す2Lボトル：'));assert.match(text,/主食：約3日分/);
    }
    for(const [value,shortage,buy,days] of [['17.999','0.001','1','約2.9日分'],['15.999','2.001','2','約2.6日分'],['0.001','17.999','9','0.1日未満']]){
     await p.locator('[name="litres"]').fill(value);assert.equal(await p.locator('[data-output="shortage"]').innerText(),shortage+'L');assert.equal(await p.locator('[data-output="buy"]').innerText(),buy+'本');
     const text=await download(page,p,`${label}-accepted-${value}.txt`);assert.match(text,new RegExp('水：'+days));assert(text.includes('不足：'+shortage+'L'));assert(text.includes('買い足す2Lボトル：'+buy+'本'));
    }
   });
   assert.deepEqual(failures,[],'review blockers');await reset();
   await page.keyboard.press('Tab');
   for(const control of await p.locator('input,select,button').all()){if(await control.isVisible())assert((await control.boundingBox()).height>=44);}
   assert.equal(await p.locator('.stock-notes').getAttribute('open'),null);
   let memo=await download(page,p,`${label}-example.txt`);assert.match(memo,/初期値は計算例/);assert.match(memo,/在庫：12L/);
   await p.locator('[name="days"][value="7"]').check();assert.equal(await p.locator('[data-output="foodBuy"]').innerText(),'24食分');
   await p.locator('[name="litres"]').fill('12.5');assert.equal(await p.locator('[data-output="shortage"]').innerText(),'29.5L');assert.equal(await p.locator('[data-output="buy"]').innerText(),'15本');
   await p.locator('[name="mealsPerDay"]').fill('2');assert.equal(await p.locator('[data-output="foodDays"]').innerText(),'主食 約4.5日分');
   await p.locator('[name="litres"]').fill('0.001');assert.equal(await p.locator('[data-output="waterDays"]').innerText(),'水 0.1日未満');
   await p.locator('[name="litres"]').fill('');assert.equal(await p.locator('[data-output="waterDays"]').innerText(),'水：未確認');assert.match(await p.locator('[data-output="foodDays"]').innerText(),/4.5/);
   await p.locator('.stock-notes summary').click();await p.locator('[name="foodNotes"]').fill('<img src=x onerror=alert(1)> PRIVATE_V7');
   await p.locator('[name="litres"]').evaluate(e=>e.value='42'); // No input event: download must re-evaluate.
   memo=await download(page,p,`${label}-changed.txt`);assert.match(memo,/在庫：42L/);assert.match(memo,/買い足す2Lボトル：0本/);assert.match(memo,/PRIVATE_V7/);assert.equal(await p.locator('img[src=x]').count(),0);
   await p.locator('[name="people"]').fill('0');memo=await download(page,p,`${label}-invalid.txt`);assert.match(memo,/水：未確認/);assert.match(memo,/主食：未確認/);assert(!memo.includes('在庫：42L'));assert.match(memo,/PRIVATE_V7/);
   assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(new URL(page.url()).search,'');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  if(mode==='normal')for(const route of ['/guide/','/ranking/','/posts/alpha-mai-osusume/']){await page.goto(base+route);assert.equal(await page.locator('[data-viz="meals"],[data-quantity-id="yokan-box"]').count(),0);let shot=path.join(evidence,`${route.replaceAll('/','-')}-390-first.png`);await page.screenshot({path:shot});shots.push(shot);}
  await context.close();
 }
 assert(!network.some(r=>r.external),'local-only inputs must not create external requests');assert(!network.some(r=>r.url?.includes('PRIVATE_V7')));assert.deepEqual(errors,[]);
 await writeFile(path.join(evidence,'browser-report.json'),JSON.stringify({status:'PASS',screenshotsPaths:shots,errors,network},null,2));console.log(JSON.stringify({status:'PASS',evidence,screenshotsPaths:shots}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
