"""Additive CONTENT-14 publication binding; original proofreading artifacts stay private.

The pinned portable manifest binds the operator's exact confirmation, private
presentation identities and every reviewed input used by these two articles.
It is not a remote authorization system: changing this code or its pins requires
independent review, just like the earlier editorial/content12 gates.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD_PIN = '991f7e34cdddd63522bd10c7b155a250668307b23689882a9741edf1ddec6ae7'
PACKET_PIN = 'f6abeda254c4de7499c6b8053b29e02a71db4b524f48606318e149f33930f3e9'
TARGETS = {
    'canned_food_14': 'content/posts/emergency-canned-food.md',
    'shopping_list_14': 'content/posts/supermarket-emergency-food-list.md',
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def verify(root=ROOT):
    if not __debug__:
        raise RuntimeError('approval verification requires assertions enabled')
    raw = (root / 'docs/reviews/content-14-visual-human-confirmation.json').read_bytes()
    record = json.loads(raw)
    assert (record.get('version') == 'CONTENT-14-VISUAL-V3'
            and record.get('reviewer') == 'site_operator'
            and record.get('result') == 'confirmed_no_changes'
            and record.get('user_quote') == '追加分も校正・事実確認OK'
            and record.get('publication_approval') == 'GRANTED_FOR_THESE_TWO_ARTICLES_WITH_IMAGE_ENHANCEMENT'), 'actual content14 confirmation'
    assert record.get('packet_sha256') == PACKET_PIN, 'content14 packet identity'
    assert digest(raw) == RECORD_PIN, 'content14 record pin'
    assert len(record['articles']) == 2 and {a['key']: a['target'] for a in record['articles']} == TARGETS, 'content14 exact coverage'
    for article in record['articles']:
        public = (root / article['target']).read_bytes()
        assert public.count(b'\ndraft: false\n') == 1 and digest(public) == article['published_sha256'], 'content14 published bytes'
        draft = public.replace(b'\ndraft: false\n', b'\ndraft: true\n', 1)
        assert digest(draft) == article['draft_sha256'], 'content14 draft identity'
    from seo_demand_confirmation import SHARED_CONTENT14, verify as verify_seo
    for rel, expected in record['reviewed_dependencies'].items():
        if rel not in SHARED_CONTENT14:
            assert digest((root / rel).read_bytes()) == expected, 'content14 reviewed dependency: ' + rel
    verify_seo(root)
    assert digest((root / 'docs/image-licenses-content14.json').read_bytes()) == record['rights_ledger_sha256'], 'content14 rights ledger'
    registry = json.loads((root / 'data/article-evidence-content14.json').read_text())['articles']
    assert {key: value['file'] for key, value in registry.items()} == TARGETS, 'content14 evidence binding'
    return record


if __name__ == '__main__':
    verify()
    print('PASS CONTENT-14-VISUAL-V3: operator confirmation, unchanged published text and reviewed dependencies')
