import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';

const dataBytes=async dir=>{
 const files={};
 for(const entry of await readdir(dir,{withFileTypes:true})){
  assert.ok(!entry.isSymbolicLink(),'fixture data must not contain symlinks');
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())for(const [key,value] of Object.entries(await dataBytes(file)))files[entry.name+'/'+key]=value;
  else files[entry.name]=await readFile(file);
 }
 return files;
};

// Normal draft exclusion only. --buildDrafts and fresh public builds keep original data.
// The template uses source-relative readFile("data/related-articles.json").
// Root its data copy in a temporary source (--dataDir is not a Hugo CLI flag),
// without changing templates or any original file.
export async function createDraftRelatedFixture({sourceDir,fixtureDir,draftRoutes}){
 assert.ok(path.isAbsolute(sourceDir)&&path.isAbsolute(fixtureDir),'explicit absolute source and fixture directories required');
 sourceDir=await realpath(sourceDir);fixtureDir=path.resolve(fixtureDir);
 const relative=path.relative(sourceDir,fixtureDir),reverse=path.relative(fixtureDir,sourceDir);
 assert.ok(relative.startsWith('..'+path.sep)&&reverse.startsWith('..'+path.sep),'source and fixture must be separate trees');
 assert.ok(Array.isArray(draftRoutes)&&draftRoutes.length>0,'explicit nonempty draftRoutes required');
 assert.equal(new Set(draftRoutes).size,draftRoutes.length,'duplicate draft route');
 const before=await dataBytes(path.join(sourceDir,'data'));
 const related=JSON.parse(before['related-articles.json']);
 for(const route of draftRoutes){
  assert.match(route,/^\/(?:[a-z0-9-]+\/)+$/,'literal canonical draft route required');
  assert.ok(Object.hasOwn(related.pages,route),'unknown draft route: '+route);
 }
 const excluded=new Set(draftRoutes);
 for(const route of Object.keys(related.pages)){
  if(excluded.has(route))delete related.pages[route];
  else related.pages[route]=related.pages[route].filter(target=>!excluded.has(target));
 }
 await mkdir(fixtureDir,{recursive:false}); // Never reuse/overwrite another fixture.
 for(const name of ['hugo.toml','content','data','docs','layouts','assets','static','themes'])await cp(path.join(sourceDir,name),path.join(fixtureDir,name),{recursive:true});
 const dataDir=path.join(fixtureDir,'data');
 await writeFile(path.join(dataDir,'related-articles.json'),JSON.stringify(related,null,2)+'\n');
 const after=await dataBytes(dataDir);
 assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort(),'fixture data path set unchanged');
 for(const [key,bytes] of Object.entries(before))if(key!=='related-articles.json')assert.deepEqual(after[key],bytes,'non-related data bytes unchanged: '+key);
 assert.deepEqual(await dataBytes(path.join(sourceDir,'data')),before,'source data must remain byte-identical');
 return {sourceDir:fixtureDir,dataDir,buildArgs:['--source',fixtureDir]};
}
