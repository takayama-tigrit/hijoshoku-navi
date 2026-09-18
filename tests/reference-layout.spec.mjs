import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const output = await mkdtemp(path.join(tmpdir(), 'hijoshoku-reference-'));
const artifacts = process.env.ARTIFACT_DIR || path.join(output, 'evidence');
await mkdir(artifacts, { recursive: true });
execFileSync(process.env.HUGO_BIN || 'hugo', ['--minify', '--destination', output], { stdio: 'inherit' });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    let name = new URL(req.url, 'http://localhost').pathname;
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(output, '.' + name);
    assert(file.startsWith(output + path.sep));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {});
const ledger = JSON.parse(await readFile('docs/image-licenses.json', 'utf8')).images;
const bodyPhotoIds = {
 '/guide/': ['meal', 'cooked-rice', 'bread'],
 '/ranking/': ['bread', 'meal'],
 '/posts/alpha-mai-osusume/': ['meal', 'bread'],
};
const bodyCaptions = {};
for (const [route, file] of Object.entries({'/guide/':'content/guide/index.md','/ranking/':'content/ranking/index.md','/posts/alpha-mai-osusume/':'content/posts/alpha-mai-osusume.md'})) {
 bodyCaptions[route] = [...(await readFile(file,'utf8')).matchAll(/{{< photo id="([^"]+)" caption="([^"]+)" >}}/g)].map(m=>m[2]);
}
const failures = [], measurements = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
try {
 for (const width of [320,390,768,1440]) {
  const context = await browser.newContext({viewport:{width,height:960},javaScriptEnabled:false});
  const page=await context.newPage();
  for (const route of ['/', '/guide/', '/ranking/', '/posts/alpha-mai-osusume/', '/about/', '/privacy/', '/posts/', '/404.html']) {
   await page.goto(base+route,{waitUntil:'networkidle'});
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} ${width}: overflow`);
   check(await page.locator('h1').count()===1,`${route}: one h1`);
   if(route==='/') {
    const m=await page.evaluate(()=>{
     const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
     return {lead:rect('.lead-stories'),first:rect('.story-card:first-child'),second:rect('.story-card:nth-child(2)'),side:rect('.editorial-sidebar'),planner:rect('.stock-planner'),cards:document.querySelectorAll('.lead-stories .story-card').length,background:getComputedStyle(document.body).backgroundColor};
    });
    check(m.cards===3,`${width}: exactly three real editorial stories`);
    check(m.background==='rgb(255, 255, 255)',`${width}: white editorial canvas`);
    check(m.lead&&m.planner.y>m.lead.bottom,`${width}: planner follows stories`);
    if(width===1440)check(m.lead?.width===752&&!m.side&&m.first.width===752&&m.second.width===364, 'desktop: centered 752, full lead then two columns');
    if(width<=390)check(m.second.y>=m.first.bottom&&m.second.width===width-32,`${width}: secondary story is vertically stacked`);
    measurements.push({route,width,...m});
   } else if(['/guide/','/ranking/','/posts/alpha-mai-osusume/'].includes(route)) {
    const m=await page.evaluate(()=>{
     const image=document.querySelector('.article-cover img'), title=document.querySelector('.article-header h1'),body=document.querySelector('.article-content'),a=document.querySelector('.article-jump');
     return {imageY:image?.getBoundingClientRect().y,titleY:title.getBoundingClientRect().y,bodyWidth:body.getBoundingClientRect().width,font:getComputedStyle(body).fontSize,line:getComputedStyle(body).lineHeight,titleSize:getComputedStyle(title).fontSize,actionBottom:a?.getBoundingClientRect().bottom,radius:getComputedStyle(document.querySelector('[data-choice-card]')).borderRadius};
    });
    check(m.titleY<m.imageY,`${route} ${width}: title before photo`);
    check(m.font==='16px'&&m.line==='28px',`${route} ${width}: 16px/28px body`);
    check(m.radius==='0px',`${route}: flat editorial choice memo`);
    if(width<=390)check(m.titleSize==='18px'&&m.actionBottom<750,`${route} ${width}: compact title and early choice`);
    if(width===1440)check(m.bodyWidth===518,`${route}: 518px reading column`);
    measurements.push({route,width,...m});
   }
   if (bodyPhotoIds[route]) {
    const photos = page.locator('.article-content .food-photo');
    check(JSON.stringify(await photos.evaluateAll(es=>es.map(e=>e.dataset.photo)))===JSON.stringify(bodyPhotoIds[route]), `${route}: all body photos retained`);
    for (const [i, photo] of (await photos.all()).entries()) {
     const visible = photo.locator('figcaption > span:visible');
     check(await visible.count()===1, `${route} ${width} photo ${i}: exactly one visible caption`);
     check((await visible.allTextContents()).join('')===bodyCaptions[route][i], `${route} ${width} photo ${i}: preserve complete contextual caption without repetition`);
     check(/イメージ。.*(?:普通|通常)の.*ではありません。/.test(await visible.first().innerText()), `${route} ${width} photo ${i}: nearby general-food and non-product qualification`);
     if(width===390||width===1440) {
      await photo.locator('img').evaluate(img=>img.decode());
      await photo.screenshot({path:path.join(artifacts,`${width}-${route.split('/').filter(Boolean).join('-')}-body-photo-${i+1}.png`)});
     }
    }
   }
   for (const photo of await page.locator('.food-photo').all()) {
    const id=await photo.getAttribute('data-photo'), record=ledger.find(e=>e.id===id);
    const details=photo.locator('details.photo-credit'), visible=photo.locator('figcaption > span');
    check(await visible.count()===1, `${route} ${width} ${id}: single near-image caption`);
    check(await details.evaluate(e=>!e.open), `${route} ${width} ${id}: credits initially collapsed`);
    const text=await details.textContent();
    for(const key of ['caption','author','license','attribution','modifications']) check(text.includes(record[key]), `${route} ${width} ${id}: credit retains ${key}`);
    check(await details.locator('a').evaluateAll((links, urls)=>urls.every(url=>links.some(a=>decodeURI(a.href)===decodeURI(url))), [record.source_url,record.license_url]), `${route} ${id}: original and license links retained`);
    if(id==='pantry') check((await visible.innerText()).includes('安全な収納方法を推奨する写真') && (await visible.innerText()).includes('掲載商品の現物ではありません'), `${route} ${width}: pantry safety qualification stays nearby`);
    if(await photo.evaluate(e=>e.classList.contains('article-cover')) && id==='water-bottles') check(/一般イメージ.*掲載商品の現物ではありません/.test(await visible.innerText()) && (await visible.innerText()).includes('必要量や商品の推奨を示すものではありません'), `${route} ${width}: water identity and quantity qualification stay nearby`);
    await details.locator('summary').click();
    check(await details.locator('p').isVisible(), `${route} ${width} ${id}: source details expandable without JS`);
    await details.locator('summary').click();
   }
   for(const image of await page.locator('img').all()){await image.scrollIntoViewIfNeeded();await image.evaluate(img=>img.decode());}
   await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(artifacts,`${width}-${route==='/'?'home':route.split('/').filter(Boolean).join('-')}-first.png`)});
   await page.screenshot({path:path.join(artifacts,`${width}-${route==='/'?'home':route.split('/').filter(Boolean).join('-')}-reference.png`),fullPage:true});
  }
  await context.close();
 }
 await writeFile(path.join(artifacts,'reference-measurements.json'),JSON.stringify({failures,measurements},null,2));
 assert.deepEqual(failures,[]);
 console.log(JSON.stringify({status:'PASS',artifacts,measurements},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
