import assert from 'node:assert/strict';

export async function checkVisualAction(page, route, width) {
  const minimumPhotos = { '/': 3, '/guide/': 4, '/ranking/': 3, '/posts/alpha-mai-osusume/': 3 };
  if (minimumPhotos[route]) {
    const photos = page.locator('img[src*="/images/photos/"]');
    assert(await photos.count() >= minimumPhotos[route], `Photo-led coverage missing: ${route}`);
    const sources = await photos.evaluateAll(imgs => [...new Set(imgs.map(i => i.getAttribute('src')))]);
    assert(sources.length >= 3, `Do not pad with the same photograph: ${route}`);
    assert(await page.locator('[data-testid="next-action"]').count() >= 1, `Missing concrete next action: ${route}`);
  }
  const minimumCharts = { '/guide/': 3, '/ranking/': 3, '/posts/alpha-mai-osusume/': 4 };
  if (minimumCharts[route]) {
    assert(await page.locator('figure[data-viz]').count() >= minimumCharts[route], `Quantity must be explained visually: ${route}`);
    for (const figure of await page.locator('figure[data-viz]').all()) {
      assert(await figure.locator('figcaption').count() > 0, 'Charts need context and accessible text');
      const bad = await figure.evaluate(el => [...el.querySelectorAll('span,small,strong,p')].filter(x => x.textContent.trim() && x.getBoundingClientRect().height && parseFloat(getComputedStyle(x).fontSize) < 12).length);
      assert.equal(bad, 0, `Chart labels too small: ${route} width=${width}`);
    }
  }
  if (['/', '/guide/'].includes(route)) {
    const planner = page.locator('[data-testid="stock-planner"]');
    assert.equal(await planner.count(), 1);
    await planner.locator('[name="people"]').fill('4');
    await planner.locator('[name="days"]').selectOption('7');
    await planner.locator('[name="bottles"]').fill('10');
    await planner.locator('[data-calculate]').click();
    assert.match(await planner.locator('[data-output="required"]').innerText(), /84\s*L/);
    assert.match(await planner.locator('[data-output="shortage"]').innerText(), /64\s*L/);
    assert.match(await planner.locator('[data-output="buy"]').innerText(), /32\s*本/);
    assert.match(await planner.locator('[data-stock-caption]').innerText(), /無地＝手元の水20L、斜線＝不足64L/);
    assert.doesNotMatch(await planner.locator('[data-stock-caption]').innerText(), /緑＝|青＝/);
    await planner.locator('[name="people"]').fill('2');
    await planner.locator('[name="days"]').selectOption('3');
    await planner.locator('[name="bottles"]').fill('3');
    await planner.locator('[data-calculate]').click();
    assert.match(await planner.locator('[data-output="required"]').innerText(), /18\s*L/);
    assert.match(await planner.locator('[data-output="shortage"]').innerText(), /12\s*L/);
    assert.match(await planner.locator('[data-output="buy"]').innerText(), /6\s*本/);
    await planner.locator('[name="foodNotes"]').fill('主菜の缶詰を家で確認する');
    const downloadPromise = page.waitForEvent('download');
    await planner.locator('[data-download]').click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const memo = Buffer.concat(chunks).toString('utf8');
    assert.match(memo, /12\s*L/);
    assert.match(memo, /6\s*本/);
    assert(memo.includes('主菜の缶詰を家で確認する'), 'The shopping memo retains the reader’s next action');
    await planner.locator('[name="bottles"]').fill('100');
    await planner.locator('[data-calculate]').click();
    assert.match(await planner.locator('[data-output="shortage"]').innerText(), /^0\s*L/);
    assert.match(await planner.locator('[data-output="buy"]').innerText(), /^0\s*本/);
    await planner.locator('[name="people"]').fill('0');
    await planner.locator('[data-calculate]').click();
    assert(await planner.locator('[data-planner-error]').isVisible(), 'Invalid values must not produce a recommendation');
    await planner.locator('[name="people"]').fill('2');
    await planner.locator('[name="days"]').selectOption('3');
    await planner.locator('[name="bottles"]').fill('0');
    await planner.locator('[data-calculate]').click();
  }
}
