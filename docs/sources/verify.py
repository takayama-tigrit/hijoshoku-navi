#!/usr/bin/env python3
"""Offline checks for retained evidence and every registered editorial article."""
if not __debug__:
    raise RuntimeError('evidence verification does not support Python optimization')

import hashlib
import json
from pathlib import Path
import re
from decimal import Decimal
from datetime import date, datetime, timezone

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ARTICLES = [ROOT / p for p in (
    "content/ranking/index.md", "content/guide/index.md",
    "content/posts/alpha-mai-osusume.md",
)]
ledger = json.loads((HERE / "ledger.json").read_text())
records = json.loads((HERE / "retrieval.json").read_text())
registry = json.loads((ROOT / 'data/article-evidence.json').read_text())['articles']
# CONTENT-14 is a separately confirmed dataset: never mutate historical pins.
extra_path = ROOT / 'data/article-evidence-content14.json'
extra_dir = HERE / 'content14'
assert extra_path.exists() == extra_dir.exists(), 'content14 incomplete dataset'
if extra_path.exists():
    extra = json.loads(extra_path.read_text())['articles']
    targets = {'canned_food_14': 'content/posts/emergency-canned-food.md',
               'shopping_list_14': 'content/posts/supermarket-emergency-food-list.md'}
    assert set(extra) == set(targets), 'content14 exact article coverage'
    assert not set(extra) & set(registry), 'content14 article key collision'
    for key, target in targets.items():
        assert extra[key]['file'] == target, 'content14 exact destination'

    extra_sources = json.loads((extra_dir / 'ledger.json').read_text())
    extra_records = json.loads((extra_dir / 'retrieval.json').read_text())
    ids = [s['id'] for s in extra_sources]
    assert all(type(i) is int and i > 0 for i in ids), 'content14 invalid source ID'
    assert len(ids) == len(set(ids)) and not set(ids) & {s['id'] for s in ledger['sources']}, 'content14 source ID collision'
    retrieval_ids = [r['id'] for r in extra_records]
    assert len(retrieval_ids) == len(set(retrieval_ids)) and set(retrieval_ids) == set(ids), 'content14 retrieval IDs'
    assert not set(retrieval_ids) & {r['id'] for r in records}, 'content14 retrieval ID collision'
    for record in extra_records:
        assert record['excerpt'] == f"excerpts/{record['id']}.txt", 'content14 exact excerpt path'
        record['excerpt'] = 'content14/' + record['excerpt']
    registry.update(extra)
    ledger['sources'].extend(extra_sources)
    records.extend(extra_records)
import sys
sys.path.insert(0, str(ROOT / 'scripts'))
from content14_confirmation import verify as verify_content14
from editorial_confirmation import verify as verify_editorial
verify_content14(ROOT)
verify_editorial(ROOT)

def load_seo_evidence(root, previous_registry, previous_ledger, previous_records):
    """Replace exactly five active bindings; never rewrite a historical registry."""
    if not __debug__:
        raise RuntimeError('evidence verification does not support Python optimization')
    from seo_demand_confirmation import TARGETS
    directory = root / 'docs/sources/seo-demand01'
    extra = json.loads((root / 'data/article-evidence-seo-demand01.json').read_bytes())['articles']
    assert {key: a['file'] for key, a in extra.items()} == TARGETS, 'seo exact evidence coverage'
    assert not set(extra) & set(previous_registry), 'seo article key collision'
    replaced = {key.removesuffix('_seo01'): target for key, target in TARGETS.items()}
    assert all(previous_registry[key]['file'] == target for key, target in replaced.items()), 'seo predecessor evidence binding'
    assert {key for key, a in previous_registry.items() if a['file'] in TARGETS.values()} == set(replaced), 'seo exact replaced bindings'
    extra_sources = json.loads((directory / 'ledger.json').read_bytes())
    ids = [s['id'] for s in extra_sources]
    assert all(type(i) is int for i in ids), 'seo invalid source ID'
    assert len(ids) == len(set(ids)) and not set(ids) & {s['id'] for s in previous_ledger['sources']}, 'seo source ID collision'
    assert set(ids) == set(range(42, 49)), 'seo exact source coverage'
    extra_records = json.loads((directory / 'retrieval.json').read_bytes())
    retrieval_ids = [r['id'] for r in extra_records]
    assert all(type(i) is int for i in retrieval_ids), 'seo invalid retrieval ID'
    assert len(retrieval_ids) == len(set(retrieval_ids)) and not set(retrieval_ids) & {r['id'] for r in previous_records}, 'seo retrieval ID collision'
    assert set(retrieval_ids) == set(ids), 'seo retrieval coverage'
    assert {p.name for p in (directory / 'excerpts').iterdir()} == {f'{i}.txt' for i in ids}, 'seo excerpt coverage'
    by_id = {s['id']: s for s in extra_sources}
    for record in extra_records:
        assert record['excerpt'] == f"excerpts/{record['id']}.txt", 'seo exact excerpt path'
        raw = (directory / record['excerpt']).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == record['excerpt_sha256'], 'seo excerpt hash'
        assert type(record['status']) is int and record['status'] == 200, 'seo retrieval status'
        checked = datetime.fromisoformat(record['checked_at'].replace('Z', '+00:00'))
        assert checked.tzinfo and checked <= datetime.now(timezone.utc), 'seo invalid or future evidence date'
        source = by_id[record['id']]
        assert date.fromisoformat(source['accessed']) == checked.date(), 'seo display/retrieval date mismatch'
        assert source['url'] == record['url'].rstrip('/'), 'seo retrieval URL'
        assert re.fullmatch(r'[0-9a-f]{64}', record['response_sha256']), 'seo response hash identity'
        assert source.get('quotes'), 'seo quote coverage'
        for quote in source['quotes']:
            assert quote['text'] and quote['text'] in raw.decode(), 'seo quote mismatch'
            assert date.fromisoformat(quote['added']) == checked.date(), 'seo quote date'
        record['excerpt'] = 'seo-demand01/' + record['excerpt']
    active = {key: value for key, value in previous_registry.items() if key not in replaced}
    active.update(extra)
    return active, {**previous_ledger, 'sources': previous_ledger['sources'] + extra_sources}, previous_records + extra_records


