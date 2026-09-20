import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';
import {chromium,devices} from '@playwright/test';import {browserOptions} from './browser-options.mjs';
const slugs=['emergency-food-for-one','rolling-stock-routine','emergency-food-storage','emergency-water-bottles','emergency-food-snacks'];
const temp=await mkdtemp(path.join(tmpdir(),'hijoshoku-content-05-'));
const artifacts=process.env.ARTIFACT_DIR||path.join(temp,'evidence');await mkdir(artifacts,{recursive:true});
const fixture=path.join(temp,'content');await cp('content',fixture,{recursive:true});
for(const slug of slugs){const p=path.join(fixture,'posts',slug+'.md');const s=await readFile(p,'utf8');assert.match(s,/^draft: (true|false)$/m);await writeFile(p,s.replace(/^draft: (true|false)$/m,'draft: true'));}
const normal=path.join(temp,'normal'),draft=path.join(temp,'draft');const hugo=process.env.HUGO_BIN||'hugo';
for(const [dest,extra] of [[normal,[]],[draft,['--buildDrafts']]])execFileSync(hugo,['--contentDir',fixture,'--destination',dest,'--baseURL','http://localhost/','--environment','development','--panicOnWarning',...extra],{stdio:'inherit'});
const checks=[],failures=[];function check(ok,message){(ok?checks:failures).push(message);}
for(const slug of slugs){
 const route='/posts/'+slug+'/';
 await assert.rejects(readFile(path.join(normal,route,'index.html')));
 for(const f of ['index.html','index.xml','sitemap.xml','posts/index.html'])check(!(await readFile(path.join(normal,f),'utf8')).includes(route),`draft excluded: ${f} ${slug}`);
 const body=await readFile(path.join(draft,route,'index.html'),'utf8');check(body.includes('参考にした情報'),`references: ${slug}`);
 check((await readFile(path.join(draft,'index.html'),'utf8')).includes(route),`home discovery: ${slug}`);
 check((await readFile(path.join(draft,'sitemap.xml'),'utf8')).includes(route),`preview sitemap: ${slug}`);
}
const server=http.createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';const file=path.resolve(draft,'.'+p);assert(file.startsWith(draft+path.sep));const bytes=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch(browserOptions());
try{
 for(const viewport of [{name:'mobile320',...devices['iPhone 13'],viewport:{width:320,height:760}},{name:'mobile390',...devices['iPhone 13']},{name:'desktop',viewport:{width:1440,height:1000}}]){
  const {name,...options}=viewport;const ctx=await browser.newContext(options);const page=await ctx.newPage();const outbound=[],errors=[];
  await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();outbound.push(new URL(r.request().url()).hostname);return r.abort();});page.on('pageerror',e=>errors.push(e.message));
  for(const slug of slugs){
   const route='/posts/'+slug+'/';const res=await page.goto(base+route);assert.equal(res.status(),200);
   check(await page.locator('h1').count()===1,`${name} h1: ${slug}`);
   check(await page.locator('.article-content mark strong').count()>=2,`${name} marker skim: ${slug}`);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} no page overflow: ${slug}`);
   const jump=page.locator('.article-header a[data-testid="next-action"]').first();
   check(await jump.count()===1,`${name} first-screen header action: ${slug}`);
   await page.screenshot({path:path.join(artifacts,`${name}-${slug}-first.png`)});
   if(await jump.count()){
    const box=await jump.boundingBox();check(box.y+box.height<=page.viewportSize().height,`${name} action above fold: ${slug}`);
    await jump.click();const hash=await page.evaluate(()=>location.hash);const target=page.locator(hash);check(await target.count()===1,`${name} jump resolves: ${slug}`);
   }
   if(slug!=='emergency-water-bottles'){
    const list=page.locator('[data-testid="primary-checklist"]');
    check(await list.count()===1,`${name} primary decisions in vertical list: ${slug}`);
    if(await list.count()){
     const items=list.locator('li');check(await items.count()>2,`${name} complete condition/action groups: ${slug}`);
     check(await items.evaluateAll(xs=>xs.every(x=>{const r=x.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&x.scrollWidth<=x.clientWidth+1&&!x.closest('.table-scroll');})),`${name} all primary action text fits without horizontal gesture: ${slug}`);
     await list.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${name}-${slug}-checklist.png`)});
    }
   }
   if(['emergency-food-snacks','emergency-food-storage'].includes(slug))check(await page.locator('.article-cover').count()===0,`${slug} must not use an unrelated or misleading stock photo`);
   if(slug!=='emergency-water-bottles')check(!(await page.locator('link[rel="stylesheet"]').evaluateAll(xs=>xs.map(x=>x.href))).some(x=>x.includes('article-choice')),`${name} readingJump needs no choice stylesheet: ${slug}`);
   for(const img of await page.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(x=>x.decode());check(await img.evaluate(x=>x.naturalWidth>0&&!!x.alt),`${name} image decode: ${slug}`);}
   for(const href of await page.locator('.article-content a[href^="/"]').evaluateAll(as=>as.map(a=>a.getAttribute('href'))))check((await fetch(base+href.split('#')[0])).status===200,`${name} related target: ${href}`);
   await page.locator('.article-content [data-testid="next-action"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${name}-${slug}-action.png`)});
  }
  check(outbound.length===0,`${name} zero outbound in local preview`);check(errors.length===0,`${name} zero page errors`);await ctx.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
const result={status:failures.length?'FAIL':'PASS',checks:checks.length,failures,normal,draft,artifacts,scope:'draft-isolation fixture plus real preview rendering; not publication, human proofreading or customer behavior'};
await writeFile(path.join(artifacts,'content-expansion-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
