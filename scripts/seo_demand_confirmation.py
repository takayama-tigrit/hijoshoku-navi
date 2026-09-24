"""Portable, immutable SEO-DEMAND-01 publication receipt; no legacy gate calls.

This is a leaf: editorial/content14 call it, never the reverse. Private review
packet identities are pinned by the receipt, not represented as portable files.
"""
if not __debug__:
    raise RuntimeError('approval verification requires assertions enabled')
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
RECORD = 'docs/reviews/seo-demand-01-publication.json'
RECORD_PIN = '95a789a689a829c5c81219c2f467446b8b15d074c76a25dd4abb2720586c29d3'
PACKET_PIN = '7a10facda64347b4c4d6c9f31abfffdd0cbe1d7fa894776f795661f24cf25bab'
HUMAN_PIN = 'c8a3d042d5f0407fdc5a8a2cf2adda69d20610432d129bc1a8d1309e0cf7b1bb'
LEGACY_PIN = '08e88eb063cbce5e9495b620618735b6f3868b6daf3c7ff63f384e3317881c88'
TARGETS = {
    'ranking_editorial11_seo01': 'content/ranking/index.md',
    'alpha_editorial11_seo01': 'content/posts/alpha-mai-osusume.md',
    'guide_editorial11_seo01': 'content/guide/index.md',
    'side_dishes_editorial11_seo01': 'content/posts/emergency-food-side-dishes.md',
    'storage_editorial11_seo01': 'content/posts/emergency-food-storage.md',
}
OVERLAY = 'docs/drafts/seo-demand-01/overlay/'
# Only these two CONTENT-14 dependencies are reauthorized, not its text or data.
SHARED_CONTENT14 = {'layouts/_partials/article-references.html', 'layouts/single.html'}
COMMON = {
    'assets/css/food-choices.css', 'data/food-choices.json', 'data/related-articles.json',
    'layouts/_partials/article-references.html', 'layouts/_partials/related-stories.html',
    'layouts/shortcodes/food-choices.html', 'layouts/single.html',
}
SOURCE_FILES = {'ledger.json', 'retrieval.json'} | {f'excerpts/{i}.txt' for i in range(42, 49)}
REVIEWED = ({OVERLAY + p for p in COMMON | set(TARGETS.values())}
            | {'docs/drafts/seo-demand-01/sources/' + p for p in SOURCE_FILES}
            | {'docs/drafts/seo-demand-01/article-evidence-additions.json'})
PUBLICATION = (COMMON | {'docs/sources/seo-demand01/' + p for p in SOURCE_FILES}
               | {'data/article-evidence-seo-demand01.json'})


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read(root, rel, reason):
    try:
        return (root / rel).read_bytes()
    except FileNotFoundError:
        raise AssertionError(reason + ': ' + rel) from None


def verify(root=ROOT):
    if not __debug__:
        raise RuntimeError('approval verification requires assertions enabled')
    raw = read(root, RECORD, 'seo missing receipt')
    record = json.loads(raw)
    assert (record.get('version') == 'SEO-DEMAND-01-PUBLICATION-V1'
            and record.get('reviewer') == 'site_operator'
            and record.get('result') == 'confirmed_no_changes'
            and record.get('user_quote') == '今回のSEO改稿分も校正・事実確認OK'
            and record.get('publication_approval') == 'GRANTED_FOR_FIVE_REVISIONS_AND_FOURTEEN_RELATED_BLOCKS'
            and record.get('publication_user_quote') == '本番反映と公開後の検証まで進める'), 'actual seo confirmation'
    assert record.get('packet_sha256') == PACKET_PIN, 'seo packet identity'
    assert record.get('human_confirmation_record_sha256') == HUMAN_PIN, 'seo human confirmation identity'
    assert record.get('baseline_commit') == 'cdb2c8642232f7f3a27be86beed5c5dddc084cdc', 'seo baseline identity'
    articles = record.get('articles', [])
    assert len(articles) == 5 and {a['key']: a['target'] for a in articles} == TARGETS, 'seo exact article coverage'
    assert (set(record.get('reviewed_dependencies', {})) == REVIEWED
            and set(record.get('publication_dependencies', {})) == PUBLICATION
            and len(REVIEWED) == 22 and len(PUBLICATION) == 17), 'seo dependency coverage'
    assert digest(raw) == RECORD_PIN, 'seo record pin'
    old_raw = read(root, 'docs/reviews/editorial-11-human-proofreading.json', 'seo missing legacy receipt')
    assert digest(old_raw) == LEGACY_PIN, 'seo legacy record pin'
    old = {a['target']: a for a in json.loads(old_raw)['articles']}
    for article in articles:
        target = article['target']
        assert article['reviewed_source'] == OVERLAY + target, 'seo reviewed source identity'
        draft = read(root, article['reviewed_source'], 'seo missing draft snapshot')
        assert draft.count(b'\ndraft: true\n') == 1 and b'\ndraft: false\n' not in draft, 'seo source draft flag'
        assert digest(draft) == article['draft_sha256'], 'seo draft snapshot: ' + target
        public = read(root, target, 'seo missing article')
        assert public.count(b'\ndraft: false\n') == 1 and b'\ndraft: true\n' not in public, 'seo publication draft flag'
        assert (public == draft.replace(b'\ndraft: true\n', b'\ndraft: false\n', 1)
                and digest(public) == article['promotion_expected_sha256']), 'seo published bytes: ' + target
        assert re.findall(rb'^evidenceKey: (\w+)$', public, re.M) == [article['key'].encode()], 'seo evidence key'
        predecessor = old[target]
        old_draft = read(root, predecessor['snapshot'], 'seo missing legacy snapshot')
        assert digest(old_draft) == predecessor['draft_sha256'], 'seo legacy snapshot'
        assert old_draft.count(b'\ndraft: true\n') == 1, 'seo legacy draft flag'
        assert (digest(old_draft.replace(b'\ndraft: true\n', b'\ndraft: false\n', 1))
                == predecessor['published_sha256'] == article['replaced_public_source_sha256']), 'seo replacement predecessor'
    for group, label in [('reviewed_dependencies', 'seo reviewed dependency'), ('publication_dependencies', 'seo publication dependency')]:
        for rel, expected in record[group].items():
            assert digest(read(root, rel, label + ' missing')) == expected, label + ': ' + rel
    registry = json.loads((root / 'data/article-evidence-seo-demand01.json').read_bytes())['articles']
    assert {key: a['file'] for key, a in registry.items()} == TARGETS, 'seo evidence binding'
    related = json.loads((root / 'data/related-articles.json').read_bytes())['pages']
    assert len(related) == len(record['related_article_routes']) == 14 and set(related) == set(record['related_article_routes']), 'seo related routes'
    assert sum(len(v) for v in related.values()) == record['related_card_count'] == 42, 'seo related cards'
    return record


if __name__ == '__main__':
    verify()
    print('PASS SEO-DEMAND-01: five exact promotions, 22 reviewed and 17 publication dependencies, immutable operator pins')
