import assert from 'node:assert/strict';
import {createDraftRelatedFixture} from './draft-related-fixture.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,cp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium,devices} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';

// Test the real confirmed public inputs; never rewrite the operator receipt.
const root=process.cwd();
const temp=await mkdtemp(path.join(tmpdir(),'hijo-content14-public-'));
const workspace=path.join(temp,'source'),output=path.join(temp,'public');
const artifacts=process.env.ARTIFACT_DIR||path.join(temp,'evidence');
await mkdir(workspace);await mkdir(artifacts,{recursive:true});
const exists=async p=>{try{await access(p);return true;}catch{return false;}};
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const pages=[['emergency-canned-food','cans',2],['supermarket-emergency-food-list','shopping',6]];
for(const name of ['hugo.toml','content','data','docs','layouts','assets','static','themes','scripts'])await cp(path.join(root,name),path.join(workspace,name),{recursive:true});
for(const [slug] of pages)assert.match(await readFile(path.join(workspace,'content/posts',slug+'.md'),'utf8'),/^draft: false$/m,'confirmed public source required');
execFileSync('python3',['-B','docs/sources/verify.py'],{cwd:workspace,stdio:'inherit'});
const hugo=process.env.HUGO_BIN||'hugo';
execFileSync(hugo,['--destination',output,'--environment','production','--minify','--baseURL','https://hijoshoku-navi.com/','--panicOnWarning'],{cwd:workspace,env:{...process.env,CF_PAGES_BRANCH:'main'},stdio:'inherit'});
const visual=await json(path.join(root,'data/content14-visual.json'));
const allowedImages=new Set(Object.values(visual.groups).flatMap(g=>g.entries.filter(e=>e.photo?.src?.startsWith('https:')).map(e=>e.photo.src)));
const server=http.createServer(async(req,res)=>{try{
 let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';
 const file=path.resolve(output,'.'+p);assert.ok(file.startsWith(output+path.sep));const b=await readFile(file);
 res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'}).end(b);
}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions());const cases=[];
try{
 for(const js of [true,false])for(const width of [320,390,1440]){
  const context=await browser.newContext({...(width<700?devices['iPhone 13']:{}),viewport:{width,height:900},javaScriptEnabled:js});
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>new URL(r.request().url()).origin===base||allowedImages.has(r.request().url())?r.continue():r.abort());
  for(const [slug,key,count] of pages){
   await page.goto(base+'/posts/'+slug+'/',{waitUntil:'load'});
   await page.screenshot({path:path.join(artifacts,`${key}-${width}-${js?'js':'nojs'}-first.png`)});
   const panel=page.locator(`[data-visual-panel="${key}"]`);
   assert.equal(await panel.count(),1,'image-first decision panel missing: '+key);
   assert.equal(await panel.locator('[data-visual-entry]').count(),count,'complete decision set');
   assert.equal(await page.locator('[data-testid="affiliate-disclosure"]').count(),key==='cans'?1:0,'visual-only affiliate panel must disclose advertising exactly once');
   if(key==='cans')for(const entry of visual.groups.cans.entries){
    const card=panel.locator(`[data-visual-entry="${entry.id}"]`), photo=entry.photo;
    assert.ok(photo&&photo.kind==='affiliate','exact product image is required');
    assert.equal(await card.locator('img').getAttribute('src'),photo.src);
    assert.equal(await card.locator('.visual-photo-link').getAttribute('href'),photo.href);
    assert.equal(await card.locator('.visual-photo-link').getAttribute('rel'),'sponsored nofollow');
    assert.ok((await card.innerText()).includes(photo.saleUnit),'sale unit beside exact product');
   }
   assert.ok(await panel.locator('mark strong').count()>=count,'each choice needs a highlighted condition');
   // Safety must survive the requested photo + marker-only reading path, not just full text.
   const scanRequirements={
    hotei:['小麦・大豆・鶏肉・りんご','内容総量75g・固形量55g'],
    umios:['さば','液汁を含む'],
    water:['足りない量'],
    staple:['温める手段がない分','調理表示でそのまま食べられるもの'],
    main:['加熱が必要か','一度に開ける量'],
    side:['開封後の保存表示','飲み切る・食べ切る量'],
    fruit:['缶詰は','開ける道具'],
    snack:['アレルギー','かむ・飲み込む条件']
   };
   const scanRows=[];
   for(const card of await panel.locator('[data-visual-entry]').all()){
    const id=await card.getAttribute('data-visual-entry');
    const marks=await card.locator('mark strong').allTextContents();
    for(const term of scanRequirements[id])assert.ok(marks.some(t=>t.includes(term)),`${id}: marker-only safety missing: ${term}`);
    scanRows.push({id,marks,next:await card.locator('.visual-detail').innerText()});
    await card.scrollIntoViewIfNeeded();
    const b=await card.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1,'decision stays within real viewport');
    const link=card.locator('a[href^="#"]').last();assert.equal(await link.count(),1,'each choice has an on-page next step');
    const target=await link.getAttribute('href');assert.equal(await page.locator(target).count(),1,'exact target exists');
    await link.click();const t=await page.locator(target).boundingBox();assert.ok(t.y>=0&&t.y<900,'decision link reaches visible detail');
   }
   assert.ok(await page.evaluate(w=>document.documentElement.scrollWidth<=w+1&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,width),'no sideways scrolling');
   const imageCount=await panel.locator('img').count();
   for(const entry of visual.groups[key]?.entries||[]){
    const credit=entry.photo?.credit;if(!credit)continue;
    const displayed=panel.locator(`[data-credit="${entry.id}"]`);
    assert.equal(await displayed.count(),1,'each CC photo needs a complete attribution');
    assert.ok((await displayed.textContent()).includes(credit.title),'provided work title retained');
    assert.ok((await displayed.textContent()).includes(credit.author),'creator retained');
    // Hugo percent-escapes parentheses in attribute URLs; retain the ledger's literal source.
    const renderedSource=credit.source.replaceAll('(','%28').replaceAll(')','%29');
    assert.equal(await displayed.locator('a').first().getAttribute('href'),renderedSource);
    assert.equal(await displayed.locator('a').last().getAttribute('href'),credit.licenseUrl);
   }
   if(process.env.REQUIRE_REAL_IMAGES==='1')assert.equal(imageCount,count,'every choice requires a rights-verified real photo');
   for(const image of await panel.locator('img').all()){
    await image.scrollIntoViewIfNeeded();await image.evaluate(x=>x.decode());
    assert.ok(await image.evaluate(x=>x.naturalWidth>0&&x.alt&&x.getAttribute('width')&&x.getAttribute('height')));
   }
   await panel.screenshot({path:path.join(artifacts,`${key}-${width}-${js?'js':'nojs'}-panel.png`)});
   assert.ok((await page.locator('.article-content').innerText()).includes(key==='cans'?'固形量55g':'サトウのごはんは必ず加熱する商品です。'));
   cases.push({key,width,js,decisionCount:count,imageCount,scanRows});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
// Same shortcode, non-authorised advertising contexts: no ASP image or link may leak.
const configPath=path.join(workspace,'data/affiliate-links.json'), configRaw=await readFile(configPath,'utf8');
const guardCases=[];
try{
 for(const mode of ['preview','other-origin','disabled']){
  const dest=path.join(temp,'guard-'+mode), cfg=JSON.parse(configRaw);
  if(mode==='disabled')cfg.enabled=false;
  await writeFile(configPath,JSON.stringify(cfg));
  execFileSync(process.env.HUGO_BIN||'hugo',['--destination',dest,'--environment','production','--baseURL',mode==='other-origin'?'https://unapproved.example/':'https://hijoshoku-navi.com/','--panicOnWarning'],{cwd:workspace,env:{...process.env,CF_PAGES_BRANCH:mode==='preview'?'unapproved-preview':'main'},stdio:'pipe'});
  const html=await readFile(path.join(dest,'posts/emergency-canned-food/index.html'),'utf8');
  assert.ok(!html.includes('thumbnail.image.rakuten.co.jp'),'guard suppresses affiliate image');
  assert.ok(!html.includes('af.moshimo.com/af/c/click'),'guard suppresses affiliate link');
  assert.ok(!html.includes('data-testid="affiliate-disclosure"'),'no absent-ad disclosure');
  assert.ok(!html.includes('写真のリンク先：'),'no absent-photo sale unit');
  for(const text of ['固形量55g','液汁を含む','hoteifoods.co.jp','www.umios.com'])assert.ok(html.includes(text),'retain useful product detail');
  guardCases.push({mode,status:'PASS'});
 }
}finally{await writeFile(configPath,configRaw);}
// A fixture tests Hugo draft exclusion; the actual sources remain confirmed public.
const coherent=await createDraftRelatedFixture({sourceDir:workspace,fixtureDir:path.join(temp,'normal-source'),draftRoutes:pages.map(([slug])=>'/posts/'+slug+'/')});
const savedArticles=[];
try{
 for(const [slug] of pages){const f=path.join(workspace,'content/posts',slug+'.md'),raw=await readFile(f,'utf8');savedArticles.push([f,raw]);await writeFile(f,raw.replace(/^draft: false$/m,'draft: true'));}
 const hidden=path.join(temp,'draft-hidden'),shown=path.join(temp,'draft-shown');
 for(const [dest,flags] of [[hidden,[...coherent.buildArgs,'--contentDir',path.join(workspace,'content')]],[shown,['--buildDrafts']]])execFileSync(hugo,['--destination',dest,'--environment','production','--baseURL','https://hijoshoku-navi.com/','--panicOnWarning',...flags],{cwd:workspace,stdio:'pipe'});
 const listings=['index.html','posts/index.html','index.xml','posts/index.xml','sitemap.xml'];
 if(await exists(path.join(output,'index.json')))listings.push('index.json');
 for(const [slug] of pages){
  assert.equal(await exists(path.join(hidden,'posts',slug,'index.html')),false,'draft article excluded');
  assert.equal(await exists(path.join(shown,'posts',slug,'index.html')),true,'draft preview generated');
  for(const rel of listings){assert.ok(!(await readFile(path.join(hidden,rel),'utf8')).includes(slug),'draft excluded from '+rel);assert.ok((await readFile(path.join(output,rel),'utf8')).includes(slug),'public included in '+rel);}
 }
}finally{for(const [f,raw]of savedArticles)await writeFile(f,raw);}
const result={scope:'confirmed public-mode source; browser emulation, not physical iPhone or hosted QA',status:'PASS',workspace,output,artifacts,realImagesRequired:process.env.REQUIRE_REAL_IMAGES==='1',cases,guardCases};
await writeFile(path.join(artifacts,'visual-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
