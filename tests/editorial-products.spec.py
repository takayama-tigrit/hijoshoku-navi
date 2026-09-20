#!/usr/bin/env python3
"""Exercise revision-only product groups and prose without publishing drafts."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='editorial-products-') as tmp:
    tmp = Path(tmp)
    for folder in ['content', 'data', 'docs', 'layouts', 'assets', 'static', 'themes']:
        shutil.copytree(ROOT / folder, tmp / folder)
    shutil.copy2(ROOT / 'hugo.toml', tmp / 'hugo.toml')
    env = dict(os.environ, CF_PAGES_BRANCH='main')
    out = tmp / 'built'
    subprocess.run([os.environ.get('HUGO_BIN', 'hugo'), '--source', str(tmp), '--environment', 'production',
                    '--destination', str(out), '--panicOnWarning'], check=True, env=env, stdout=subprocess.DEVNULL)
    for route, product in [('guide', '尾西 白飯 100g'), ('posts/emergency-food-snacks', '井村屋 えいようかん')]:
        html = (out / route / 'index.html').read_text()
        assert f'data-product-key="{product}"' in html, 'exact approved product missing'
        assert html.count('data-testid="affiliate-disclosure"') == 1, 'one disclosure per page'
        assert '写真は楽天市場の掲載商品です。' not in html, 'old audit prose still rendered in revision'
        assert '入数・送料・届く時点の賞味期限を確認してから注文してください。' not in html, 'duplicated generic footer must stay out of revision'
        assert '商品写真と内容量' in html, 'single product is not a multi-product comparison'
    old = (out / 'ranking/index.html').read_text()
    assert '写真は楽天市場の掲載商品です。' not in old, 'confirmed ranking keeps reviewed copy'
    out2 = tmp / 'preview'
    env['CF_PAGES_BRANCH'] = 'unapproved-preview'
    subprocess.run([os.environ.get('HUGO_BIN', 'hugo'), '--source', str(tmp), '--environment', 'production',
                    '--destination', str(out2), '--panicOnWarning'], check=True, env=env, stdout=subprocess.DEVNULL)
    for route in ['guide', 'posts/emergency-food-snacks']:
        html = (out2 / route / 'index.html').read_text()
        assert 'thumbnail.image.rakuten.co.jp' not in html, 'preview leaked affiliate images'
        assert 'data-testid="affiliate-disclosure"' not in html, 'preview disclosed absent advertising'
        assert 'onisifoods.co.jp' in html or 'imuraya.co.jp' in html, 'official reference lost'
print('PASS confirmed product images, specific copy, disclosure, preview guards, current published targets')
