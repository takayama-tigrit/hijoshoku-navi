#!/usr/bin/env python3
"""Offline checks for retained evidence and the three editorial articles."""
import hashlib
import json
from pathlib import Path
import re
from decimal import Decimal

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ARTICLES = [ROOT / p for p in (
    "content/ranking/index.md", "content/guide/index.md",
    "content/posts/alpha-mai-osusume.md",
)]
ledger = json.loads((HERE / "ledger.json").read_text())
records = json.loads((HERE / "retrieval.json").read_text())
sources = {s["id"]: s for s in ledger["sources"]}
assert len(sources) == len(records) == 12
all_cited = set()
for record in records:
    raw = (HERE / record["excerpt"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == record["excerpt_sha256"]
    assert record["status"] == 200
    assert record["checked_at"].startswith("2026-09-18")
    source = sources[record["id"]]
    assert source["url"] == record["url"].rstrip("/")
    assert source.get("quotes"), source["id"]
    for quote in source["quotes"]:
        assert quote["text"] in raw.decode(), (source["id"], "quote mismatch")

for path in ARTICLES:
    text = path.read_text()
    assert 'lastmod: 2026-09-18T00:00:00+09:00' in text
    assert text.count("## Sources") == 1
    body, footer = text.split("## Sources")
    cited = {int(x) for x in re.findall(r"\[(\d+)\](?![(:])", body)}
    listed = {int(i): u for i, u in re.findall(r"^\[(\d+)\] (https?://\S+)", footer, re.M)}
    assert cited == listed.keys(), path
    for i, url in listed.items():
        assert url == sources[i]["url"], (path, i)
    assert "要確認" not in body
    assert not re.search(r"第\d+位|TOP\d|おすすめ10選|佐竹食品|72L", body)
    assert "## 関連記事" in body
    assert "|---" in body
    assert "残存賞味期限" in body
    assert "主菜" in body and "副菜" in body
    assert "アレルギー" in body
    if "amazon.co.jp" in body:
        assert "通常の検索リンク" in body
        assert not re.search(r"amazon\.co\.jp[^\s)]*[?&]tag=", body)
    all_cited |= cited
    print(f"PASS {path.relative_to(ROOT)}: {len(cited)} evidence-backed sources")
assert all_cited == sources.keys(), "unused source in all three articles"

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
    assert f"| 100g尾西の{product}[{i}] | 100g／260g | 160mL | {energy}kcal | {protein}g | {salt}g |" in alpha
print("PASS arithmetic, source hashes, quotes, source blocks, key product tables, article invariants")
print("NOTE: structural checks do not replace human review of claim support or a live site build.")
