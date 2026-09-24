"""Verifier regression checks run in disposable copies, never editing the real evidence."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class EvidenceVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hijoshoku-source-test-')
        self.root = Path(self.temp.name)
        for rel in ('content', 'data', 'docs', 'scripts', 'layouts', 'assets', 'static'):
            shutil.copytree(ROOT / rel, self.root / rel)
        for rel in ('hugo.toml',):
            shutil.copy2(ROOT / rel, self.root / rel)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self):
        return subprocess.run(['python3', str(self.root / 'docs/sources/verify.py')], text=True, capture_output=True)

    def test_every_registered_article_is_checked(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for slug in ('emergency-food-set-check', 'emergency-food-side-dishes'):
            self.assertIn(f'PASS content/posts/{slug}.md:', result.stdout)

    def test_mark_wrapping_preserves_source_claims(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_tampered_marked_claim_is_rejected(self):
        p = self.root / 'content/guide/index.md'
        text = p.read_text()
        self.assertIn('4人で3日分なら、飲料水の目安は36L。', text)
        p.write_text(text.replace('4人で3日分なら、飲料水の目安は36L。', '4人で3日分なら、飲料水の目安は99L。'))
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        # Sealed published bytes are checked before semantic claim mappings.
        self.assertEqual(result.stderr.strip().splitlines()[-1],
                         'AssertionError: seo published bytes: content/guide/index.md')
        self.assertEqual(result.stdout, '')

    def test_primary_checklist_safety_change_is_rejected(self):
        p = self.root / 'content/posts/emergency-food-storage.md'
        text = p.read_text()
        old = 'メーカー指定の包装・保存条件を変えない場合'
        self.assertIn(old, text)
        p.write_text(text.replace(old, 'メーカー指定の包装・保存条件を変えてよい場合'))
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip().splitlines()[-1],
                         'AssertionError: seo published bytes: content/posts/emergency-food-storage.md')
        self.assertEqual(result.stdout, '')

    def test_new_water_table_value_is_rejected(self):
        p = self.root / 'content/posts/emergency-water-bottles.md'
        text = p.read_text()
        self.assertIn('500mL×18本 | 9L', text)
        p.write_text(text.replace('500mL×18本 | 9L', '500mL×18本 | 8L'))
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip().splitlines()[-1],
                         'AssertionError: published text equals confirmed source except draft flag')
        self.assertEqual(result.stdout, '')

    def test_unregistered_article_fails_closed(self):
        (self.root / 'content/posts/unregistered.md').write_text('---\nevidenceKey: unregistered\n---\nUnmapped article\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_article_without_evidence_key_fails_closed(self):
        (self.root / 'content/posts/unkeyed.md').write_text('---\ntitle: Unmapped\ndraft: false\n---\nArticle\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_nested_article_without_evidence_key_fails_closed(self):
        d = self.root / 'content/new-article'
        d.mkdir()
        (d / 'index.md').write_text('---\ntitle: Unmapped\ndraft: false\n---\nArticle\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_future_display_date_fails_closed(self):
        p = self.root / 'docs/sources/ledger.json'
        data = json.loads(p.read_text())
        data['sources'][-1]['accessed'] = '2099-01-01'
        p.write_text(json.dumps(data))
        self.assertNotEqual(self.verify().returncode, 0)

    def test_mismatched_display_date_fails_closed(self):
        p = self.root / 'docs/sources/ledger.json'
        data = json.loads(p.read_text())
        data['sources'][-1]['accessed'] = '2000-01-01'
        p.write_text(json.dumps(data))
        self.assertNotEqual(self.verify().returncode, 0)

    def test_missing_retrieval_fails_closed(self):
        p = self.root / 'docs/sources/retrieval.json'
        data = json.loads(p.read_text())
        p.write_text(json.dumps(data[:-1]))
        self.assertNotEqual(self.verify().returncode, 0)

    def test_tampered_excerpt_fails_closed(self):
        p = self.root / 'docs/sources/excerpts/01.txt'
        p.write_text(p.read_text() + '\ntampered')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_future_retrieval_date_fails_closed(self):
        p = self.root / 'docs/sources/retrieval.json'
        data = json.loads(p.read_text())
        data[-1]['checked_at'] = '2099-01-01T00:00:00+09:00'
        p.write_text(json.dumps(data))
        self.assertNotEqual(self.verify().returncode, 0)

if __name__ == '__main__':
    unittest.main()
