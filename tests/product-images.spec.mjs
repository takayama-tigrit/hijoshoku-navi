import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const photos=await load('data/product-images.json'),comp=await load('data/product-comparisons.json'),links=await load('data/affiliate-links.json'),q=await load('data/quantities.json'),ledger=await load('docs/sources/ledger.json');
const terms=Object.keys(links.links);
assert.equal(photos.mediaId,'689409');assert.equal(terms.length,9);
assert.deepEqual(Object.keys(photos.images).sort(),terms.slice().sort());
assert.deepEqual(Object.keys(comp.products).sort(),terms.slice().sort());
const sourceIds=[12,1,2,7,8,13,14,15,16];
const ordered=['尾西 ひだまりパン プレーン','尾西 白飯 100g','井村屋 えいようかん','尾西 五目ごはん 100g','尾西 わかめごはん 100g','尾西 ごはんシリーズ CY','尾西 ごはんシリーズ DW','ハウス 温めずにおいしいカレー まろやか野菜カレー 200g','ハウス 温めずにおいしいカレー 香りたつキーマカレー 180g'];
function validatePhoto(im){
 const u=new URL(im.href),d=new URL(im.destination),image=new URL(im.image),src=new URL(im.source);
 assert.equal(u.origin,'https://af.moshimo.com');assert.equal(u.pathname,'/af/c/click');assert(!u.hash&&!u.username&&!u.password);
 assert.deepEqual([...u.searchParams.keys()].sort(),['a_id','m','p_id','pc_id','pl_id','url']);
 for(const [k,v] of Object.entries({a_id:'5810105',p_id:'54',pc_id:'54',pl_id:'616'}))assert.equal(u.searchParams.get(k),v);
 assert.equal(u.searchParams.get('url'),im.destination);assert.equal(d.origin,'https://item.rakuten.co.jp');assert(!d.search&&!d.hash);
 const mobile=new URL(u.searchParams.get('m'));assert.equal(mobile.origin,'http://m.rakuten.co.jp');assert(!mobile.search&&!mobile.hash);assert.equal(mobile.pathname.split('/')[1],d.pathname.split('/')[1]);
 assert.equal(image.origin,'https://thumbnail.image.rakuten.co.jp');assert.deepEqual([...image.searchParams.entries()],[['_ex','300x300']]);
 assert.equal(src.origin,'https://af.moshimo.com');assert.equal(src.searchParams.get('shop_site_id'),'689409');assert.equal(src.searchParams.get('promotion_id'),'54');
 const attr=(tag,name)=>im.officialCode.match(new RegExp('<'+tag+'[^>]*?\\s'+name+'="([^"]+)"'))?.[1].replaceAll('&amp;','&');
 assert.equal(new URL(attr('a','href'),'https://af.moshimo.com').href,im.href,'exact official code, not synthesized tracking URL');
 assert.equal(new URL(attr('img','src'),'https://af.moshimo.com').href,im.image,'exact image, no arbitrary image replacement');
}
for(const [i,term]of ordered.entries()){
 validatePhoto(photos.images[term]);
 const official=new URL(comp.products[term].official);official.hash='';
 assert.equal(official.href.replace(/\/$/,''),ledger.sources.find(s=>s.id===sourceIds[i]).url.replace(/\/$/,''),'official destination must be a retrieved product source');
}
for(const mutate of [im=>im.href=im.href.replace('5810105','999'),im=>im.image=im.image.replace('300x300','80x80'),im=>im.href+='&memo=visitor',im=>im.destination=im.destination.replace('https:','http:')]){const im=structuredClone(photos.images[ordered[0]]);mutate(im);assert.throws(()=>validatePhoto(im));}
for(const food of q.foods){const term={bread:ordered[0],white:ordered[1],yokan:ordered[2]}[food.id];const spec=comp.products[term].spec;assert(spec.includes(`${food.serving_g}g`)&&spec.includes(`${food.kcal}kcal`),'serving/energy must match existing quantity source');}
for(const rice of q.rice.filter(x=>x.id!=='white')){const term=rice.id==='gomoku'?ordered[3]:ordered[4],spec=comp.products[term].spec;for(const value of [`1袋${rice.dry_g}g`,`${rice.kcal}kcal`,`${rice.salt_g}g`])assert(spec.includes(value),'rice unit and value '+value);}
assert(comp.products[ordered[3]].note.includes('小麦・大豆')&&comp.products[ordered[3]].note.includes('別商品'));
assert(comp.products[ordered[7]].note.includes('大豆・豚肉・りんご'));assert(comp.products[ordered[8]].note.includes('大豆・鶏肉・豚肉・りんご'));
assert.deepEqual(comp.groups, {
 ranking:[ordered[0],ordered[1],ordered[2]], alpha:[ordered[1],ordered[3],ordered[4]],
 sets:[ordered[5],ordered[6]], sides:[ordered[7],ordered[8]],
 'guide-white':[ordered[1]], snacks:[ordered[2]],
});
assert(Object.values(comp.groups).flat().every(t=>terms.includes(t)));
console.log('PASS 9 exact official image codes/product destinations/source URLs; 12 group rows; quantity/source consistency; 4 negative mutations');
