import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';
import {chromium,devices} from '@playwright/test';import {browserOptions} from './browser-options.mjs';
const temp=await mkdtemp(path.join(tmpdir(),'hijoshoku-water-07-'));
const artifacts=process.env.ARTIFACT_DIR||path.join(temp,'evidence');await mkdir(artifacts,{recursive:true});
const normal=path.join(temp,'normal'),dest=path.join(temp,'draft');
for(const [target,extra] of [[normal,[]],[dest,['--buildDrafts']]])execFileSync(process.env.HUGO_BIN||'hugo',['--destination',target,'--baseURL','http://localhost/','--environment','development','--panicOnWarning',...extra],{stdio:'inherit'});
// Existing public URL only; no revision/new-article publication.
assert.match(await readFile('content/posts/emergency-water-bottles.md','utf8'),/^draft: false$/m);
for(const s of ['pack-rice-or-alpha-rice','emergency-food-tasting','emergency-water-bottles-revision']){
 await assert.rejects(readFile(path.join(normal,'posts',s,'index.html')));
 for(const f of ['index.html','index.xml','sitemap.xml','posts/index.html'])assert(!(await readFile(path.join(normal,f),'utf8')).includes(`/posts/${s}/`));
}
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(p.endsWith('/'))p+='index.html';const f=path.resolve(dest,'.'+p);assert(f.startsWith(dest+path.sep));const b=await readFile(f);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.webp':'image/webp'}[path.extname(f)]||'application/octet-stream'}).end(b);}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const checks=[],regressions=[];function check(ok,msg){assert(ok,msg);checks.push(msg);}
function regression(ok,msg){if(!ok)regressions.push(msg);else checks.push(msg);}
const browser=await chromium.launch(browserOptions());
try{for(const opts of [{name:'mobile320',...devices['iPhone 13'],viewport:{width:320,height:760}},{name:'mobile390',...devices['iPhone 13']},{name:'desktop',viewport:{width:1440,height:1000}},{name:'nojs320',...devices['iPhone 13'],viewport:{width:320,height:760},javaScriptEnabled:false}]){
 const {name,...options}=opts;const ctx=await browser.newContext(options);const page=await ctx.newPage();const outbound=[],errors=[];
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():(outbound.push(r.request().url()),r.abort()));page.on('pageerror',e=>errors.push(e.message));
 check((await page.goto(base+'/posts/emergency-water-bottles/')).status()===200,`${name} 200`);
 await page.screenshot({path:path.join(artifacts,`${name}-first.png`)});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} no page overflow`);
 const jump=page.locator('.article-header a[href="#water-purchase"]');
 regression(await jump.count()===1,`${name} first-screen purchase route exists`);
 if(await jump.count()){const b=await jump.boundingBox();regression(b.y>=0&&b.y+b.height<=options.viewport.height,`${name} purchase route inside initial viewport`);await jump.click();const h=page.locator('#water-purchase + h2');const hb=await h.boundingBox();regression(hb.y>=0&&hb.y<options.viewport.height,`${name} purchase heading reached`);}
 regression(await page.locator('.article-title-thumb').count()===0,`${name} no duplicate generic title photo`);
 regression(await page.locator('.article-cover img').count()===1,`${name} retained one general cover photo`);
 const links=page.locator('.article-content a[href="#water-purchase"]');check(await links.count()>0,`${name} real product selection jump`);
 await links.first().click();check(await page.evaluate(()=>location.hash==='#water-purchase'),`${name} jump works`);
 for(const [id,href,unit,total,excess] of [['water-2l','https://item.rakuten.co.jp/irisplaza-r/310789/','2L×6本',12,3],['water-500ml','https://item.rakuten.co.jp/rakuten24/4562403563002/','500mL×24本',12,3]]){
  const card=page.locator(`[data-testid="${id}"]`);check(await card.count()===1,`${name} ${id} one candidate`);
  const text=await card.innerText();check(text.includes(unit)&&text.includes(`${total}L`)&&text.includes(`${excess}L多く`),`${name} ${id} units/total/excess`);
  const link=card.locator(`a[href="${href}"]`);check(await link.count()===1&&/楽天市場/.test(await link.innerText()),`${name} ${id} exact direct SKU route`);
  check(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${name} ${id} no horizontal scroll`);
  const terms=card.locator('[data-testid="water-terms"]');regression(await terms.count()===1,`${name} ${id} expiry beside product link`);
  if(await terms.count()){regression((await terms.innerText()).includes('届く時点の残存賞味期限'),`${name} ${id} stated expiry`);regression(await terms.evaluate(e=>!!(e.compareDocumentPosition(e.parentElement.querySelector('a'))&Node.DOCUMENT_POSITION_FOLLOWING)),`${name} ${id} expiry before link`);
   await terms.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));const tb=await terms.boundingBox(),lb=await link.boundingBox();regression(tb.y>=140&&lb.y+lb.height<=options.viewport.height,`${name} ${id} expiry and CTA in same viewport`);await page.screenshot({path:path.join(artifacts,`${name}-${id}-terms.png`)});}
  await card.scrollIntoViewIfNeeded();await card.screenshot({path:path.join(artifacts,`${name}-${id}.png`)});
 }
 const text=await page.locator('.article-content').innerText();
 for(const clause of ['普段飲んで補充する','届く時点の残存賞味期限','6本入り','送料','宅配ボックス','必要な本数だけ','冷蔵できない停電時','手持ちで足りている'])check(text.includes(clause),`${name} ${clause}`);
 for(const img of await page.locator('.article-content img, .article-cover img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());check(await img.evaluate(e=>e.naturalWidth>0&&!!e.alt),`${name} decoded image`);}
 check(outbound.length===0,`${name} zero external requests`);check(errors.length===0,`${name} no JS errors`);await ctx.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
check(2000*6/1000===12&&12-9===3,'2L arithmetic');check(500*24/1000===12&&12-9===3,'500mL arithmetic');
await writeFile(path.join(artifacts,'regressions.json'),JSON.stringify(regressions,null,2));assert.deepEqual(regressions,[],'WATER-10 purchase conditions and route regressions');
const result={status:'PASS',checks:checks.length,dest,artifacts,scope:'Local existing-URL publication build, unapproved-draft isolation, static links checked not clicked; no customer or revenue outcome'};await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
