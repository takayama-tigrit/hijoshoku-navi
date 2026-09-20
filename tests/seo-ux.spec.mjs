// RED/GREEN plus Before/After evidence. Real Hugo output; external analytics/ASP blocked.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium,devices} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';
const routes={'/ranking/':3,'/guide/':1,'/posts/emergency-food-snacks/':1,'/posts/alpha-mai-osusume/':3,'/posts/emergency-food-set-check/':2,'/posts/emergency-food-side-dishes/':2};
const comparisons=JSON.parse(await readFile('data/product-comparisons.json','utf8'));
const images=JSON.parse(await readFile('data/product-images.json','utf8')).images;
const searches=JSON.parse(await readFile('data/affiliate-links.json','utf8')).links;
const groups={'/guide/':'guide-white','/posts/emergency-food-snacks/':'snacks','/ranking/':'ranking','/posts/alpha-mai-osusume/':'alpha','/posts/emergency-food-set-check/':'sets','/posts/emergency-food-side-dishes/':'sides'};
const requiredSaleUnits={'尾西 ひだまりパン プレーン':'1袋70g／写真の販売品は36袋','ハウス 温めずにおいしいカレー まろやか野菜カレー 200g':'1袋200g／写真の販売品は2箱'};
const rowData=page=>page.locator('.product-comparison tbody tr').evaluateAll(rows=>rows.map(row=>({key:row.getAttribute('data-product-key'),name:row.querySelector('.product-name')?.textContent,photo:row.querySelector('.product-photo')?.getAttribute('href')??null,src:row.querySelector('.product-photo img')?.getAttribute('src')??null,search:row.querySelector('.product-search')?.getAttribute('href'),official:row.querySelector('.product-source')?.getAttribute('href'),condition:row.querySelector('.product-condition mark')?.textContent,note:row.querySelector('.product-note mark')?.textContent,unit:row.querySelector('th .product-sale-unit mark')?.textContent??null})));
const root=await mkdtemp(path.join(tmpdir(),'seo-ux-')),output=path.join(root,'public'),artifacts=process.env.ARTIFACT_DIR||path.join(root,'evidence');
await mkdir(artifacts,{recursive:true});
const build=(dest,args=[],env=process.env)=>execFileSync(process.env.HUGO_BIN||'hugo',['--panicOnWarning','--minify','--destination',dest,...args],{stdio:'pipe',env});
build(output);let serving=output;
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),f=path.resolve(serving,'.'+decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));assert(f.startsWith(serving+path.sep));const body=await readFile(f);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml','.xml':'application/xml'}[path.extname(f)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions()),checks=[],failures=[],metrics=[];
const check=(ok,description)=>{checks.push({ok,description});if(!ok)failures.push(description);};
const verifyRows=async(page,route,active,label)=>{
 const rows=await rowData(page),terms=comparisons.groups[groups[route]]||[];
 check(JSON.stringify(rows.map(row=>row.key))===JSON.stringify(terms),`${label} ${route}: exact product keys and order`);
 for(const [i,term] of terms.entries()){
  const row=rows[i],p=comparisons.products[term],im=images[term],search=searches[term];
  check(row?.photo===(active?im.href:null)&&row?.src===(active?im.image:null)&&row?.search===(active?search.url:search.destination),`${label} ${route} ${term}: exact ledger photo href/src/search URL`);
  check(row?.name===p.name&&row?.condition===p.condition&&row?.note===p.note&&row?.official===p.official,`${label} ${route} ${term}: name, marked conditions and official action retained`);
  if(requiredSaleUnits[term])check(p.saleUnit===requiredSaleUnits[term],`${label} ${term}: confirmed sale-unit data`);
  if(active&&p.saleUnit)check(row?.unit===p.saleUnit,`${label} ${term}: sale unit marked next to photo`);
  if(active&&requiredSaleUnits[term])check(row?.unit===requiredSaleUnits[term],`${label} ${term}: pack size cannot look like a single item`);
  if(!active)check(row?.unit===null,`${label} ${term}: no caption for omitted photo`);
  const marked=[row?.condition,row?.note].join(' ');
  if(term==='尾西 白飯 100g')check(/160mL/.test(marked)&&/水15℃で60分/.test(marked),`${label} ${term}: water volume and cold-water wait marked together`);
  if(term==='尾西 わかめごはん 100g')check(/ホタテエキス/.test(marked),`${label} ${term}: scallop extract in marked condition`);
 }
};
try{
 for(const device of [{name:'mobile',...devices['iPhone 13']},{name:'narrow',viewport:{width:320,height:740}},{name:'desktop',viewport:{width:1440,height:1000}},{name:'noJS',...devices['iPhone 13'],javaScriptEnabled:false}]){
  const {name,...options}=device,context=await browser.newContext(options),page=await context.newPage();
  // Real licensed product images only; no clicks or collection requests in QA.
  await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===base||(r.request().resourceType()==='image'&&['thumbnail.image.rakuten.co.jp','tshop.r10s.jp','image.rakuten.co.jp'].includes(u.hostname))?r.continue():r.abort();});
  for(const [route,count]of Object.entries(routes)){
   const slug=route.replaceAll('/','-');assert.equal((await page.goto(base+route)).status(),200);
   await page.screenshot({path:path.join(artifacts,`${name}${slug}first.png`)});
   const data=await page.evaluate(()=>({title:document.title,description:document.querySelector('meta[name=description]')?.content,canonical:document.querySelector('link[rel=canonical]')?.href,h1:[...document.querySelectorAll('h1')].map(e=>e.textContent),markers:[...document.querySelectorAll('.article-content mark')].map(e=>e.textContent),rows:document.querySelectorAll('.product-comparison tbody tr').length,images:document.querySelectorAll('.product-photo img').length,og:document.querySelector('meta[property="og:image"]')?.content,ld:[...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(e=>JSON.parse(e.textContent)['@graph']||[JSON.parse(e.textContent)]),noOverflow:document.documentElement.scrollWidth<=innerWidth+1}));
   metrics.push({viewport:name,route,...data});
   await verifyRows(page,route,true,name);
   check(data.h1.length===1&&!!data.description,`${name} ${route}: H1 and description`);
   check(data.canonical==='https://hijoshoku-navi.com'+route,`${name} ${route}: canonical`);
   check(data.markers.length>=3&&data.markers.length<=16,`${name} ${route}: selective marked judgments, caution and next action`);
   check(data.rows===count&&data.images===count,`${name} ${route}: all ${count} product rows include photos`);
   check(route==='/posts/emergency-food-snacks/' ? !data.og : !!data.og&&data.og.startsWith('https://hijoshoku-navi.com/'),`${name} ${route}: only actual owned cover may supply OG image`);
   const article=data.ld.find(x=>x['@type']==='Article'),crumb=data.ld.find(x=>x['@type']==='BreadcrumbList');
   check(article?.headline===data.h1[0]&&article?.mainEntityOfPage==='https://hijoshoku-navi.com'+route,`${name} ${route}: Article identity matches page`);
   check(article?.author?.name==='非常食ナビ編集部'&&!!article?.dateModified&&(route==='/posts/emergency-food-snacks/' ? !article?.image : !!article?.image),`${name} ${route}: truthful author/date/image`);
   check(crumb?.itemListElement?.at(-1)?.item==='https://hijoshoku-navi.com'+route,`${name} ${route}: breadcrumb target`);
   check(!data.ld.some(x=>['Review','Product','FAQPage'].includes(x['@type'])),`${name} ${route}: no invented ratings/offers/FAQ schema`);
   check(data.noOverflow,`${name} ${route}: no page overflow`);
   for(const mark of await page.locator('.article-content mark').all()){
    check(await mark.evaluate(e=>e.querySelector('strong')!==null&&Number(getComputedStyle(e).fontWeight)>=600&&getComputedStyle(e).backgroundImage.includes('linear-gradient')),`${name} ${route}: bold lower marker`);
   }
   const cards=page.locator('.product-comparison tbody tr');
   for(let i=0;i<await cards.count();i++){
    const row=cards.nth(i);await row.scrollIntoViewIfNeeded();const photo=row.locator('.product-photo img');
    const loaded=await photo.evaluate(async e=>{try{await e.decode();return e.naturalWidth>0&&e.alt.length>0&&e.width>50&&e.height>50;}catch{return false;}});
    check(loaded,`${name} ${route} row ${i}: real photo decoded and named`);
    check(await row.locator('a[data-commerce="rakuten"]').count()===1&&await row.locator('a.product-source').count()===1,`${name} ${route} row ${i}: search and official action`);
    check(await row.locator('mark').count()>=1,`${name} ${route} row ${i}: marked selection condition`);
    check(!await row.evaluate(e=>e.closest('details:not([open])')),`${name} ${route}: comparison is not collapsed`);
    for(const a of await row.locator('a').all())check(await a.evaluate(e=>{const b=e.getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1;}),`${name} ${route}: actions visible without horizontal scroll`);
   }
   if(await cards.count()){
    await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${name}${slug}comparison.png`)});
    if(name==='mobile'||name==='desktop')await page.locator('.product-comparison').screenshot({path:path.join(artifacts,`${name}${slug}table.png`)});
   }else{
    const old=page.locator('.article-content a[data-commerce="rakuten"]').first();if(await old.count()){await old.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${name}${slug}old-links.png`)});}
   }
  }
  if(name==='mobile'){
   for(const route of ['/tags/','/categories/','/tags/非常食/']){await page.goto(base+route);check(await page.locator('meta[name=robots]').evaluateAll(xs=>xs.some(e=>e.content.includes('noindex'))),`${route}: taxonomy noindex while corpus is small`);}
   for(const route of ['/about/','/privacy/','/photo-credits/']){await page.goto(base+route);check(await page.locator('script[type="application/ld+json"]').count()===0,`${route}: policy is not an editorial Article`);}
  }
  await context.close();
 }
 const sitemap=await readFile(path.join(output,'sitemap.xml'),'utf8');check(!/https:\/\/hijoshoku-navi\.com\/(tags|categories)\//.test(sitemap),'sitemap excludes noindex taxonomy');
 for(const route of Object.keys(routes))check(sitemap.includes('https://hijoshoku-navi.com'+route),'sitemap retains '+route);
 // Domain/branch fallback must cover the new image affiliate links too.
 for(const mode of ['other','cf-preview','disabled']){
  const dest=path.join(root,mode),args=mode==='other'?['--baseURL','https://preview.example/']:[];
  if(mode==='disabled'){
   const fixture=path.join(root,'disabled-source');await mkdir(fixture,{recursive:true});
   for(const file of ['layouts','assets','static','themes','hugo.toml','docs','data','content'])await cp(file,path.join(fixture,file),{recursive:true});
   const config=JSON.parse(await readFile('data/affiliate-links.json','utf8'));config.enabled=false;
   await writeFile(path.join(fixture,'data/affiliate-links.json'),JSON.stringify(config));args.push('--source',fixture);
  }
  build(dest,args,{...process.env,CF_PAGES_BRANCH:mode==='cf-preview'?'feat/seo-ux':'main'});serving=dest;
  const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage(),external=[];
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();external.push(r.request().url());return r.abort();});
  for(const route of Object.keys(routes)){
   const html=await readFile(path.join(dest,route,'index.html'),'utf8');check(!html.includes('https://af.moshimo.com/af/c/click'),`${mode} ${route}: no affiliate codes`);
   for(const im of Object.values(images))check(!html.includes(im.image),`${mode} ${route}: no ASP-supplied image URL in generated HTML`);
   assert.equal((await page.goto(base+route)).status(),200);
   check(await page.locator('.product-photo,img[src*="rakuten.co.jp"],img[src*="r10s.jp"],.product-sale-unit,[data-testid="affiliate-disclosure"]').count()===0,`${mode} ${route}: no product photos/src/captions or disclosure`);
   await verifyRows(page,route,false,mode);
  }
  check(external.filter(url=>/moshimo\.com|rakuten\.co\.jp|r10s\.jp/.test(url)).length===0,`${mode}: no ASP or product-image request attempted`);
  await context.close();
 }
 await writeFile(path.join(artifacts,'seo-ux-result.json'),JSON.stringify({status:failures.length?'FAIL':'PASS',kind:'local DOM/real images; analytics/ASP blocked; not reader comprehension or SEO impact evidence',checks:checks.length,failures,metrics,output},null,2));
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks:checks.length,failures,artifacts,output},null,2));
 assert.equal(failures.length,0,failures.join('\n'));
}finally{await browser.close();await new Promise(r=>server.close(r));}
