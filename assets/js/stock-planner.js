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
export function initPlanner(root) {
  const fields = root.querySelector('[data-planner-fields]');
  const results = root.querySelector('[data-results]');
  const error = root.querySelector('[data-planner-error]');
  const download = root.querySelector('[data-download]');
  const status = root.querySelector('[data-save-status]');
  const waterStatus = root.querySelector('[data-water-status]');
  const rate = Number(root.dataset.waterRate);
  const bottleSize = Number(root.dataset.bottleSize);
  // Keep all actions disabled if initialization cannot establish the data contract.
  if (![rate, bottleSize].every(value => Number.isFinite(value) && value > 0)) return;
  const readWater = () => Object.fromEntries([...fields.querySelectorAll('[name]')].map(el => [el.name, el.value]));
  let current = null;
  let calculatedInputs = null;
  const invalidate = () => {
    current = null; calculatedInputs = null; results.hidden = true;
    waterStatus.textContent = '水：未確認'; status.textContent = '';
    root.querySelectorAll('[data-output]').forEach(el => el.textContent = '');
  };
  fields.addEventListener('input', () => { invalidate(); error.hidden = true; });
  fields.addEventListener('change', () => { invalidate(); error.hidden = true; });
  root.querySelectorAll('[data-food-field]').forEach(el => el.addEventListener('input', () => { status.textContent = ''; }));
  root.querySelector('[data-calculate]').addEventListener('click', () => {
    invalidate();
    try {
      const inputs = readWater();
      const next = calculateStock(inputs, rate, bottleSize);
      for (const key of ['required', 'shortage', 'buy']) root.querySelector(`[data-output="${key}"]`).textContent = next[key] + (key === 'buy' ? '本' : 'L');
      const stockShare = Math.min(next.stock / next.required, 1) * 100;
      root.querySelector('[data-stock-bar]').style.width = stockShare + '%';
      root.querySelector('[data-shortage-bar]').style.width = (100 - stockShare) + '%';
      root.querySelector('[data-stock-caption]').textContent = `0Lから総量${next.required}Lまでの棒：緑＝手元の水${Math.min(next.stock, next.required)}L、斜線＝不足${next.shortage}L。` + (next.stock > next.required ? `在庫総量は${next.stock}L。目安を超える分は棒に含めていません。` : '');
      current = next; calculatedInputs = JSON.stringify(inputs);
      error.hidden = true; results.hidden = false; waterStatus.textContent = '水：計算済み';
    } catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  download.addEventListener('click', () => {
    // Also catch browser/programmatic changes that did not dispatch input events.
    if (current && calculatedInputs !== JSON.stringify(readWater())) invalidate();
    const notes = [...root.querySelectorAll('[data-food-field]')].map(el => `${el.dataset.foodField}：\n${el.value.trim() || '未記入'}`).join('\n\n');
    const blob = new Blob([buildMemo(current, notes, rate, bottleSize)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'stock-shopping-memo.txt';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'テキストファイルを作成しました。端末のダウンロード先を確認してください。';
  });
  // Enable only after every listener is installed; markup itself cannot submit.
  fields.disabled = false;
  download.disabled = false;
}
if (typeof document !== 'undefined') document.querySelectorAll('[data-testid="stock-planner"]').forEach(initPlanner);
