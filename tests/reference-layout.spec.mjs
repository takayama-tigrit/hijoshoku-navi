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
const editorial = JSON.parse(await readFile('data/editorial.json','utf8'));
// Independent published-route contract; do not infer the expectation from generated cards.
const expectedStoryPaths = [
 "/guide/",
 "/ranking/",
 "/posts/alpha-mai-osusume/",
 "/posts/emergency-food-set-check/",
 "/posts/emergency-food-side-dishes/",
 "/posts/emergency-water-bottles/",
 "/posts/emergency-food-for-one/",
 "/posts/emergency-food-storage/",
 "/posts/rolling-stock-routine/",
 "/posts/emergency-food-snacks/",
 "/posts/pack-rice-or-alpha-rice/",
 "/posts/emergency-food-to-go/",
 "/posts/emergency-canned-food/",
 "/posts/supermarket-emergency-food-list/"
];
const currentEvidence = JSON.parse(await readFile('data/article-evidence.json','utf8')).articles;
const additionalEvidence = JSON.parse(await readFile('data/article-evidence-content14.json','utf8')).articles;
assert.deepEqual(Object.keys(additionalEvidence).sort(), ['canned_food_14', 'shopping_list_14']);
assert.equal(additionalEvidence.canned_food_14.file, 'content/posts/emergency-canned-food.md');
assert.equal(additionalEvidence.shopping_list_14.file, 'content/posts/supermarket-emergency-food-list.md');
assert(Object.keys(additionalEvidence).every(key => !(key in currentEvidence)), 'evidence keys must not collide');
const publishedEvidencePaths = [];
for (const {file} of [...Object.values(currentEvidence), ...Object.values(additionalEvidence)]) {
 if (!file.startsWith('content/')) continue; // Preserve historical evidence outside publication.
 const source = await readFile(file,'utf8');
 if (!/^draft:\s*true\s*$/m.test(source)) publishedEvidencePaths.push('/'+file.replace(/^content\//,'').replace(/(?:\/index)?\.md$/,'')+'/');
}
assert.equal(new Set(publishedEvidencePaths).size, publishedEvidencePaths.length, 'published evidence routes must be unique');
assert.deepEqual([...publishedEvidencePaths].sort(), [...expectedStoryPaths].sort(), 'exact approved public article set');
const bodyPhotoIds = {
 '/guide/': ['meal', 'bread'],
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
    const actualStoryPaths = await page.locator('.lead-stories .story-copy h2 a').evaluateAll(links=>links.map(a=>new URL(a.href).pathname));
    check(m.cards===expectedStoryPaths.length && JSON.stringify([...actualStoryPaths].sort())===JSON.stringify([...expectedStoryPaths].sort()),`${width}: all published editorial stories are visible exactly once`);
    check(JSON.stringify(actualStoryPaths.slice(0,editorial.featured.length))===JSON.stringify(editorial.featured.map(x=>x.path.replace(/\/$/,'')+'/')),`${width}: configured featured order is retained`);
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
     check(await photo.locator('figcaption').count()===0, `${route} ${width}: no boilerplate captions`);
     if(width===390||width===1440) {
      await photo.locator('img').evaluate(img=>img.decode());
      await photo.screenshot({path:path.join(artifacts,`${width}-${route.split('/').filter(Boolean).join('-')}-body-photo-${i+1}.png`)});
     }
    }
   }
   for (const photo of await page.locator('.food-photo').all()) {
    const id=await photo.getAttribute('data-photo'), record=ledger.find(e=>e.id===id);
    check(await photo.locator('details.photo-credit').count()===0, `${route}: credits live on their dedicated page`);
    for(const img of await photo.locator('img').all()) { const src=await img.getAttribute('src');const image=ledger.find(r=>src.endsWith(r.local_path.replace('static/','')));check(image && await img.getAttribute('alt')===image.alt, `${route}: each cut retains accurate descriptive alt`); }
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
