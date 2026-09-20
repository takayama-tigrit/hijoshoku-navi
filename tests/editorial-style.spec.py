#!/usr/bin/env python3
"""Small lexical safety net; does not certify natural writing or factual accuracy."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'scripts/editorial_style.py'
assert MODULE.exists(), 'editorial_style.py is missing: reader-facing prose has no reusable style gate'
spec = importlib.util.spec_from_file_location('editorial_style', MODULE)
assert spec is not None and spec.loader is not None
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class EditorialStyle(unittest.TestCase):
    def test_rejected_user_examples(self):
        bad = [
            '商品名と販売単位は2026年9月20日に確認しました。',
            '商品名と販売単位は2027年10月1日に確認済みです。',
            '価格・在庫・送料・配送条件は、注文時の商品ページで確かめます。',
            '長期保存水という名前だけで、置き場所の条件がなくなるわけではありません。',
            'Amazonは通常の検索リンクで、広告・アフィリエイトリンクではありません。商品・販売店の一致、在庫、配送条件を保証しません。',
            'わかりやすく整理しました。',
        ]
        for text in bad:
            with self.subTest(text=text):
                self.assertTrue(any(x['severity'] == 'error' for x in m.scan(text)))

    def test_real_warnings_are_not_banned(self):
        allowed = [
            '開封後は冷蔵してください。',
            '膨らんだ缶や液漏れした袋は食べないでください。',
            '水15℃で60分、熱湯で15分が目安です。',
            '通常品は小麦・大豆を含みます。アレルギー対応品とは別商品です。',
            '未開栓の水は、直射日光・高温・強いにおいを避けて保管します。',
            '参考にした情報：確認日 2026年9月20日。',
            '本記事には広告リンクが含まれます。',
        ]
        for text in allowed:
            with self.subTest(text=text):
                self.assertFalse([x for x in m.scan(text) if x['severity'] == 'error'])

    def test_contextual_contrasts_require_review_not_rejection(self):
        for text in ['通常品とアレルギー対応品を取り違えないでください。',
                     '水を足す量と飲む量を混同しないでください。']:
            hits = m.scan(text)
            self.assertTrue(any(x['severity'] == 'review' for x in hits))
            self.assertFalse(any(x['severity'] == 'error' for x in hits))

    def test_attribution_is_review_not_automatic_fact_conversion(self):
        results = m.scan('農林水産省は、湯せん用の水も必要と案内しています。')
        self.assertTrue(any(x['severity'] == 'review' for x in results))
        self.assertFalse(any(x['severity'] == 'error' for x in results))

    def test_markup_does_not_hide_rejected_phrase(self):
        s = '<main><p>商品名と<strong>販売単位</strong>は2026年9月20日に確認しました。</p></main>'
        self.assertTrue(any(x['severity'] == 'error' for x in m.scan(m.html_text(s))))

    def test_script_does_not_count_as_reader_copy(self):
        s = '<script>商品名と販売単位は2026年9月20日に確認しました。</script><main>水を数える。</main>'
        self.assertEqual(m.scan(m.html_text(s)), [])

    def test_meta_and_captions_are_scanned(self):
        s = '<meta name="description" content="わかりやすく整理しました。"><main><figure><figcaption>混同しないでください。</figcaption></figure></main>'
        hits = m.scan(m.html_text(s))
        self.assertEqual(len([x for x in hits if x['severity']=='error']), 1)
        self.assertEqual(len([x for x in hits if x['severity']=='review']), 1)

    def test_rule_ids_and_context_are_reported(self):
        hits = m.scan('前の文。\nわかりやすく整理しました。')
        self.assertEqual(hits[0]['line'], 2)
        self.assertEqual(hits[0]['rule'], 'E004')
        self.assertIn('整理', hits[0]['excerpt'])


if __name__ == '__main__':
    unittest.main()
