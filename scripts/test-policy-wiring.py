#!/usr/bin/env python3
"""Synthetic wiring tests: no claims about real article quality or publication."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('verify-policy-wiring.py')

class WiringTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.assertTrue(SCRIPT.exists(), 'shared wiring checker not implemented')
        spec = importlib.util.spec_from_file_location('wiring', SCRIPT)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        (self.root/'docs').mkdir()
        (self.root/'tests').mkdir()
        self.policy = {'version':'affiliate-common-v1','canonical':'static-site-affiliate-ops/references/portfolio-policy.md','rules':['AF%02d'%n for n in range(1,9)]}
        self.save('docs/affiliate-common-policy.json', self.policy)
        self.binding = {'version':self.policy['version'],'policy_sha256':hashlib.sha256((self.root/'docs/affiliate-common-policy.json').read_bytes()).hexdigest(),'rules':{r:{'evidence':['docs/site.md'],'checks':['tests/site.py']} for r in self.policy['rules']}}
        self.save('docs/affiliate-policy-binding.json',self.binding)
        self.save('package.json',{'scripts':{'test':'python3 -B scripts/verify-policy-wiring.py --site . && python3 -B tests/site.py'}})
        (self.root/'docs/site.md').write_text('Synthetic topic fixture; no real publication approval.\n')
        (self.root/'tests/site.py').write_text('pass\n')
    def save(self,p,v):
        (self.root/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
    def test_two_topics(self):
        for topic in ('防災食品fixture','趣味の園芸fixture'):
            (self.root/'docs/site.md').write_text(topic)
            self.m.verify(self.root)
    def test_missing_rule(self):
        del self.binding['rules']['AF03'];self.save('docs/affiliate-policy-binding.json',self.binding)
        with self.assertRaisesRegex(ValueError,'rule coverage'):self.m.verify(self.root)
    def test_empty_evidence(self):
        self.binding['rules']['AF03']['evidence']=[];self.save('docs/affiliate-policy-binding.json',self.binding)
        with self.assertRaisesRegex(ValueError,'evidence'):self.m.verify(self.root)
    def test_missing_file(self):
        (self.root/'docs/site.md').unlink()
        with self.assertRaisesRegex(ValueError,'missing'):self.m.verify(self.root)
    def test_path_escape(self):
        self.binding['rules']['AF03']['evidence']=['../outside'];self.save('docs/affiliate-policy-binding.json',self.binding)
        with self.assertRaisesRegex(ValueError,'path'):self.m.verify(self.root)
    def test_snapshot_tamper(self):
        self.policy['version']='affiliate-common-v2';self.save('docs/affiliate-common-policy.json',self.policy)
        with self.assertRaisesRegex(ValueError,'snapshot'):self.m.verify(self.root)
    def test_upstream_drift(self):
        self.save('upstream.json',dict(self.policy,version='affiliate-common-v2'))
        with self.assertRaisesRegex(ValueError,'upstream'):self.m.verify(self.root,self.root/'upstream.json')
    def test_test_entry_missing(self):
        self.save('package.json',{'scripts':{'test':'python3 -B tests/site.py'}})
        with self.assertRaisesRegex(ValueError,'test entry'):self.m.verify(self.root)
    def test_check_not_wired(self):
        self.binding['rules']['AF01']['checks']=['docs/site.md'];self.save('docs/affiliate-policy-binding.json',self.binding)
        with self.assertRaisesRegex(ValueError,'check not wired'):self.m.verify(self.root)
    def test_duplicate_json(self):
        (self.root/'docs/affiliate-policy-binding.json').write_text('{"version":1,"version":2}')
        with self.assertRaisesRegex(ValueError,'duplicate'):self.m.verify(self.root)

if __name__=='__main__':unittest.main()
