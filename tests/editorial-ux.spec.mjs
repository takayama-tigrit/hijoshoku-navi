import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
const output=await mkdtemp(path.join(tmpdir(),'editorial-ux-'));
const artifacts=process.env.ARTIFACT_DIR||path.join(output,'evidence');
await mkdir(artifacts,{recursive:true});
execFileSync(process.env.HUGO_BIN||'hugo',['--minify','--destination',output],{stdio:'inherit'});
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p.endsWith('/'))p+='index.html';const f=path.resolve(output,'.'+p);assert(f.startsWith(output+path.sep));const bytes=await readFile(f);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`, browser=await chromium.launch(browserOptions());
const failures=[], measurements=[];
const check=(v,m)=>{if(!v)failures.push(m);};
const ledger=JSON.parse(await readFile('docs/image-licenses.json','utf8')).images;
try {
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:960},javaScriptEnabled:false,...(width===390?{isMobile:true,deviceScaleFactor:1,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await context.newPage();
  for(const route of ['/','/guide/','/ranking/','/posts/alpha-mai-osusume/','/photo-credits/','/privacy/','/about/']){
   const response=await page.goto(base+route);check(response.status()===200,`${route}: available`);
   const slug=route.replaceAll('/','-')||'home';
   for(const image of await page.locator('img').all()){await image.scrollIntoViewIfNeeded();await image.evaluate(e=>e.decode());}await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(artifacts,`${width}-${slug}-first.png`)});
   check(await page.locator('.photo-credit,.article-disclosure,.editorial-note').count()===0,`${route}: no repeated audit DOM`);
   check(!/掲載商品の現物ではありません|写真の出典・利用許諾|一般の食品イメージ/.test(await page.locator('body').innerText()),`${route}: no stock-photo disclaimers`);
   check(await page.locator('.site-footer a[href="/photo-credits/"]').count()===1,`${route}: one credits link`);
   // Former blanket "no unconfigured GA" is now production-only; full network gates live in analytics.spec.mjs.
   check(await page.locator('script[src*="googletagmanager.com"],script[src*="google-analytics.com"]').count()===0,`${route}: no remote Google tag with JS disabled on localhost`);
   if(['/guide/','/ranking/','/posts/alpha-mai-osusume/'].includes(route)){
    check(!/\[\d+\]/.test(await page.locator('main').innerText()),`${route}: no numbered citations`);
    const refs=page.locator('.article-references');check(await refs.count()===1,`${route}: reference section`);
    if(await refs.count()){
     const m=await refs.evaluate(e=>({font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight),heading:parseFloat(getComputedStyle(e.querySelector('h2')).fontSize),links:e.querySelectorAll('a').length}));measurements.push({route,width,...m});check(m.font===13&&Math.abs(m.line-21.45)<.1&&m.heading<18&&m.links>=7,`${route}: quiet readable references`);
     await refs.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${width}-${slug}-references.png`)});
    }else{const old=page.locator('#sources');if(await old.count()){await old.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`${width}-${slug}-references.png`)});}}
   }
   if(route==='/photo-credits/'&&response.status()===200){
    for(const rec of ledger){const item=page.locator(`[data-credit="${rec.id}"]`);check(await item.count()===1,`credit ${rec.id}`);if(await item.count()){const text=await item.innerText();for(const k of ['author','license','attribution','modifications'])check(text.includes(rec[k]),`credit ${rec.id} ${k}`);check(await item.locator('a').evaluateAll((as,urls)=>urls.every(u=>as.some(a=>decodeURI(a.href)===decodeURI(u))),[rec.source_url,rec.license_url]),`credit links ${rec.id}`);}}
    await page.screenshot({path:path.join(artifacts,`${width}-credits-full.png`),fullPage:true});
   }
   if(route==='/privacy/'){const text=await page.locator('main').innerText();check(text.includes('Cloudflare')&&text.includes('外部へ送信')&&text.includes('Google Analytics'), 'accurate local-input, Cloudflare and production GA privacy');}
  }
  await context.close();
 }
 try{await access(path.join(output,'style-guide/index.html'));check(false,'style guide must not ship in production');}catch{}
 await writeFile(path.join(artifacts,'ux-result.json'),JSON.stringify({failures,measurements},null,2));
 assert.deepEqual(failures,[]);console.log('PASS editorial UX, references, credits, privacy',artifacts);
}finally{await browser.close();await new Promise(r=>server.close(r));}
