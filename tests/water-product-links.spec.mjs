import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium,devices} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';
const root=await mkdtemp(path.join(tmpdir(),'water-product-links-'));
const artifacts=process.env.ARTIFACT_DIR||path.join(root,'evidence');await mkdir(artifacts,{recursive:true});
const origin='https://hijoshoku-navi.com',slug='/posts/emergency-water-bottles/';
const offers=JSON.parse(await readFile('data/water-offers.json','utf8'));assert.equal(offers.mediaId,'689409');
function validateOffer(o){
 const a=o.officialCode.match(/<a[^>]*href="([^"]+)"/)[1].replaceAll('&amp;','&');
 const i=o.officialCode.match(/<img[^>]*src="([^"]+)"/)[1].replaceAll('&amp;','&');
 assert.equal(new URL(a,'https://af.moshimo.com').href,o.href);assert.equal(new URL(i,'https://af.moshimo.com').href,o.image);
 const u=new URL(o.href),src=new URL(o.source);assert.equal(u.origin,'https://af.moshimo.com');assert.equal(u.pathname,'/af/c/click');
 assert.deepEqual([...u.searchParams.keys()].sort(),['a_id','m','p_id','pc_id','pl_id','url']);
 for(const [k,v]of Object.entries({a_id:'5810105',p_id:'54',pc_id:'54',pl_id:'616',url:o.destination}))assert.equal(u.searchParams.get(k),v);
 assert.equal(new URL(o.image).origin,'https://thumbnail.image.rakuten.co.jp');assert.equal(src.searchParams.get('shop_site_id'),'689409');assert.equal(src.searchParams.get('promotion_id'),'54');
}
for(const o of Object.values(offers.offers)){validateOffer(o);for(const mutate of [x=>x.href+='&memo=private',x=>x.image=x.image.replace('300x300','80x80'),x=>x.destination+='wrong']){const copy=structuredClone(o);mutate(copy);assert.throws(()=>validateOffer(copy));}}
const disabledSource=path.join(root,'disabled-source');await mkdir(disabledSource);
for(const f of ['layouts','assets','static','themes','hugo.toml','docs','data','content'])await cp(f,path.join(disabledSource,f),{recursive:true});
const disabled=JSON.parse(await readFile('data/affiliate-links.json','utf8'));disabled.enabled=false;await writeFile(path.join(disabledSource,'data/affiliate-links.json'),JSON.stringify(disabled));
const outputs={};
for(const [mode,base,branch,extra] of [['main',origin+'/', 'main',['--buildDrafts']],['preview',origin+'/', 'qa-water',['--buildDrafts']],['local','http://localhost/','',['--buildDrafts']],['normal',origin+'/', 'main',[]],['disabled',origin+'/', 'main',['--buildDrafts','--source',disabledSource]]]){
 const dest=path.join(root,mode);outputs[mode]=dest;
 execFileSync(process.env.HUGO_BIN||'hugo',['--destination',dest,'--baseURL',base,'--environment','production','--panicOnWarning',...extra],{env:{...process.env,CF_PAGES_BRANCH:branch},stdio:'inherit'});
}
for(const f of ['index.html','index.xml','sitemap.xml','posts/index.html']){
 const html=await readFile(path.join(outputs.normal,f),'utf8');assert(html.includes(slug),'existing published URL remains discoverable');
 for(const draft of ['emergency-water-bottles-revision','emergency-food-tasting'])assert(!html.includes(`/posts/${draft}/`),'unapproved drafts must stay private');
}
assert((await readFile(path.join(outputs.normal,slug,'index.html'),'utf8')).includes('water-2l'));
const expected=[['water-2l','https://item.rakuten.co.jp/irisplaza-r/310789/','2L×6本'],['water-500ml','https://item.rakuten.co.jp/rakuten24/4562403563002/','500mL×24本']];
const browser=await chromium.launch(browserOptions());const checks=[];
try{for(const mode of ['main','preview','local','disabled'])for(const spec of [{name:'mobile320',...devices['iPhone 13'],viewport:{width:320,height:760}},{name:'mobile390',...devices['iPhone 13']},{name:'desktop',viewport:{width:1440,height:1000}},{name:'nojs320',...devices['iPhone 13'],viewport:{width:320,height:760},javaScriptEnabled:false}]){
 const {name,...opts}=spec;const ctx=await browser.newContext(opts);const p=await ctx.newPage();const blocked=[],loaded=[],errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
  if(u.origin===origin){try{let rel=u.pathname;if(rel.endsWith('/'))rel+='index.html';const file=path.resolve(outputs[mode],'.'+rel);assert(file.startsWith(outputs[mode]+path.sep));const body=await readFile(file);await route.fulfill({status:200,body,contentType:{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}return;}
  if(mode==='main'&&req.resourceType()==='image'&&u.hostname==='thumbnail.image.rakuten.co.jp'&&['/rakuten24/cabinet/002/4562403563002-3.jpg','/irisplaza-r/cabinet/jishahin49/imgrc0102681940.jpg'].some(s=>u.pathname.endsWith(s))){loaded.push(req.url());await route.continue();return;}
  blocked.push(req.url());await route.abort();
 });
 await p.goto(origin+slug,{waitUntil:'load'});
 const disclosure=p.locator('[data-testid="affiliate-disclosure"]');
 assert.equal(await disclosure.count(),mode==='main'?1:0,`${mode}/${name}: advertisement disclosure follows actual affiliate links`);
 if(mode==='main')assert.equal(await disclosure.innerText(),'広告：この記事にはアフィリエイト広告を含みます。');
 assert.equal(await p.locator('.water-offer-photo img').count(),mode==='main'?2:0,`${mode}/${name}: exact product images follow publication guard`);
 const text=await p.locator('.article-content').innerText();assert(!text.includes('240日以上'));assert(!text.includes('1注文につき1点'));assert(!text.includes('LOHACO'));
 for(const [id,destination,unit] of expected){
  const card=p.locator(`[data-testid="${id}"]`);assert.equal(await card.count(),1);const t=await card.innerText();assert(t.includes(unit)&&t.includes('12L')&&t.includes('3L多く'));
  const cta=card.locator('.water-offer-link');assert.equal(await cta.count(),1);const href=await cta.getAttribute('href');assert.equal(mode==='main'?new URL(href).searchParams.get('url'):href,destination);
  if(mode==='main'){const photo=card.locator('.water-offer-photo');assert.equal(await photo.getAttribute('href'),href);assert.match(await cta.getAttribute('rel'),/sponsored/);assert.match(await photo.getAttribute('rel'),/nofollow/);const img=photo.locator('img');assert.equal(await img.getAttribute('src'),offers.offers[id].image,`${id}: image src must match its own offer`);await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());assert(await img.evaluate(e=>e.naturalWidth>0&&!!e.alt));}
  const terms=card.locator('[data-testid="water-terms"]');assert.equal(await terms.count(),1);await terms.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));const tb=await terms.boundingBox(),cb=await cta.boundingBox();assert(tb.y>=100&&cb.y+cb.height<=opts.viewport.height,`${mode}/${name}/${id}: terms and CTA visible together`);
  await p.screenshot({path:path.join(artifacts,`${mode}-${name}-${id}.png`)});
 }
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert(blocked.every(url=>url==='https://www.googletagmanager.com/gtag/js?id=G-28DEZ2ELZ3'),'only the known GA loader may be attempted and blocked; no ad clicks or pixels');
 if(mode==='main')assert.equal(new Set(loaded).size,2);else {assert.equal(loaded.length,0);assert(!(await p.content()).includes('thumbnail.image.rakuten.co.jp'));}
 checks.push({case:`${mode}/${name}`,blockedKnownRequests:blocked,loadedImageURLs:[...new Set(loaded)]});await ctx.close();
}}finally{await browser.close();}
assert.equal(2*6,12);assert.equal(0.5*24,12);assert.equal(12-9,3);
const result={status:'PASS',checks,outputs,artifacts,scope:'Local simulation of production origin; real allowlisted CDN image reads, no publication or ad clicks'};
await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
