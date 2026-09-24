import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import {chromium,devices} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';

const root=process.cwd(),output=process.env.SEO_OUTPUT,artifacts=process.env.ARTIFACT_DIR;
assert.ok(output&&artifacts,'SEO_OUTPUT and ARTIFACT_DIR required');
await mkdir(artifacts,{recursive:true});
const json=async p=>JSON.parse(await readFile(path.join(root,p),'utf8'));
const routes=['/guide/','/ranking/',...['alpha-mai-osusume','emergency-canned-food','emergency-food-for-one','emergency-food-set-check','emergency-food-side-dishes','emergency-food-snacks','emergency-food-storage','emergency-food-to-go','emergency-water-bottles','pack-rice-or-alpha-rice','rolling-stock-routine','supermarket-emergency-food-list'].map(s=>'/posts/'+s+'/')];
const imageRecords=Object.values((await json('data/product-images.json')).images);
const visual=(await json('data/content14-visual.json')).groups;
const allowed=new Set([...imageRecords.map(i=>i.image),...Object.values(visual).flatMap(g=>g.entries.map(e=>e.photo?.src).filter(s=>s?.startsWith('https:')))]);
const imageCache=new Map(),external=new Set();
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const start=Object.fromEntries(await Promise.all(routes.map(async r=>[r,await hash(path.join(output,r,'index.html'))])));
const server=http.createServer(async(req,res)=>{try{
 let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';
 const f=path.resolve(output,'.'+p);assert.ok(f.startsWith(path.resolve(output)+path.sep));
 const bytes=await readFile(f);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'}).end(bytes);
}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions()),cases=[];
async function ready(page){
 for(let i=0;i<60;i++){
  if(await page.evaluate(()=>[...document.querySelectorAll('link[rel=stylesheet]')].every(l=>{try{return l.sheet?.cssRules.length>0;}catch{return false;}})))return;
  await new Promise(r=>setTimeout(r,50));
 }throw Error('local stylesheets not ready');
}
async function decode(img){await img.scrollIntoViewIfNeeded();await img.evaluate(i=>i.decode());assert.ok(await img.evaluate(i=>i.naturalWidth>0&&!!i.alt));}
try{
 for(const js of [true,false])for(const width of [320,390,1440]){
  const context=await browser.newContext({...(width<700?devices['iPhone 13']:{}),viewport:{width,height:900},javaScriptEnabled:js,reducedMotion:'reduce'});
  await context.route('**/*',async route=>{
   const url=route.request().url();if(new URL(url).origin===base)return route.continue();
   if(allowed.has(url)&&route.request().resourceType()==='image'){
    if(!imageCache.has(url)){
     const response=await route.fetch({maxRedirects:0});assert.equal(response.status(),200,url);
     imageCache.set(url,{body:await response.body(),contentType:response.headers()['content-type']});
    }
    return route.fulfill({status:200,...imageCache.get(url)});
   }
   external.add(new URL(url).origin+new URL(url).pathname);return route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const r of routes){
   const response=await page.goto(base+r,{waitUntil:'load'});assert.equal(response.status(),200);await ready(page);
   assert.equal(await page.locator('h1').count(),1);
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,inner:innerWidth}));
   assert.ok(dimensions.scroll<=width+1&&dimensions.scroll<=dimensions.client+1,JSON.stringify({r,width,dimensions}));
   const related=page.locator('[data-testid=related-article] .related-read');assert.equal(await related.count(),3,r);
   const hrefs=await related.evaluateAll(els=>els.map(e=>e.getAttribute('href')));assert.equal(new Set(hrefs).size,3);assert.ok(!hrefs.includes(r));
   if(r==='/ranking/'){
    await page.screenshot({path:path.join(artifacts,`ranking-${width}-${js?'js':'nojs'}-first.png`)});
    assert.equal(await page.locator('[data-testid=affiliate-disclosure]').count(),1);
    // The expanded hub, rather than the legacy three-product table, is the first choice entry.
    assert.equal(await page.locator('.article-header .article-compare-jump').count(),0,'legacy jump must not preempt the new hub');
    const choices=page.locator('[data-food-choice]');assert.equal(await choices.count(),6);
    for(let i=0;i<6;i++){
     const entry=choices.nth(i);await decode(entry.locator('img'));
     assert.ok((await entry.locator('mark').innerText()).length>0);
     const link=entry.locator('.food-detail'),href=await link.getAttribute('href');
     await link.scrollIntoViewIfNeeded();if(js)await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     await link.click();await page.waitForURL(base+(href.startsWith('#')?r:'')+href);await ready(page);
     const target=href.startsWith('#')?page.locator('#bread-and-rice').locator('xpath=following-sibling::*[self::h2][1]'):page.locator('h1');
     const b=await target.boundingBox();assert.ok(b&&b.y>=0&&b.y<900,'destination content in viewport: '+href);
     await page.goBack({waitUntil:'load'});await ready(page);
    }
    await choices.first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`ranking-${width}-${js?'js':'nojs'}-choices.png`)});
   }
   if(r==='/posts/alpha-mai-osusume/'){
    for(const img of await page.locator('.article-content .product-photo img').all())await decode(img);
    assert.equal(await page.locator('#compare-other-white-rice').count(),1);
    const jump=page.locator('[data-testid=next-action] a[href="#compare-other-white-rice"]');
    await jump.scrollIntoViewIfNeeded();await jump.click();await page.waitForURL(base+r+'#compare-other-white-rice');
    const heading=page.locator('#compare-other-white-rice').locator('xpath=following-sibling::*[self::h2][1]');
    const hb=await heading.boundingBox();assert.ok(hb&&hb.y>=0&&hb.y<900,'alpha jump reaches actual heading');
    assert.equal(await page.locator('[data-alpha-maker]').count(),2);
    for(const maker of await page.locator('[data-alpha-maker]').all()){
     assert.ok((await maker.locator('mark').innerText()).includes('℃'));
     const href=await maker.locator('a').getAttribute('href');assert.ok(href.startsWith('https:'));
    }
    await page.screenshot({path:path.join(artifacts,`alpha-${width}-${js?'js':'nojs'}-makers.png`)});
    const details=page.locator('details').filter({has:page.getByText('尾西の白飯と、量・水温・待ち時間を比べる',{exact:true})});
    await details.locator('summary').click();assert.equal(await details.getAttribute('open'),'');
    assert.equal(await details.locator('tbody tr').count(),3);
    assert.ok((await details.innerText()).includes('おかゆ290mL'));
    await details.locator('summary').click();assert.equal(await details.getAttribute('open'),null);
   }
   await related.first().scrollIntoViewIfNeeded();if(js)await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await related.first().click();await page.waitForURL(base+hrefs[0]);await ready(page);assert.equal(await page.locator('h1').count(),1);
   cases.push({route:r,width,js,related:hrefs,dimensions});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const end=Object.fromEntries(await Promise.all(routes.map(async r=>[r,await hash(path.join(output,r,'index.html'))])));assert.deepEqual(end,start,'snapshot changed during browser run');
 const report={status:'PASS',scope:'isolated candidate; desktop/mobile Chromium emulation, not physical iPhone or production',cases,caseCount:cases.length,realImageCount:imageCache.size,imageEvidence:'Exact allowlisted CDN bytes, cached in memory and decoded; no synthetic images',blockedExternal:[...external],startHashes:start,endHashes:end};
 await writeFile(path.join(artifacts,'browser-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,caseCount:report.caseCount,realImageCount:report.realImageCount,artifacts}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
