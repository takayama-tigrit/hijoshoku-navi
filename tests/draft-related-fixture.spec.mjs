import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,cp,readFile,writeFile,readdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Independent regression for the fixture; not an editorial-approval bypass.
const moduleURL=new URL('./draft-related-fixture.mjs',import.meta.url);
assert.ok(await access(moduleURL).then(()=>true,()=>false),'coherent draft data fixture helper must exist');
const {createDraftRelatedFixture}=await import(moduleURL);
const sourceDir=process.cwd(),temp=await mkdtemp(path.join(tmpdir(),'draft-related-fixture-'));
const tree=async dir=>{const result={};for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory()){for(const [k,v] of Object.entries(await tree(p)))result[entry.name+'/'+k]=v;}else result[entry.name]=(await readFile(p)).toString('base64');}return result;};
const original=await tree(path.join(sourceDir,'data'));
const related=JSON.parse(await readFile('data/related-articles.json','utf8'));
const batches=[
 ['emergency-food-for-one','rolling-stock-routine','emergency-food-storage','emergency-water-bottles','emergency-food-snacks'],
 ['pack-rice-or-alpha-rice','emergency-food-to-go'],
 ['emergency-canned-food','supermarket-emergency-food-list'],
 ['emergency-food-set-check']
];
const build=(destination,args=[])=>spawnSync(process.env.HUGO_BIN||'hugo',['--destination',destination,'--baseURL','http://localhost/','--environment','development','--panicOnWarning',...args],{cwd:sourceDir,encoding:'utf8'});
const passed=(result,label)=>assert.equal(result.status,0,label+'\n'+result.stdout+result.stderr);
const rejected=(result,reason,label)=>{assert.notEqual(result.status,0,label);assert.match(result.stdout+result.stderr,reason,label);console.log(JSON.stringify({guard:label,exit_code:result.status,errors:(result.stdout+result.stderr).split('\n').filter(line=>line.includes('related article:'))}));};
const exists=p=>access(p).then(()=>true,()=>false);
const listings=['index.html','posts/index.html','index.xml','posts/index.xml','sitemap.xml'];
const results=[];
let negativeSource;
for(const [index,slugs] of batches.entries()){
 const content=path.join(temp,'content-'+index);await cp('content',content,{recursive:true});
 const draftRoutes=slugs.map(slug=>'/posts/'+slug+'/');
 for(const slug of slugs){const file=path.join(content,'posts',slug+'.md'),text=await readFile(file,'utf8');assert.match(text,/^draft: false$/m);await writeFile(file,text.replace(/^draft: false$/m,'draft: true'));}
 const stale=build(path.join(temp,'unadjusted-'+index),['--contentDir',content]);
 rejected(stale,/related article: (?:unknown target|unbuilt\/draft target)/,'unadjusted fixture must fail closed');
 const fixture=await createDraftRelatedFixture({sourceDir,fixtureDir:path.join(temp,'coherent-'+index),draftRoutes});
 const adjusted=JSON.parse(await readFile(path.join(fixture.dataDir,'related-articles.json'),'utf8'));
 const expected=structuredClone(related);
 for(const key of Object.keys(expected.pages)){if(draftRoutes.includes(key))delete expected.pages[key];else expected.pages[key]=expected.pages[key].filter(route=>!draftRoutes.includes(route));}
 assert.deepEqual(adjusted,expected,'only explicit draft keys and incoming rows removed');
 const copied=await tree(fixture.dataDir);
 assert.deepEqual(Object.keys(copied).sort(),Object.keys(original).sort());
 for(const [key,bytes] of Object.entries(original))if(key!=='related-articles.json')assert.equal(copied[key],bytes,'unrelated data bytes retained: '+key);
 const normal=path.join(temp,'normal-'+index),shown=path.join(temp,'shown-'+index);
 passed(build(normal,[...fixture.buildArgs,'--contentDir',content]),'coherent normal fixture');
 passed(build(shown,['--contentDir',content,'--buildDrafts']),'draft included with original data');
 for(const route of draftRoutes){
  assert.equal(await exists(path.join(normal,route,'index.html')),false,'draft HTML excluded');
  assert.ok((await readFile(path.join(shown,route,'index.html'),'utf8')).includes('参考にした情報'));
  for(const file of listings){assert.ok(!(await readFile(path.join(normal,file),'utf8')).includes(route),file+' excludes '+route);assert.ok((await readFile(path.join(shown,file),'utf8')).includes(route),file+' includes draft preview '+route);}
 }
 assert.deepEqual(await tree(path.join(sourceDir,'data')),original,'source data unchanged after real builds');
 results.push({slugs,unadjusted:'REJECTED',normal:'PASS',shown:'PASS'});
 negativeSource=fixture;
}
const negativeMap=path.join(negativeSource.dataDir,'related-articles.json'),saved=await readFile(negativeMap,'utf8');
for(const [name,targets,reason] of [
 ['unknown',['/posts/not-a-real-article/'],/related article: unknown target/],
 ['unknown-href',['https://invalid.example/'],/related article: unknown target/],
 ['self',['/ranking/'],/related article: self\/duplicate target/],
 ['duplicate',['/guide/','/guide/'],/related article: self\/duplicate target/]
]){
 const value=JSON.parse(saved);value.pages['/ranking/']=targets;await writeFile(negativeMap,JSON.stringify(value));
 rejected(build(path.join(temp,'negative-'+name),negativeSource.buildArgs),reason,name+' rejected by actual Hugo guard');
 results.push({negative:name,status:'REJECTED'});
}
await writeFile(negativeMap,saved);
for(const draftRoutes of [['/posts/not-in-map/'],['/ranking/','/ranking/'],['ranking'],[]])await assert.rejects(createDraftRelatedFixture({sourceDir,fixtureDir:path.join(temp,'invalid-'+results.length),draftRoutes}));
await assert.rejects(createDraftRelatedFixture({sourceDir,fixtureDir:sourceDir,draftRoutes:['/ranking/']}));
const publicOutput=path.join(temp,'fresh-public');passed(build(publicOutput),'fresh public keeps original data');
for(const slugs of batches)for(const slug of slugs)assert.equal(await exists(path.join(publicOutput,'posts',slug,'index.html')),true);
assert.deepEqual(await tree(path.join(sourceDir,'data')),original,'source data invariant at end');
console.log(JSON.stringify({status:'PASS',scope:'real Hugo draft-fixture isolation and strict related guard, not approval',results,temp},null,2));
