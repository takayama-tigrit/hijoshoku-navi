"""Exact, additive CONTENT-12 approval. Does not replace the ten-article approval."""
import hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RECORD_PIN='eb36a4ef6c1e4f6bb3f4f64dd71c66f5416b4e147a59b2cde500d6bce4c412b1'
PACKET_PIN='5422b6bcb26d9efef8f8fab9e3bb55921d550544638953a1c8b12721988d1a4f'
KEYS={'pack_rice_12','food_to_go_12'}
def digest(raw): return hashlib.sha256(raw).hexdigest()
def verify(root=ROOT):
    if not __debug__:
        raise RuntimeError('approval verification requires assertions enabled')
    raw=(root/'docs/reviews/content-12-human-proofreading.json').read_bytes()
    record=json.loads(raw)
    assert record.get('version')=='CONTENT-12-V2' and record.get('result')=='confirmed_no_changes' and record.get('reviewer')=='site_operator' and record.get('user_quote')=='2記事とも校正・事実確認済み。公開して', 'actual content12 confirmation'
    assert record.get('packet_sha256')==PACKET_PIN, 'content12 packet identity'
    assert digest(raw)==RECORD_PIN, 'content12 record pin'
    assert digest((root/record['packet']).read_bytes())==PACKET_PIN, 'content12 packet bytes'
    for p,h in record['frozen_dependencies'].items():
        assert digest((root/p).read_bytes())==h, 'content12 frozen dependency'
    for p,h in record['publication_dependencies'].items():
        assert digest((root/p).read_bytes())==h, 'content12 publication dependency'
    registry=json.loads((root/'data/article-evidence.json').read_text())['articles']
    extra=json.loads((root/'docs/drafts/content-12/article-evidence-additions.json').read_text())['articles']
    assert set(extra)==KEYS and len(record['articles'])==2 and {a['key'] for a in record['articles']}==KEYS, 'content12 exact coverage'
    for a in record['articles']:
        draft=(root/a['snapshot']).read_bytes();public=(root/a['target']).read_bytes()
        assert digest(draft)==a['draft_sha256'] and draft.count(b'\ndraft: true\n')==1, 'content12 draft identity'
        assert public==draft.replace(b'\ndraft: true\n',b'\ndraft: false\n') and digest(public)==a['published_sha256'], 'content12 published bytes'
        assert registry[a['key']]==extra[a['key']] and registry[a['key']]['file']==a['target'], 'content12 evidence binding'
    print('PASS CONTENT-12-V2: exact operator approval, packet, two unchanged articles and additive evidence')
if __name__=='__main__': verify()
