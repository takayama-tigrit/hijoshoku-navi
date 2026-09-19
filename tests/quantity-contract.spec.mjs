import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const q = JSON.parse(await readFile('data/quantities.json', 'utf8'));
assert.equal(q.water.litres_per_person_day, 3);
assert.equal(q.water.bottle_litres, 2);
assert.equal(q.water.scenarios.length, 6);
for (const s of q.water.scenarios) {
  assert.equal(s.litres, 3 * s.people * s.days);
  assert.equal(s.meal_occasions, 3 * s.people * s.days);
}
assert.deepEqual(q.rice.map(x => [x.id, x.kcal, x.protein_g, x.salt_g]), [['white',366,6.3,0.01],['gomoku',377,6.9,1.8],['wakame',361,6.6,1.7]]);
for (const r of q.rice) {
  assert.equal(r.dry_g, 100); assert.equal(r.cooked_g, 260); assert.equal(r.water_ml, 160);
}
assert.deepEqual(q.preparation, { hot_water_minutes: 15, water_temperature_c: 15, water_minutes: 60, source_ids: [10] });
assert.deepEqual(q.foods.map(x => [x.serving_g, x.kcal, x.shelf_life_months]), [[100,366,60],[70,257,60],[60,171,66]]);
assert.equal(q.foods[2].units_per_box, 5);
for (const s of q.rice_water_scenarios) assert.equal(s.water_litres, 160 * s.bags / 1000);
assert.equal(q.rice_only_energy.total_kcal, q.rice_only_energy.bags * q.rice_only_energy.kcal_each);
assert.equal(q.rice_only_energy.is_complete_daily_nutrition, false);
// Semantic copy contracts: retain usable conditions, not the old blanket disclaimers.
const guide=await readFile('content/guide/index.md','utf8');
const ranking=await readFile('content/ranking/index.md','utf8');
const alpha=await readFile('content/posts/alpha-mai-osusume.md','utf8');
for(const [name,text] of Object.entries({guide,ranking,alpha})) {
  for(const token of ['主菜','副菜','アレルギー','残存賞味期限','15℃','60分','生活用水']) assert(text.includes(token),`${name}: missing condition ${token}`);
  assert(!/保証しません|保証できません|判断できません/.test(text),`${name}: defensive copy returned`);
}
assert(/延べ食事回数/.test(guide)&&/袋数とも区別/.test(guide),'meal occasions remain separate from packages');
assert(/1日に必要な量とは分けて/.test(guide)&&/主食の熱量だけ/.test(guide),'energy sum is not nutritional sufficiency');
assert(/水温が違えば待ち時間も変わる/.test(guide),'15°C is conditional, not all cold water');
assert(/かむ・飲み込む/.test(guide)&&/専門職への相談/.test(guide),'individual dietary support retained');
assert(/保管条件/.test(guide)&&/期限内/.test(guide),'storage and expiry conditions retained');
assert(/小麦・卵・乳成分・大豆/.test(ranking)&&/製造上の注意/.test(ranking),'bread allergens and production notice retained');
assert(/通常品は小麦・大豆を含み、「アレルギー対応五目ごはん」とは別商品/.test(alpha),'same-name product distinction retained');
assert(/ホタテエキス/.test(alpha)&&/現物で確かめ/.test(alpha),'actual ingredient label matters');
assert(/乾燥状態の1袋100g当たり/.test(alpha)&&/出来上がり100gではなく/.test(alpha),'nutrition denominator retained');
assert(/1人につき1日3袋を使うと仮定した試算/.test(alpha)&&/飲み水は別/.test(alpha),'water scenario is an assumption, not total water need');
assert(/戻したごはんは、早めに食べ切/.test(alpha)&&/賞味期限を過ぎた商品の喫食を勧めていない/.test(alpha),'post-preparation and expiry guidance retained');
console.log('PASS: shared quantities, food roles, allergens, temperature, units and storage contracts');
