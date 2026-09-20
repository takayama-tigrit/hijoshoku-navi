"""Bind current publication to the operator-confirmed frozen V2, not general consent."""
import hashlib, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def digest(raw): return hashlib.sha256(raw).hexdigest()
def verify(root=ROOT):
    raw = (root/'docs/reviews/editorial-11-human-proofreading.json').read_bytes()
    record = json.loads(raw)
    assert record.get('version') == 'EDITORIAL-11-V2' and record.get('result') == 'confirmed_no_changes' and record.get('reviewer') == 'site_operator' and record.get('user_quote') == 'EDITORIAL-11-V2を校正・事実確認済み', 'actual operator confirmation'
    assert record.get('packet_sha256') == 'b21bdc2eb5ba446aa303d29a60a274743eaa62565dfa2a6822e1ef41b0b6473e', 'confirmed packet identity'
    frozen_raw = (root/'docs/reviews/editorial-11/manifest-frozen-v2.json').read_bytes()
    assert digest(frozen_raw) == '5bb4787f49601a703e7b0183e880bcd658813883c73be133f88326926db54a93', 'frozen manifest identity'
    frozen = json.loads(frozen_raw)['articles']
    assert len(record['articles']) == len(frozen) == 10 and {a['target'] for a in record['articles']} == {a['target'] for a in frozen}, 'exact confirmation coverage'
    registry = json.loads((root/'data/article-evidence.json').read_text())['articles']
    for a, f in zip(record['articles'], frozen):
        assert all(a[k] == f[k] for k in f), 'confirmed source identity'
        source = (root/a['snapshot']).read_bytes()
        assert digest(source) == f['draft_sha256'], 'confirmed source snapshot'
        assert source.count(b'\ndraft: true\n') == 1, 'source draft flag'
        published = (root/a['target']).read_bytes()
        assert published == source.replace(b'\ndraft: true\n', b'\ndraft: false\n'), 'published text equals confirmed source except draft flag'
        assert digest(published) == a['published_sha256'], 'published bytes match record'
        assert digest((root/a['previous']).read_bytes()) == f['baseline_sha256'], 'previous published history'
        assert registry[a['key']]['file'] == a['target'], 'current evidence file binding'
    for rel, expected in record['dependencies'].items():
        assert digest((root/rel).read_bytes()) == expected, 'confirmed dependency identity'
    assert digest(raw) == '08e88eb063cbce5e9495b620618735b6f3868b6daf3c7ff63f384e3317881c88', 'confirmation record pin'
    print('PASS EDITORIAL-11-V2: 10 exact published source hashes, frozen snapshots, dependency and operator pins')
if __name__ == '__main__': verify()
