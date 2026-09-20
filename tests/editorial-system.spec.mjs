import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';
const output=await mkdtemp(path.join(tmpdir(),'editorial-system-'));
const artifacts=process.env.ARTIFACT_DIR || path.join(output,'evidence');
await mkdir(artifacts,{recursive:true});
const build=(args=[])=>execFileSync(process.env.HUGO_BIN||'hugo',['--minify','--destination',output,...args],{stdio:'inherit'});
build();
const server=http.createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';const file=path.resolve(output,'.'+p);assert(file.startsWith(output+path.sep));const bytes=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const { browserOptions } = await import('./browser-options.mjs');
const browser=await chromium.launch(browserOptions());
const expectedStoryPaths=[];
for(const {file} of Object.values(JSON.parse(await readFile('data/article-evidence.json','utf8')).articles)){
 const source=await readFile(file,'utf8');
 if(!/^draft:\s*true\s*$/m.test(source))expectedStoryPaths.push('/'+file.replace(/^content\//,'').replace(/(?:\/index)?\.md$/,'')+'/');
}
const failures=[],measurements=[];
const check=(v,m)=>{if(!v)failures.push(m);};
try {
 for(const width of [320,390,768,1440]){
  const ctx=await browser.newContext({viewport:{width,height:960},javaScriptEnabled:false,...(width<=390?{isMobile:true,deviceScaleFactor:1,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await ctx.newPage();
  for(const route of ['/','/guide/']){
   await page.goto(base+route);
   const m=await page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom};};const style=s=>{const e=document.querySelector(s);return e?{font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight}:null;};return {nav:r('.main-nav'),brand:r('.brand'),header:r('.header-inner'),notice:r('.notice-bar'),lead:r('.lead-stories'),first:r('.story-lead'),second:r('.lead-stories .story-card:nth-child(2)'),third:r('.lead-stories .story-card:nth-child(3)'),title:r('.article-header h1'),cover:r('.article-cover'),body:r('.article-content'),action:r('.article-jump'),thumb:r('.article-title-thumb'),type:style('.article-content'),titleType:style('.article-header h1'),aside:!!document.querySelector('.editorial-sidebar'),overflow:document.documentElement.scrollWidth>innerWidth+1};});
   measurements.push({route,width,...m});
   check(!m.aside,`${route} ${width}: no sidebar`);check(!m.overflow,`${route} ${width}: no overflow`);
   check(m.notice?.h>=46,`${width}: notice strip`);
   if(width===1440){check(m.header?.h===100,'PC header 100');check(m.notice?.h===46,'PC notice 46');}
   if(width<=390){check(m.nav?.h===73&&m.brand?.h===61&&m.nav.bottom<=m.brand.y,`${width}: 73px nav before 61px brand`);check(await page.locator('.main-nav > *').count()===5,`${width}: five icon items`);}
   if(route==='/'){
    const storyPaths=await page.locator('.lead-stories .story-copy h2 a').evaluateAll(links=>links.map(a=>new URL(a.href).pathname));
    check(await page.locator('.lead-stories .story-card').count()===expectedStoryPaths.length&&JSON.stringify(storyPaths.sort())===JSON.stringify([...expectedStoryPaths].sort()),'all published editorial stories, without missing or duplicate routes');
    check(await page.locator('.story-lead .feature-composition').count()===1,'independent split composition, not raw photo');
    const composition=await page.locator('.story-lead .feature-composition').boundingBox();
    check(composition&&Math.abs(composition.width/composition.height-752/351)<0.02,'home composition keeps measured 752:351 without copy-driven growth');
    if(width===1440)check(m.lead?.w===752&&m.lead?.x===344&&m.second?.w===364&&m.third?.x-m.second?.x===388,'752 centered with 364+24+364');
    if(width<=390)check(m.second?.y>=m.first?.bottom&&m.third?.y>=m.second?.bottom&&m.second?.w===width-32,'SP vertical stories');
   }else{
    check(m.title?.bottom<m.cover?.y,'title before main image');check(m.action?.bottom<750,'early functional anchor');
    check(m.type?.font==='16px'&&m.type?.line==='28px','16/28 body');
    if(width===1440)check(m.body?.w===518&&m.body?.x===461&&m.titleType?.font==='20px'&&m.titleType?.line==='32px','PC 518 body + 20/32 title');
    if(width<=390)check(m.thumb?.w===100&&m.thumb?.x<m.title?.x&&m.body?.w===width-32&&m.titleType?.font==='18px','SP thumbnail and typography');
   }
   const menu=page.locator('.site-menu');
   check(await menu.count()===1,'native menu exists');
   if(await menu.count()){
    const summary=menu.locator('summary');await summary.focus();await page.keyboard.press('Enter');check(await menu.evaluate(e=>e.open),'keyboard noJS menu opens');
    const first=menu.locator('a').first();check(await first.isVisible(),'menu links exposed');const href=await first.getAttribute('href');check(href&&href!=='#','real menu destination');
    await page.keyboard.press('Enter');check(!(await menu.evaluate(e=>e.open)),'keyboard menu closes');
    await summary.click();await first.click();check(new URL(page.url()).pathname===new URL(href,base).pathname,'menu navigation works');await page.goto(base+route);
   }
   for(const img of await page.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());}await page.evaluate(()=>scrollTo(0,0));
   if([390,1440].includes(width)){for(const y of [0,650,1400]){await page.evaluate(y=>scrollTo(0,y),y);await page.screenshot({path:path.join(artifacts,`implementation-${route==='/'?'home':'article'}-${width}-${y?'y'+y:'first'}.png`)});}}
  }
  await ctx.close();
 }
 // This exact Google ownership document is not an editorial HTML page.
 const verificationFile='googlebc361a986c060010.html';
 assert.equal(await readFile(path.join(output,verificationFile),'utf8'),'google-site-verification: '+verificationFile);
 const verificationResponse=await fetch(base+'/'+verificationFile);
 assert.equal(verificationResponse.status,200);
 assert.equal(await verificationResponse.text(),'google-site-verification: '+verificationFile);
 const routes=(await readdir(output,{recursive:true})).filter(p=>p.endsWith('.html')&&p!==verificationFile).map(p=>'/'+p.replace(/index\.html$/,''));
 for(const width of [320,390,768,1440]){const page=await browser.newPage({viewport:{width,height:960}});for(const route of routes){await page.goto(base+route);check(await page.locator('h1').count()===1,`all routes ${route}: one h1`);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`all routes ${route} ${width}: no overflow`);}await page.close();}
 // A real isolated Hugo source fixture: no mutation of project content/data.
 const fixture=await mkdtemp(path.join(tmpdir(),'editorial-topic-fixture-'));
 for(const p of ['layouts','assets','static','themes','hugo.toml','docs','data'])await cp(p,path.join(fixture,p),{recursive:true});
 let topic;
 try{topic=JSON.parse(await readFile('data/editorial.json','utf8'));}catch{check(false,'topic configuration exists');}
 if(topic){
  topic.identity={title:'小さな庭の手帖',tagline:'窓辺から育てる日々',description:'草花と暮らしについての小さな読みものです。',author:'庭の手帖編集室',footer:'草花と過ごす。',symbol:'plant',favicon:'/images/plant.svg'};
  topic.featureSymbol='plant';topic.compositionCaption='テスト用の植物図・実写ではありません';topic.photoCaptions={};topic.articleCovers={};
  await writeFile(path.join(fixture,'static/images/plant.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="#f0f3ec"/><path d="M300 620V200M300 400Q140 200 170 120Q330 160 300 400M300 420Q470 250 450 160Q280 230 300 420" fill="#64876b" stroke="#476d51" stroke-width="8"/></svg>');
  await writeFile(path.join(fixture,'docs/image-licenses.json'),JSON.stringify({images:[{id:'plant',local_path:'static/images/plant.svg',width:600,height:700,alt:'テスト用自作植物図',caption:'テスト用の自作植物図。実写ではありません。',compact_caption:'自作図・実写ではありません',author:'Editorial fixture authors',license:'CC0',license_url:'https://creativecommons.org/publicdomain/zero/1.0/',source_url:'/images/plant.svg',attribution:'Original plant fixture',modifications:'自作SVG'}]}));
  topic.navigation=[{label:'ホーム',url:'/',icon:'home'},{label:'育てる',url:'/garden/',icon:'plant'},{label:'読みもの',url:'/garden/',icon:'book'},{label:'手帖',url:'/garden/',icon:'memo'}];
  topic.notice={text:'今週は窓辺の鉢を見直します',url:'/garden/'};topic.featured=[{path:'/garden',image:'plant',kicker:'窓辺の記録',lines:['緑をひとつ、','部屋に迎える。']}];topic.home={heading:'庭の読みもの',storiesLabel:'草花の読みもの',toolsTitle:'',noteTitle:'手帖について',note:'季節の記録を集めます。',noteLink:'この手帖について',noteUrl:'/garden/'};topic.tools={stockPlanner:false};topic.articleDisclosure=null;topic.footerLinks=[{label:'手帖について',url:'/garden/'}];
  await writeFile(path.join(fixture,'data/editorial.json'),JSON.stringify(topic));await mkdir(path.join(fixture,'content/garden'),{recursive:true});await writeFile(path.join(fixture,'content/garden/index.md'),'---\ntitle: 窓辺の鉢を育てる\ndescription: 草花と過ごす時間を少しずつ。\ncoverPhoto: plant\n---\n窓辺の記録。\n');
  const dest=path.join(fixture,'public');execFileSync(process.env.HUGO_BIN||'hugo',['--source',fixture,'--destination',dest],{stdio:'inherit'});
  const article=await readFile(path.join(dest,'garden/index.html'),'utf8');check(!/公的・メーカー情報による比較|成果報酬型広告リンクは未掲載/.test(article),'article shell does not inject first-topic disclosure');
  const html=await readFile(path.join(dest,'index.html'),'utf8');check(html.includes('小さな庭の手帖')&&html.includes('窓辺の鉢を育てる'),'alternate topic renders');check(!/非常食|備蓄|食と暮らしの備え|stock-planner/.test(html),'core home/header/footer contain no fixed first-topic strings; existing content intentionally excluded');
 }
 await writeFile(path.join(artifacts,'editorial-system-measurements.json'),JSON.stringify({failures,measurements},null,2));
 assert.deepEqual(failures,[]);console.log(JSON.stringify({status:'PASS',artifacts,checks:'geometry, title-first, native menu, isolated topic replacement',measurements},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