def verify_food_choices(root, article_registry, source_map):
    """Bind every card proposition and its provenance to the article reference list."""
    if not __debug__:
        raise RuntimeError('evidence verification does not support Python optimization')
    data = json.loads((root / 'data/food-choices.json').read_bytes())
    entries = data['entries']
    expected = {'rice', 'bread', 'sides', 'cans', 'snacks', 'sets'}
    assert data['version'] == 1 and len(entries) == 6 and {e['id'] for e in entries} == expected, 'seo UI exact card coverage'
    ranking = article_registry['ranking_editorial11_seo01']
    claims = ranking.get('ui_claims', [])
    assert len(claims) == 6 and {c['id'] for c in claims} == expected, 'seo UI exact claim coverage'
    assert {key for key, a in article_registry.items() if a.get('ui_claims')} == {'ranking_editorial11_seo01'}, 'seo UI article coverage'
    assert (root / ranking['file']).read_text().count('{{< food-choices >}}') == 1, 'seo UI article binding'
    cards = {e['id']: e for e in entries}
    mapped = set()
    for claim in claims:
        assert claim['dataset'] == 'data/food-choices.json', 'seo UI dataset'
        card = cards[claim['id']]
        assert claim['text'] == card['condition'], 'seo UI claim text'
        ids = claim['source_ids']
        assert (ids and all(type(i) is int for i in ids)
                and len(ids) == len(set(ids)) and len(card['source_ids']) == len(set(card['source_ids']))
                and set(ids) == set(card['source_ids'])), 'seo UI claim sources'
        assert set(ids) <= set(ranking['source_ids']) & set(source_map), 'seo UI reference coverage'
        mapped.update(ids)
    return {'ranking_editorial11_seo01': mapped}


legacy_registry, legacy_ledger, legacy_records = registry, ledger, records
registry, ledger, records = load_seo_evidence(ROOT, registry, ledger, records)

registered_paths = {ROOT / a['file'] for a in registry.values()}
assert len(registered_paths) == len(registry), 'duplicate article file'
assert set(ARTICLES) <= registered_paths, 'baseline article missing'
ARTICLES += sorted(registered_paths - set(ARTICLES))
discovered_paths = {p for p in (ROOT / 'content').rglob('*.md')
                    if re.search(r'^evidenceKey:', p.read_text(), re.M)}
assert discovered_paths == {p for p in registered_paths if p.is_relative_to(ROOT / 'content')}, 'unregistered or missing evidence article'
# Section indexes and these exact utility pages are not editorial articles.
utility_pages = {ROOT / p for p in ('content/about/index.md', 'content/privacy/index.md',
                                  'content/photo-credits/index.md')}
editorial_paths = {p for p in (ROOT / 'content').rglob('*.md')
                   if p.name != '_index.md' and p not in utility_pages}
