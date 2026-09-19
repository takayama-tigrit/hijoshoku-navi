import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, cp, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const t=JSON.parse(await readFile('data/editorial.json','utf8'));
const images=JSON.parse(await readFile('docs/image-licenses.json','utf8')).images;
const icons=await readFile('layouts/_partials/editorial-icon.html','utf8');
const supports=id=>icons.includes(`eq . "${id}"`);
assert(supports(t.identity.symbol)&&supports(t.featureSymbol),'configured symbols must exist');
for(const item of t.navigation)assert(supports(item.icon),'navigation icon exists');
assert.equal(t.navigation.length,4,'four links plus the native menu icon');
assert(/^\/images\/[\w-]+\.svg$/.test(t.identity.favicon),'local SVG favicon');
await access('static'+t.identity.favicon);
assert(t.featured.length>=3,'retain the baseline editorial stories');
assert.equal(new Set(t.featured.map(f=>f.path)).size,t.featured.length,'distinct real featured articles');
for(const f of t.featured){
 assert(/^\/[a-z0-9/-]+$/.test(f.path)&&!f.path.includes('..'),'safe article path');
 let found=false;for(const name of [`content${f.path}.md`,`content${f.path}/index.md`]){try{await access(name);found=true;}catch{}}
 assert(found,`featured article exists: ${f.path}`);assert(images.some(i=>i.id===f.image));
}
for(const composition of [t.featured[0],...Object.values(t.articleCovers)]){
 assert.equal(composition.images.length,3);assert.equal(new Set(composition.images).size,3);
 for(const id of composition.images)assert(images.some(i=>i.id===id),'all three licensed cuts exist');
 assert.equal(composition.lines.length,2);
}
const fixture=await mkdtemp(path.join(tmpdir(),'editorial-style-guide-'));
for(const f of ['assets','layouts','content','static','docs','data','themes','hugo.toml'])await cp(f,path.join(fixture,f),{recursive:true});
await mkdir(path.join(fixture,'content/style-guide'),{recursive:true});
// This file lives outside public content. Production must never generate the specimen route.
assert(await access('tests/fixtures/style-guide.md').then(()=>true,()=>false),'local-only component specimen must exist');
await cp('tests/fixtures/style-guide.md',path.join(fixture,'content/style-guide/index.md'));
const output=path.join(fixture,'public');
execFileSync(process.env.HUGO_BIN||'hugo',['--source',fixture,'--destination',output],{stdio:'inherit'});
const html=await readFile(path.join(output,'style-guide/index.html'),'utf8');
for(const selector of ['style-guide-icons','article-choice','feature-composition','article-references'])assert(html.includes(selector),`real component specimen: ${selector}`);
for(const id of ['home','book','food','memo','menu','plant'])assert(html.includes(`data-symbol="${id}"`));
const sitemap=await readFile(path.join(output,'sitemap.xml'),'utf8');assert(!sitemap.includes('/style-guide/'),'no sitemap listing');
const home=await readFile(path.join(output,'index.html'),'utf8');assert(!home.includes('/style-guide/'),'no home listing');
console.log('PASS design schema and real Hugo style guide:',path.join(output,'style-guide/index.html'));
