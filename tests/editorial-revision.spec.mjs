import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';
const artifacts=process.env.ARTIFACT_DIR || await mkdtemp(path.join(tmpdir(),'revision-evidence-'));
await mkdir(artifacts,{recursive:true});
const output=await mkdtemp(path.join(tmpdir(),'revision-build-'));
execFileSync(process.env.HUGO_BIN||'hugo',['--minify','--destination',output],{stdio:'inherit'});
let root=output;
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p.endsWith('/'))p+='index.html';const f=path.resolve(root,'.'+p);assert(f.startsWith(root+path.sep));res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'}).end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:process.platform==='darwin'?{channel:'chrome'}:{});
const failures=[],measurements=[];
const check=(v,m)=>{if(!v)failures.push(m);};
const rect=async(page,s)=>page.locator(s).first().boundingBox();
const ledger=JSON.parse(await readFile('docs/image-licenses.json','utf8')).images;
try {
 // T1: run every selector branch, rather than merely searching its source.
 try {const {browserOptions}=await import('./browser-options.mjs');assert.deepEqual(browserOptions('linux',{}),{});assert.deepEqual(browserOptions('darwin',{}),{channel:'chrome'});assert.deepEqual(browserOptions('linux',{PLAYWRIGHT_EXECUTABLE_PATH:'/custom/browser'}),{executablePath:'/custom/browser'});assert.deepEqual(browserOptions('darwin',{PLAYWRIGHT_EXECUTABLE_PATH:'/custom/browser'}),{executablePath:'/custom/browser'});check((await readFile('tests/editorial-system.spec.mjs','utf8')).includes('chromium.launch(browserOptions('),'T1 editorial system uses tested selector');}catch(e){check(false,'T1 selector: '+e.message);}
 for(const js of [true,false])for(const width of [390,1440]){
  const ctx=await browser.newContext({viewport:{width,height:960},javaScriptEnabled:js,reducedMotion:'reduce',...(width===390?{isMobile:true,deviceScaleFactor:1,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await ctx.newPage();
  for(const route of ['/','/guide/']){
   await page.goto(base+route);const comp=page.locator(route==='/'?'.story-lead .feature-composition':'.article-cover .feature-composition');
   const imgs=comp.locator('img');check(await imgs.count()===3,`S1 ${route} three real cuts`);check(new Set(await imgs.evaluateAll(es=>es.map(e=>e.src))).size===3,`S1 ${route} distinct assets`);
   const fig=page.locator(route==='/'?'.story-lead figure':'.article-cover').first();
   check(await fig.locator('figcaption, .photo-credit').count()===0,'S1 no repetitive photo audit copy');
   for(const id of ['meal','bread','cooked-rice']){
    const rec=ledger.find(r=>r.id===id);check(rec.license==='CC0','S1 unchanged three-cut rights');
    check(await fig.locator(`img[alt="${rec.alt}"]`).count()===1,`S1 accurate cut alt ${id}`);
   }
   if(route==='/'){
    const b=await comp.boundingBox();check(Math.abs(b.width/b.height-752/351)<.01,'S3 corrected ratio');
    if(width===390){for(const im of await page.locator('.lead-stories .story-image').all()){const b=await im.boundingBox();check(b.x===0&&b.width===390,'S3 all home images full bleed');}for(const c of await page.locator('.lead-stories .story-copy').all()){const b=await c.boundingBox();check(b.x===16&&b.width===358,'S3 inset copy');}}
    check(await page.locator('#readings').count()===1&&await page.locator('.main-nav > a[href="/#readings"]').count()===1,'readings has real list anchor');
   }else{const b=await rect(page,'.article-cover');check(b.width===(width===390?358:518),'S3 article width retained');check((await rect(page,'.article-jump')).y+(await rect(page,'.article-jump')).height<750,'early anchor');await page.locator('.article-jump').click();await page.waitForTimeout(80);const y=(await rect(page,'#article-choice-title')).y;check(y>=(width===390?73:js?70:100)&&y<220,`S2 anchor clears fixed header ${width} js=${js}: ${y}`);}
   for(const y of [0,500,1400]){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(80);const nav=await rect(page,'.main-nav'),header=await rect(page,'.header-inner'),notice=await rect(page,'.notice-bar');measurements.push({width,js,route,y,nav,header,notice});check(nav.y>=0&&nav.y<101,`S2 nav remains ${width} ${y} js=${js}`);if(width===390)check(nav.y===0&&nav.height===73,'S2 mobile 73');else check(header.y===0&&header.height===(js&&y>100?70:100),`S2 PC fixed/shrink ${y} js=${js}`);if(y>0)check(notice.y+notice.height<=0,'S2 notice scrolls away');if(js)await page.screenshot({path:path.join(artifacts,`revision-${route==='/'?'home':'article'}-${width}-${y}.png`)});}
   const menu=page.locator('.site-menu');await menu.locator('summary').focus();await page.keyboard.press('Enter');check(await menu.evaluate(e=>e.open),'S2 keyboard menu opens');await page.screenshot({path:path.join(artifacts,`revision-menu-${width}-${js}.png`)});if(js){await page.keyboard.press('Escape');check(!await menu.evaluate(e=>e.open),'S2 Escape closes');}else await page.keyboard.press('Enter');
   await page.goto(base+route);await page.keyboard.press('Tab');const skip=await rect(page,'.skip-link');check(skip.y>=0,'S2 visible skip link');await page.keyboard.press('Enter');check(await page.evaluate(()=>document.activeElement.id==='main-content'),'S2 skip focuses content');
   // Tabbing to content links must scroll them clear of fixed navigation.
   for(let i=0;i<12;i++){await page.keyboard.press('Tab');const b=await page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return {y:r.y,h:r.height,content:!!e.closest('main')}});if(b.content&&b.h)check(b.y>=(width===390?73:js?70:100),`S2 tab target not obscured ${width} ${b.y}`);}
  }
  await ctx.close();
 }
 // Short landscape menu is independently scrollable and dismissible.
 const short=await browser.newPage({viewport:{width:667,height:300}});await short.goto(base);await short.locator('.site-menu summary').click();const panel=short.locator('.menu-panel');const pb=await panel.boundingBox();check(pb.y>=73&&pb.y+pb.height<=300,'S2 short menu inside viewport');check(await panel.evaluate(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)),'S2 menu scrollable');await short.keyboard.press('Escape');check(!await short.locator('.site-menu').evaluate(e=>e.open),'S2 landscape Escape');await short.close();
 // A genuinely non-food isolated source, with original SVGs and original ledger.
 const fixture=await mkdtemp(path.join(tmpdir(),'garden-revision-'));
 for(const p of ['layouts','assets','static','themes','hugo.toml','docs','data'])await cp(p,path.join(fixture,p),{recursive:true});
 const topic=JSON.parse(await readFile('data/editorial.json','utf8'));
 topic.identity={title:'小さな庭の手帖',tagline:'窓辺から育てる日々',description:'草花の記録',author:'庭の手帖編集室',footer:'草花と過ごす。',symbol:'plant',favicon:'/images/plant.svg'};
 topic.featureSymbol='plant';topic.compositionCaption='テスト用の自作植物図。実写写真ではありません。';topic.photoCaptions={};topic.articleCovers={};topic.navigation=[{label:'ホーム',url:'/',icon:'home'},{label:'育てる',url:'/garden/',icon:'plant'},{label:'読みもの',url:'/#readings',icon:'book'},{label:'手帖',url:'/plain/',icon:'memo'}];topic.notice={text:'窓辺の鉢を見直す',url:'/garden/'};topic.featured=[{path:'/garden',image:'plant-1',images:['plant-1','plant-2','plant-3'],kicker:'窓辺の記録',lines:['緑をひとつ、','部屋に迎える。']}];topic.home={heading:'庭の読みもの',storiesLabel:'草花の読みもの',noteTitle:'手帖について',note:'季節の記録',noteLink:'この手帖について',noteUrl:'/garden/'};topic.tools={stockPlanner:false};topic.articleDisclosure=null;topic.footerLinks=[{label:'手帖について',url:'/plain/'}];
 await writeFile(path.join(fixture,'data/editorial.json'),JSON.stringify(topic));
 const records=[];for(let i=1;i<=3;i++){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700" viewBox="0 0 600 700"><rect width="600" height="700" fill="#f0f3ec"/><path d="M300 540V180M300 330Q${90+i*20} 180 170 120Q330 140 300 330M300 410Q490 240 460 190Q300 230 300 410" fill="#64876b" stroke="#476d51" stroke-width="8"/><path d="M190 510H410L380 650H220Z" fill="#b08c70"/><text x="30" y="50" font-size="22">ORIGINAL FIXTURE ${i} / NOT A PHOTO</text></svg>`;await writeFile(path.join(fixture,`static/images/plant-${i}.svg`),svg);if(i===1)await writeFile(path.join(fixture,'static/images/plant.svg'),svg);records.push({id:`plant-${i}`,local_path:`static/images/plant-${i}.svg`,width:600,height:700,alt:`自作の鉢植え図 ${i}`,caption:'テスト用の自作図。実写写真ではありません。',compact_caption:'自作の植物図・実写ではありません',author:'Editorial fixture authors',license:'CC0',license_url:'https://creativecommons.org/publicdomain/zero/1.0/',source_url:`/images/plant-${i}.svg`,attribution:`Original plant fixture ${i}`,modifications:'自作SVG、表示時の切り抜き。',commercial_allowed:true,modification_allowed:true});}
 await writeFile(path.join(fixture,'docs/image-licenses.json'),JSON.stringify({images:records}));
 for(const slug of ['garden','plain','independent']){await mkdir(path.join(fixture,'content',slug),{recursive:true});await writeFile(path.join(fixture,'content',slug,'index.md'),`---\ntitle: ${slug} 窓辺の鉢\ncoverPhoto: plant-1\n${slug==='plain'?'':'editorialCover:\n  images: [plant-1, plant-2, plant-3]\n  kicker: 草花の手帖\n  lines: [緑をひとつ, 部屋に迎える]\n'}---\n## 窓辺の記録\n\n${'草花と暮らす時間の記録。\n\n'.repeat(30)}`);}
 root=path.join(fixture,'public');execFileSync(process.env.HUGO_BIN||'hugo',['--source',fixture,'--destination',root],{stdio:'inherit'});
 for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:960}});for(const route of ['/','/garden/','/plain/','/independent/']){await page.goto(base+route);const html=await page.content();check(!/images\/photos\/|navi-mark|data-symbol="food"|掲載商品|非常食|備蓄/.test(html),`S4 no food residue ${route}`);check(await page.locator('link[rel="icon"]').getAttribute('href')==='/images/plant.svg','S4 favicon configured');check(await page.locator('.brand-accent [data-symbol="plant"]').count()===1,'S4 plant symbol');if(route==='/plain/')check(await page.locator('.article-cover img').count()===1&&await page.locator('.article-cover .feature-composition').count()===0,'S4 normal nonfeatured fallback');if(route==='/independent/')check(await page.locator('.article-cover .feature-composition img').count()===3&&await page.locator('.feature-words').innerText()!=='','S4 frontmatter independent composition');for(const img of await page.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());}await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,`garden-${route.replaceAll('/','')||'home'}-${width}-first.png`)});if(route!=='/'){await page.locator('.article-cover').screenshot({path:path.join(artifacts,`garden-${route.replaceAll('/','')}-${width}-cover.png`)});await page.locator('.article-content').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`garden-${route.replaceAll('/','')}-${width}-body.png`)});}await page.locator('.site-menu summary').click();await page.screenshot({path:path.join(artifacts,`garden-${route.replaceAll('/','')||'home'}-${width}-menu.png`)});}await page.close();}
 await writeFile(path.join(artifacts,'revision-measurements.json'),JSON.stringify({failures,measurements,fixture},null,2));
 assert.deepEqual(failures,[]);console.log('PASS S1-S4 + T1',artifacts);
}finally{await browser.close();await new Promise(r=>server.close(r));}
