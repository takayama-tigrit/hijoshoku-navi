import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as planner from '../assets/js/stock-planner.js';
assert.equal(typeof planner.calculateDays, 'function', 'v7 needs independent stock-to-days arithmetic');
const sample = {people: 2, days: 3, litres: 12, meals: 18, mealsPerDay: 3};
let r = planner.calculateDays(sample);
assert.equal(r.water.coverage, 2); assert.equal(r.food.coverage, 3);
assert.equal(r.water.shortage, 6); assert.equal(r.water.buy, 3); assert.equal(r.food.shortage, 0);
r = planner.calculateDays({...sample, days:7});
assert.equal(r.water.shortage,30); assert.equal(r.food.shortage,24);
for (const litres of [0, 0.001, 12.5, 2000]) {
 r=planner.calculateDays({...sample,litres}); assert.equal(r.water.coverage,litres/6); assert(r.water.shortage>=0);
}
assert.equal(planner.formatDays(0.001), '0.1日未満');
assert.equal(planner.calculateDays({...sample, mealsPerDay:2}).food.coverage,4.5);
for(const key of ['litres','meals']) for(const value of ['', ' ', -1, NaN, Infinity, 1e100]) {
 r=planner.calculateDays({...sample,[key]:value}); assert.equal(r[key==='litres'?'water':'food'],null);
 assert(r[key==='litres'?'food':'water']);
}
for(const people of [0,13,1.5,NaN,'']) {r=planner.calculateDays({...sample,people}); assert.equal(r.water,null);assert.equal(r.food,null);}
for(const mealsPerDay of [0,7,1.5,'']) {r=planner.calculateDays({...sample,mealsPerDay}); assert.equal(r.food,null);assert(r.water);}
for(const days of [0,4,'']) {r=planner.calculateDays({...sample,days}); assert.equal(r.water,null);assert.equal(r.food,null);}
assert.equal(planner.calculateDays({...sample,litres:100,meals:100}).food.shortage,0);
const guide=await readFile('content/guide/index.md','utf8');
assert(guide.indexOf('{{< planner >}}')<guide.indexOf('## 棚の食品'), 'Answer near introduction');
for(const f of ['content/guide/index.md','content/ranking/index.md','content/posts/alpha-mai-osusume.md']) {
 const text=await readFile(f,'utf8'); assert(!/id="(?:meals|water|energy|food-energy|food-storage|rice-weight|rice-water)"|data-quantity-id="(?:yokan-box|rice-bag-scenarios|rice-storage|recovery-duration|red-rice-prep)"/.test(text),'remove decoration, retain facts in prose/tables');
}
const sidebar=await readFile('layouts/_partials/editorial-sidebar.html','utf8');
assert(!sidebar.includes('手元の水の本数'),'sidebar must describe litres, not obsolete bottle-only UI');
// Review regressions: decimal strings and finite numbers share the 1mL domain.
const precisionFailures = [];
for (const litres of ['17.9999999999', 17.9999999999, '15.9999999999', 15.9999999999, '5e-324', Number.MIN_VALUE, '1e1', '0.0001', true, [], '0x10']) {
 try { const result=planner.calculateDays({...sample,litres}); assert.equal(result.water,null, String(litres)); assert(result.food); }
 catch(e) { precisionFailures.push(e.message); }
}
assert.deepEqual(precisionFailures, [], 'reject excessive precision and underflow without rounding');
for (const [litres,shortage,buy] of [['17.999',.001,1], [15.999,2.001,2], ['0.001',17.999,9], ['0',18,9], [2000,0,0]]) {
 const result=planner.calculateDays({...sample,litres}); assert.equal(result.water.shortage,shortage); assert.equal(result.water.buy,buy);
}
assert.equal(planner.formatDays(planner.calculateDays({...sample,litres:'0.001'}).water.coverage),'0.1日未満');
console.log('PASS v7 arithmetic, partial/invalid/zero/fractional/boundary inputs and article reduction');
