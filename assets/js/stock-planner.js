/** Pure arithmetic; caller supplies the published data/quantities.json rates. */
export function calculateStock({ people, days, bottles }, rate = 3, bottleSize = 2) {
  const values = [people, days, bottles];
  if (values.some(v => v === '' || v == null || !Number.isInteger(Number(v)))) throw new RangeError('人数・日数・在庫を整数で入力してください。');
  people = Number(people); days = Number(days); bottles = Number(bottles);
  if (people < 1 || people > 12 || ![3, 7].includes(days) || bottles < 0 || bottles > 1000) throw new RangeError('人数は1〜12人、日数は3日か7日、在庫は0〜1000本で入力してください。');
  const required = rate * people * days;
  const stock = bottleSize * bottles;
  const shortage = Math.max(0, required - stock);
  return { people, days, bottles, required, stock, shortage, buy: Math.ceil(shortage / bottleSize) };
}
export function buildMemo(result, note = '', rate = 3, bottleSize = 2) {
  const water = result
    ? `水：計算済み\n${result.people}人 × ${result.days}日\n目安の総量：${result.required}L\n現在の在庫：${bottleSize}L × ${result.bottles}本（${result.stock}L）\n不足：${result.shortage}L\n買い足す${bottleSize}Lボトル：${result.buy}本`
    : '水：未確認\n水量は未入力・変更中・入力エラーのため、買い足し量を記載していません。';
  return `食品・水の備蓄メモ\n\n${water}\n\n食べ物・家族の条件メモ：\n${note}\n\n食品の量・栄養の充足は自動判定していません。手持ちで足りれば今は買わず、期限や家族が食べられるかを確認してください。\n1人1日${rate}Lの目安。生活・調理すべてを賄う保証ではありません。調理用水・生活用水は別に確認。\n出典：首相官邸 https://www.kantei.go.jp/jp/headline/bousai/sonae.html\n`;
}
// Water and staple portions are independent; blank is not zero.
// Valid litres: plain decimal string/number, 0–2000 L, up to 3 decimal places (1 mL).
// Exponential notation, hex, >3 decimal places, and underflow are rejected → water = null.
export function calculateDays(input, rate = 3, bottleSize = 2) {
  const valid = (v, min, max, integer = false) => v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max && (!integer || Number.isInteger(Number(v)));
  const validLitres = (v) => { const s = v != null ? String(v).trim() : ''; return /^\d+(\.\d{1,3})?$/.test(s) && Number(s) >= 0 && Number(s) <= 2000; };
  const people = Number(input.people), days = Number(input.days);
  const common = valid(input.people, 1, 12, true) && [3, 7].includes(days);
  const errors = [];
  if (!common) errors.push('人数は1〜12人、目標は3日か7日で入力してください。');
  let water = null, food = null;
  const litresBlank = input.litres == null || String(input.litres).trim() === '';
  if (common && validLitres(input.litres) && valid(rate, 0.01, 100) && valid(bottleSize, 0.01, 100)) {
    const stockMl = Math.round(Number(String(input.litres).trim()) * 1000);
    const reqMl = Math.round(people * days * rate * 1000);
    const bottleMl = Math.round(bottleSize * 1000);
    const shortageMl = Math.max(0, reqMl - stockMl);
    water = { stock: stockMl / 1000, required: reqMl / 1000, coverage: stockMl / (people * rate * 1000), shortage: shortageMl / 1000, buy: Math.ceil(shortageMl / bottleMl) };
  } else if (common && !litresBlank) {
    errors.push('水は0〜2000L、小数第3位（1mL）まで入力してください。指数表記・超精度は未確認になります。');
  } else if (common) {
    errors.push('水は合計0〜2000Lで入力。空欄は未確認になります。');
  }
  if (common && valid(input.meals, 0, 10000, true) && valid(input.mealsPerDay, 1, 6, true)) {
    const stock = Number(input.meals), required = people * days * Number(input.mealsPerDay);
    food = { stock, required, coverage: stock / (people * Number(input.mealsPerDay)), shortage: Math.max(0, required - stock) };
  } else if (common) errors.push('主食は0〜10000食分、1人1日は1〜6食分の整数で入力。空欄は未確認になります。');
  return { people, days, mealsPerDay: Number(input.mealsPerDay), water, food, errors };
}
export function formatDays(value) {
  if (value > 0 && value < 0.1) return '0.1日未満';
  return '約' + (Math.floor(value * 10) / 10) + '日分';
}
export function initPlanner(root) {
  const fields = root.querySelector('[data-planner-fields]');
  const results = root.querySelector('[data-results]');
  const error = root.querySelector('[data-planner-error]');
  const download = root.querySelector('[data-download]');
  const status = root.querySelector('[data-save-status]');
  const rate = Number(root.dataset.waterRate), bottleSize = Number(root.dataset.bottleSize);
  if (![rate, bottleSize].every(v => Number.isFinite(v) && v > 0)) return;
  const read = () => Object.fromEntries([...fields.querySelectorAll('[name]')].map(el => [el.name, el.value]));
  // Per-field provenance: track which stock fields the user has actually touched.
  const initialValues = Object.fromEntries([...fields.querySelectorAll('[name]')].map(el => [el.name, el.value]));
  const touched = new Set();
  const isUserValue = (name) => {
    if (touched.has(name)) return true;
    const el = fields.querySelector(`[name="${name}"]`);
    return el ? el.value !== initialValues[name] : false;
  };
  const putOrigin = (name) => {
    const el = root.querySelector(`[data-stock-origin="${name}"]`);
    if (el) el.textContent = isUserValue(name) ? '入力値' : '初期例';
  };
  const put = (key, text) => { root.querySelector(`[data-output="${key}"]`).textContent = text; };
  const refresh = () => {
    const r = calculateDays(read(), rate, bottleSize);
    put('waterDays', r.water ? '水 ' + formatDays(r.water.coverage) : '水：未確認');
    put('foodDays', r.food ? '主食 ' + formatDays(r.food.coverage) : '主食：未確認');
    put('required', r.water ? r.water.required + 'L' : '未確認');
    put('shortage', r.water ? r.water.shortage + 'L' : '未確認');
    put('buy', r.water ? r.water.buy + '本' : '未確認');
    put('foodBuy', r.food ? r.food.shortage + '食分' : '未確認');
    root.querySelector('[data-water-status]').textContent = `${r.days || '—'}日分への買い足し`;
    error.textContent = r.errors.join(' '); error.hidden = !r.errors.length;
    results.hidden = false; status.textContent = '';
    return r;
  };
  const update = (e) => {
    if (e && e.target && e.target.name) touched.add(e.target.name);
    refresh();
    putOrigin('litres'); putOrigin('meals');
  };
  fields.addEventListener('input', update); fields.addEventListener('change', update);
  // Confirm button: scroll to results (motion-safe); does not mark fields as touched.
  root.querySelector('[data-calculate]').addEventListener('click', () => {
    refresh(); putOrigin('litres'); putOrigin('meals');
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    results.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  });
  root.querySelectorAll('[data-food-field]').forEach(el => el.addEventListener('input', () => { status.textContent = ''; }));
  // Helper buttons (±): only apply when current value is in the accepted domain and result stays in range.
  const addDelta = (name, delta) => {
    const el = fields.querySelector(`[name="${name}"]`);
    if (!el) return;
    const s = el.value.trim();
    if (name === 'litres') {
      if (!/^\d+(\.\d{1,3})?$/.test(s)) return;
      const cur = Number(s);
      if (cur < 0 || cur > 2000) return;
      const newMl = Math.round(cur * 1000) + Math.round(Number(delta) * 1000);
      if (newMl < 0 || newMl > 2000000) return;
      el.value = String(newMl / 1000);
    } else {
      if (!/^\d+$/.test(s)) return;
      const cur = parseInt(s, 10);
      const [min, max] = name === 'people' ? [1, 12] : [0, 10000];
      if (cur < min || cur > max) return;
      const n = cur + parseInt(delta, 10);
      if (n < min || n > max) return;
      el.value = String(n);
    }
    touched.add(name);
    refresh();
    putOrigin('litres'); putOrigin('meals');
  };
  root.querySelectorAll('[data-adjust]').forEach(btn => {
    btn.addEventListener('click', () => addDelta(btn.dataset.adjust, btn.dataset.delta));
  });
  download.addEventListener('click', () => {
    // Re-evaluate even programmatic changes that did not emit events.
    const r = refresh();
    putOrigin('litres'); putOrigin('meals');
    const waterOrigin = isUserValue('litres') ? '入力値' : '初期例';
    const foodOrigin = isUserValue('meals') ? '入力値' : '初期例';
    const notes = [...root.querySelectorAll('[data-food-field]')].map(el => `${el.dataset.foodField}：\n${el.value.trim() || '未記入'}`).join('\n\n');
    const water = r.water
      ? `水：${formatDays(r.water.coverage)}\n水の数量：${waterOrigin}\n在庫：${r.water.stock}L\n目安の総量：${r.water.required}L\n不足：${r.water.shortage}L\n買い足す${bottleSize}Lボトル：${r.water.buy}本`
      : '水：未確認';
    const food = r.food
      ? `主食：${formatDays(r.food.coverage)}\n主食の数量：${foodOrigin}\n在庫：${r.food.stock}食分\n1人1日：${r.mealsPerDay}食分\n買い足す主食：${r.food.shortage}食分`
      : '主食：未確認';
    const memo = `食品・水の備蓄メモ\n入力値による試算（初期値は計算例。実在庫の確認済み記録ではありません）\n人数：${Number.isInteger(r.people) && r.people > 0 && r.people <= 12 ? r.people : '未確認'}人／目標：${[3,7].includes(r.days) ? r.days : '未確認'}日\n\n${water}\n\n${food}\n\n${notes}\n\n主食1食分＝1人が1回に食べる量。おかず・栄養の充足は別に確認。\n水は1人1日${rate}L。調理に使う分を見積もり、飲む分を残します。生活用水は別に。\n出典：https://www.kantei.go.jp/jp/headline/bousai/sonae.html\n`;
    const url = URL.createObjectURL(new Blob([memo], {type: 'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'stock-shopping-memo.txt';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'テキストファイルを作成しました。端末のダウンロード先を確認してください。';
  });
  fields.disabled = false; download.disabled = false; refresh(); putOrigin('litres'); putOrigin('meals');
}
if (typeof document !== 'undefined') document.querySelectorAll('[data-testid="stock-planner"]').forEach(initPlanner);