assert editorial_paths <= registered_paths, 'editorial article missing evidenceKey or registry entry'
sources = {s["id"]: s for s in ledger["sources"]}
assert len(sources) == len(ledger['sources']) == len(records)
assert set(range(1, 13)) <= sources.keys(), 'baseline evidence missing'
assert {r['id'] for r in records} == sources.keys(), 'retrieval identity mismatch'
records_by_id = {r['id']: r for r in records}
all_cited = set()
ui_mapped = verify_food_choices(ROOT, registry, sources)
for record in records:
    raw = (HERE / record["excerpt"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == record["excerpt_sha256"]
    assert record["status"] == 200
    checked = datetime.fromisoformat(record['checked_at'].replace('Z', '+00:00'))
    assert checked.tzinfo and checked <= datetime.now(timezone.utc), 'invalid or future evidence date'
    source = sources[record["id"]]
    # accessed uses the calendar date in the recorded retrieval timestamp's offset.
    assert date.fromisoformat(source['accessed']) == checked.date(), 'display/retrieval date mismatch'
    assert source["url"] == record["url"].rstrip("/")
    assert source.get("quotes"), source["id"]
    for quote in source["quotes"]:
        assert quote["text"] in raw.decode(), (source["id"], "quote mismatch")

def semantic_text(text):
    # Formatting-only shortcodes retain the exact claim; JSON decoding is not evaluation.
    text = re.sub(r'\{\{<\s*mark\s+("(?:[^"\\]|\\.)*")\s*>\}\}', lambda m: json.loads(m.group(1)), text)
    return re.sub(r'\*\*(.*?)\*\*', r'\1', text)


for path in ARTICLES:
    text = semantic_text(path.read_text())
    lastmod = re.search(r'^lastmod: (\d{4}-\d{2}-\d{2})T', text, re.M)

    key = re.search(r'^evidenceKey: (\w+)$', text, re.M)
    assert key, (path, 'explicit article evidence key required')
    evidence = registry[key.group(1)]
    assert evidence['file'] == str(path.relative_to(ROOT))
    body = text
    assert '## Sources' not in text and not re.search(r'\[\d+\]', text), 'Reader copy must not carry audit numbering'
    cited = set(evidence['source_ids'])
    assert len(cited) == len(evidence['source_ids'])
    assert cited <= sources.keys()
    assert lastmod and lastmod.group(1) >= max(records_by_id[i]['checked_at'][:10] for i in cited), 'Article revision predates its evidence'
    mapped = set(ui_mapped.get(key.group(1), ()))
    for claim in evidence['claims']:
        assert semantic_text(claim['text']) in text, (path, 'stale claim mapping', claim['text'])
        assert claim['source_ids'] and set(claim['source_ids']) <= cited
        mapped.update(claim['source_ids'])
    assert mapped == cited, (path, 'missing claim provenance')
    # Every numeric table row must remain explicitly traceable, including derived totals.
    for line in text.splitlines():
        if line.startswith('| ') and re.search(r'\d', line) and not any(h in line for h in ['熱量（', '3日分の', '| 人数 |', '| 家族の人数 |', '今回の3品']):
            assert any(c['text'] == line for c in evidence['claims']), (path, 'unmapped numeric table row', line)
    assert "要確認" not in body
    assert not re.search(r"第\d+位|TOP\d|おすすめ10選|佐竹食品|72L", body)
    assert "## 関連記事" in body
    assert "|---" in body or '<div data-testid="primary-checklist">' in body
    # The same purchase condition may be written in plain Japanese; do not force jargon.
    assert "残存賞味期限" in body or "届く時点で賞味期限がどれだけ残っているか" in body
    assert "主菜" in body and "副菜" in body
    assert "アレルギー" in body
    if "amazon.co.jp" in body:
        amazon_links = re.findall(r"\[([^\]]+)\]\((https://www\.amazon\.co\.jp/[^)]+)\)", body)
        assert amazon_links and all("Amazonで" in label and "検索" in label for label, url in amazon_links)
        assert not re.search(r"amazon\.co\.jp[^\s)]*[?&]tag=", body)
    all_cited |= cited
    print(f"PASS {path.relative_to(ROOT)}: {len(cited)} evidence-backed sources")
assert all_cited == sources.keys(), "unused source in registered articles"

# Verify published numeric tables, not only standalone multiplication.
guide = ARTICLES[1].read_text()
for people in (1, 2, 4):
    d3, d7 = 3 * people * 3, 3 * people * 7
    assert f"| {people}人 | {d3}L | {d7}L | {d3}回 | {d7}回 |" in guide
ranking = ARTICLES[0].read_text()
for people in (1, 4):
    assert f"| {people}人 | {3 * people * 3}L | {3 * people * 7}L |" in ranking
assert 3 * 4 * 3 == 36
assert "1,098kcal" in guide and 366 * 3 == 1098
alpha = ARTICLES[2].read_text()
for bags in (9, 36):
    water_l = Decimal(160) * bags / 1000
    assert f"{water_l}L" in alpha
for i, product, energy, protein, salt in (
    (1, "白飯", "366", "6.3", "0.01"),
    (7, "五目ごはん", "377", "6.9", "1.8"),
    (8, "わかめごはん", "361", "6.6", "1.7"),
):
    excerpt = (HERE / f"excerpts/{i:02d}.txt").read_text()
    assert f"熱量\n{energy}kcal" in excerpt
    assert f"たんぱく質\n{protein}g" in excerpt
    assert f"食塩相当量\n{salt}g" in excerpt
    assert "100g/260g（必要水量160ml）" in excerpt
    assert f"| 100g尾西の{product} | 100g／260g | 160mL | {energy}kcal | {protein}g | {salt}g |" in alpha
set_article = (ROOT / registry['set_check']['file']).read_text()
assert Decimal(500) * 6 / 1000 == 3
assert Decimal(12) / 2 / 3 == 2
assert '500mL×6本＝3L' in set_article and '12袋 ÷ 2人 ÷ 3回 ＝ 主食2日分' in set_article
assert '1人3日分の目安9L' in set_article
print("PASS arithmetic, source hashes, quotes, source blocks, key product tables, article invariants")
print("NOTE: structural checks do not replace human review of claim support or a live site build.")
