import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';
import {chromium,devices} from '@playwright/test';import {browserOptions} from './browser-options.mjs';
const slugs=['pack-rice-or-alpha-rice','emergency-food-to-go'];
const temp=await mkdtemp(path.join(tmpdir(),'hijo-content12-public-'));
const artifacts=process.env.ARTIFACT_DIR||path.join(temp,'evidence');await mkdir(artifacts,{recursive:true});
const registry=JSON.parse(await readFile('data/article-evidence.json','utf8')).articles;
for(const slug of slugs){
 const file=`content/posts/${slug}.md`,text=await readFile(file,'utf8');
 const snapshot=await readFile(`docs/drafts/content-12/${slug}.md`,'utf8');
 assert.match(text,/^draft: false$/m,'approved article must be public');
 assert.equal(text,snapshot.replace(/^draft: true$/m,'draft: false'),'no unconfirmed copy edit');
 const key=text.match(/^evidenceKey: (\w+)$/m)?.[1];assert.equal(registry[key]?.file,file);
}
execFileSync('python3',['-B','scripts/editorial_confirmation.py'],{stdio:'inherit'});
execFileSync('python3',['-B','scripts/content12_confirmation.py'],{stdio:'inherit'});
execFileSync('python3',['-B','docs/sources/verify.py'],{stdio:'inherit'});
// Preserve future draft-exclusion coverage, but never overwrite the actual public source.
const fixture=path.join(temp,'content');await cp('content',fixture,{recursive:true});
for(const slug of slugs){const p=path.join(fixture,`posts/${slug}.md`);const s=await readFile(p,'utf8');await writeFile(p,s.replace(/^draft: false$/m,'draft: true'));}
const normal=path.join(temp,'fixture-normal'),preview=path.join(temp,'fixture-draft'),draft=path.join(temp,'published');
for(const [dest,extra] of [[normal,['--contentDir',fixture]],[preview,['--contentDir',fixture,'--buildDrafts']],[draft,[]]])execFileSync(process.env.HUGO_BIN||'hugo',['--destination',dest,'--baseURL','http://localhost/','--environment','development','--panicOnWarning',...extra],{stdio:'inherit'});
for(const slug of slugs){
 const route='/posts/'+slug+'/';await assert.rejects(readFile(path.join(normal,route,'index.html')));
 for(const f of ['index.html','index.xml','sitemap.xml','posts/index.html','posts/index.xml']){
  assert.ok(!(await readFile(path.join(normal,f),'utf8')).includes(route),`fixture draft leaked: ${f} ${slug}`);
  assert.ok((await readFile(path.join(draft,f),'utf8')).includes(route),`approved article not discoverable: ${f} ${slug}`);
 }
 for(const dest of [preview,draft])assert.ok((await readFile(path.join(dest,route,'index.html'),'utf8')).includes('参考にした情報'));
}
const server=http.createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';const file=path.resolve(draft,'.'+p);assert.ok(file.startsWith(draft+path.sep));const b=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file)]||'application/octet-stream'}).end(b);}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions());const cases=[];
try{
 for(const js of [true,false])for(const [name,options] of [['320',{...devices['iPhone 13'],viewport:{width:320,height:760}}],['390',{...devices['iPhone 13']}],['1440',{viewport:{width:1440,height:1000}}]]){
  const context=await browser.newContext({...options,javaScriptEnabled:js});const page=await context.newPage();const errors=[],outbound=[];
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();outbound.push(r.request().url());return r.abort();});page.on('pageerror',e=>errors.push(e.message));
  for(const slug of slugs){
   assert.equal((await page.goto(base+'/posts/'+slug+'/',{waitUntil:'load'})).status(),200);
   assert.equal(await page.locator('h1').count(),1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
   assert.ok(await page.locator('.article-content mark strong').count()>=2);
   const jump=page.locator('.article-header a[data-testid="next-action"]').first();assert.equal(await jump.count(),1);
   const box=await jump.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=page.viewportSize().height,'first-screen action');
   await page.screenshot({path:path.join(artifacts,`${name}-${js?'js':'nojs'}-${slug}-first.png`)});
   await jump.click();const hash=await page.evaluate(()=>location.hash);assert.ok(hash);
   const heading=page.locator(hash).locator('xpath=following-sibling::h2[1]');assert.equal(await heading.count(),1);
   const target=await heading.boundingBox();assert.ok(target.y>=0&&target.y+target.height<=page.viewportSize().height,'jump must reach visible actual heading');
   const list=page.locator('[data-testid="primary-checklist"]');assert.equal(await list.count(),1);
   assert.ok(await list.locator('li').evaluateAll(xs=>xs.length>=3&&xs.every(x=>{const r=x.getBoundingClientRect();return r.x>=0&&r.right<=document.documentElement.clientWidth+1&&x.scrollWidth<=x.clientWidth+1;})));
   await list.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${name}-${js?'js':'nojs'}-${slug}-decision.png`)});
   for(const a of await page.locator('.article-content a[href^="/"]').all()){
    const href=await a.getAttribute('href');const url=new URL(href,base);assert.equal((await fetch(url)).status,200);
   }
   for(const img of await page.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(x=>x.decode());assert.ok(await img.evaluate(x=>x.naturalWidth>0&&!!x.alt));}
   cases.push({slug,width:page.viewportSize().width,js,status:'PASS'});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
const result={status:'PASS',cases,normal,draft,artifacts,scope:'approved public source, exact approval, published discovery and isolated draft-exclusion fixture; 320/390/1440 JS/noJS; not hosted observation or SEO effect'};
await writeFile(path.join(artifacts,'content12-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
