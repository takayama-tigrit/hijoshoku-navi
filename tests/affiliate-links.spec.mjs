import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium,devices} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';

const routes={
 '/guide/':['尾西 白飯 100g'],
 '/posts/emergency-food-snacks/':['井村屋 えいようかん'],
 '/ranking/':['尾西 ひだまりパン プレーン','尾西 白飯 100g','井村屋 えいようかん'],
 '/posts/alpha-mai-osusume/':['尾西 白飯 100g','尾西 五目ごはん 100g','尾西 わかめごはん 100g'],
 '/posts/emergency-food-set-check/':['尾西 ごはんシリーズ CY','尾西 ごはんシリーズ DW'],
 '/posts/emergency-food-side-dishes/':['ハウス 温めずにおいしいカレー まろやか野菜カレー 200g','ハウス 温めずにおいしいカレー 香りたつキーマカレー 180g']
};
const root=await mkdtemp(path.join(tmpdir(),'rakuten-links-'));
const output=path.join(root,'public');
const artifacts=process.env.ARTIFACT_DIR||path.join(root,'evidence');
await mkdir(artifacts,{recursive:true});
const build=(dest,args=[])=>execFileSync(process.env.HUGO_BIN||'hugo',['--panicOnWarning','--minify','--destination',dest,...args],{stdio:'pipe'});
build(output);
let serving=output;
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');const filename=path.resolve(serving,'.'+u.pathname+(u.pathname.endsWith('/')?'index.html':''));
 assert(filename.startsWith(serving+path.sep));const body=await readFile(filename);
 res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(filename)]||'application/octet-stream'}).end(body);
}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions());const checks=[];
try{
 for(const device of [{name:'mobile',...devices['iPhone 13']},{name:'desktop',viewport:{width:1440,height:1000}},{name:'noJS',...devices['iPhone 13'],javaScriptEnabled:false}]){
  const {name,...options}=device;const context=await browser.newContext(options);const page=await context.newPage();const external=[];
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===base)return r.continue();external.push(u.href);return r.abort();});
  for(const [route,terms]of Object.entries(routes)){
   assert.equal((await page.goto(base+route)).status(),200);
   const anchors=page.locator('.article-content a[data-commerce="rakuten"]');
   assert.equal(await anchors.count(),terms.length,route+': existing purchase links must use official Rakuten codes');
   const notice=page.locator('[data-testid="affiliate-disclosure"]');assert.equal(await notice.count(),1);
   assert.match(await notice.innerText(),/広告.*アフィリエイト/);
   const box=await notice.boundingBox();assert(box.y>=0&&box.y+box.height<=page.viewportSize().height,'disclosure must fit first mobile/desktop view');
   const slug=route.replaceAll('/','-');
   await page.screenshot({path:path.join(artifacts,`${name}${slug}first.png`)});
   for(let i=0;i<terms.length;i++){
    const a=anchors.nth(i),href=await a.getAttribute('href'),u=new URL(href);
    assert.equal(u.origin,'https://af.moshimo.com');assert.equal(u.pathname,'/af/c/click');assert(!u.username&&!u.password&&!u.hash);
    assert.deepEqual([...u.searchParams.keys()].sort(),['a_id','p_id','pc_id','pl_id','url']);
    for(const[k,v]of Object.entries({a_id:'5810105',p_id:'54',pc_id:'54',pl_id:'616'}))assert.equal(u.searchParams.get(k),v);
    const destination=new URL(u.searchParams.get('url'));assert.equal(destination.origin,'https://search.rakuten.co.jp');assert.equal(destination.pathname,'/search/mall');
    assert.deepEqual([...destination.searchParams.keys()],['sitem']);assert.equal(destination.searchParams.get('sitem'),terms[i]);
    assert.equal(await a.innerText(),"楽天市場で探す →");assert.equal(await a.getAttribute("aria-label"),`楽天市場で「${terms[i]}」を検索`);
    assert.deepEqual((await a.getAttribute('rel')).split(/\s+/).sort(),['nofollow','sponsored']);assert.equal(await a.getAttribute('referrerpolicy'),'origin');
    assert(!await a.evaluate(e=>e.closest('details:not([open])')),'purchase link is not hidden');
   }
   assert.equal(await page.locator('a[href*="amazon.co.jp"]').count(),0,'unapproved Amazon affiliation is not introduced');
   assert.equal(await page.locator('img[src*="moshimo.com"],script[src*="moshimo.com"]').count(),0,'no new impression pixel or vendor script');
   assert.equal(external.filter(u=>u.includes('moshimo.com')).length,0,'no ASP request on viewing');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(name!=='noJS'){await anchors.first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${name}${slug}action.png`)});}
   checks.push(`${name}: ${route} exact ${terms.length} links, disclosure, no view-time ASP requests`);
  }
  for(const route of ['/','/about/','/privacy/','/photo-credits/']){
   await page.goto(base+route);assert.equal(await page.locator('[data-testid="affiliate-disclosure"],a[data-commerce]').count(),0,'no article ad banner or sales link injected into '+route);
  }
  await page.goto(base+'/privacy/');assert.match(await page.locator('.article-content').innerText(),/もしもアフィリエイト/);assert.match(await page.locator('.article-content').innerText(),/Cookie/);
  if(name==='mobile')await page.screenshot({path:path.join(artifacts,'mobile-privacy.png'),fullPage:true});
  await context.close();
 }
 // An alternate site's build must never reuse this media's tracking codes.
 const other=path.join(root,'other');build(other,['--baseURL','https://preview.example/']);serving=other;
 const c=await browser.newContext({javaScriptEnabled:false});const page=await c.newPage();await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 for(const [route,terms]of Object.entries(routes)){
  await page.goto(base+route);assert.equal(await page.locator('a[href*="af.moshimo.com"],[data-testid="affiliate-disclosure"]').count(),0);
  assert.equal(await page.locator('a[href^="https://search.rakuten.co.jp/search/mall"]').count(),terms.length,'ordinary links preserve no-JS preview functionality');
  assert.equal(await page.locator('.product-photo,img[src*="rakuten.co.jp"],img[src*="r10s.jp"]').count(),0,'inactive previews omit ASP-supplied product photos and src');
  assert.equal(await page.locator('.product-name').count(),terms.length,'product names survive without photos');
  assert.equal(await page.locator('.product-condition mark,.product-note mark').count(),terms.length*2,'marked conditions survive without photos');
  assert.equal(await page.locator('.product-source').count(),terms.length,'official links survive without photos');
 }
 await c.close();checks.push('different-baseURL build falls back to ordinary searches without affiliate disclosure');
 // Cloudflare preview builds retain the production baseURL, so inspect its actual branch signal too.
 for(const branch of ['feat/affiliate-qa','main']){
  const dest=path.join(root,branch==='main'?'cf-main':'cf-preview');
  execFileSync(process.env.HUGO_BIN||'hugo',['--panicOnWarning','--minify','--destination',dest],{stdio:'pipe',env:{...process.env,CF_PAGES_BRANCH:branch}});
  for(const route of Object.keys(routes)){
   const html=await readFile(path.join(dest,route,'index.html'),'utf8');
   assert.equal(html.includes('https://af.moshimo.com/af/c/click'),branch==='main','only Cloudflare main enables affiliate codes');
   assert.equal(html.includes('https://thumbnail.image.rakuten.co.jp/'),branch==='main','only Cloudflare main emits ASP-supplied image src');
  }
 }
 checks.push('Cloudflare non-main previews use ordinary links; main keeps approved affiliate links');
 console.log(JSON.stringify({status:'PASS',checks,artifacts,output},null,2));
 await writeFile(path.join(artifacts,'affiliate-result.json'),JSON.stringify({status:'PASS',kind:'local DOM/browser; external ASP traffic blocked, not click/commission proof',checks,artifacts,output},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
