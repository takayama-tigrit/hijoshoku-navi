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
console.log('PASS: shared chart data matches reviewed manufacturer facts and calculated quantities');
