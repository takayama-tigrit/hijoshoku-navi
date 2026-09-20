"""Actual publish readiness, separate from the draft-isolation fixture.
Local build/approval binding only; not proof of a live deployment or ASP acceptance.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SLUGS = ['emergency-food-for-one', 'rolling-stock-routine', 'emergency-food-storage', 'emergency-water-bottles', 'emergency-food-snacks']
DISCLOSURE = 'Amazonのアソシエイトとして、当メディアは適格販売により収入を得ています。'
EXPECTED = {'/guide/', '/ranking/', '/posts/alpha-mai-osusume/', '/posts/emergency-food-set-check/', '/posts/emergency-food-side-dishes/'} | {'/posts/' + x + '/' for x in SLUGS}
failures = []
checks = []
def check(condition, label):
    (checks if condition else failures).append(label)

record_file = ROOT / 'docs/reviews/content-05-human-proofreading.json'
record = json.loads(record_file.read_text()) if record_file.exists() else {}
check(record.get('version') == 'CONTENT-05-V2' and record.get('result') == 'confirmed_no_changes', 'actual operator confirmation is recorded for V2')
check(record.get('packet_sha256') == 'd627f49e1d9973e56159b9a7af37ea8a8396804f7baea9d25ffe3e43bc65fab2', 'confirmed packet identity')
check(set(record.get('source_sha256', {})) == set(SLUGS), 'confirmation covers exactly the five drafts')
for slug in SLUGS:
    raw = (ROOT / 'content/posts' / (slug + '.md')).read_bytes()
    check(len(re.findall(rb'^draft: false$', raw, re.M)) == 1, slug + ': explicitly published')
    original = re.sub(rb'^draft: false$', b'draft: true', raw, flags=re.M)
    check(hashlib.sha256(original).hexdigest() == record.get('source_sha256', {}).get(slug), slug + ': text equals the human-confirmed source except draft flag')

with tempfile.TemporaryDirectory(prefix='hijoshoku-amazon-readiness-') as temp:
    out = Path(temp) / 'public'
    subprocess.run([os.environ.get('HUGO_BIN', 'hugo'), '--environment', 'production', '--minify', '--destination', str(out), '--panicOnWarning'], cwd=ROOT, check=True)
    home = (out / 'index.html').read_text()
    sitemap = ET.fromstring((out / 'sitemap.xml').read_text())
    locations = {x.text for x in sitemap.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')}
    for route in sorted(EXPECTED):
        target = out / route.lstrip('/') / 'index.html'
        check(target.is_file(), route + ': actual normal build page exists')
        check(route in home, route + ': home links to article')
        check('https://hijoshoku-navi.com' + route in locations, route + ': sitemap contains article')
        if target.exists():
            body = target.read_text()
            check('参考にした情報' in body, route + ': references present')
            check(not re.search(r'<meta[^>]+name=[\"\x27]?robots[^>]+noindex', body, re.I), route + ': not noindex')
    about = (out / 'about/index.html').read_text()
    check(DISCLOSURE in about, 'Amazon relationship disclosure is published before application')
    check('提携申請に先立ち' in about and '承認前はAmazonの広告リンクを掲載しません' in about, 'pre-approval relationship is not represented as an approved or earning state')

print(json.dumps({'status': 'FAIL' if failures else 'PASS', 'checks': len(checks), 'failures': failures, 'expected_editorial_articles': len(EXPECTED)}, ensure_ascii=False, indent=2))
raise SystemExit(1 if failures else 0)
