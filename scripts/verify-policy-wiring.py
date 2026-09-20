#!/usr/bin/env python3
"""Check policy wiring only. Does NOT certify prose, evidence truth, or approval.

Portable pinned copy from static-site-affiliate-ops. No network or writes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key: '+key)
        result[key] = value
    return result


def load(path):
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)


def local_file(root, name):
    if not isinstance(name,str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('invalid relative path: '+str(name))
    p = (root/name).resolve()
    if root not in p.parents:
        raise ValueError('path escapes site: '+name)
    if not p.is_file() or not p.stat().st_size:
        raise ValueError('missing/empty file: '+name)
    return p


def verify(root, upstream=None):
    root = Path(root).resolve()
    snapshot = local_file(root,'docs/affiliate-common-policy.json')
    policy = load(snapshot)
    binding = load(local_file(root,'docs/affiliate-policy-binding.json'))
    digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    if binding.get('policy_sha256') != digest or binding.get('version') != policy.get('version'):
        raise ValueError('snapshot hash/version mismatch')
    expected = ['AF%02d'%n for n in range(1,9)]
    if policy.get('rules') != expected or policy.get('version') != 'affiliate-common-v1':
        raise ValueError('unsupported snapshot contract')
    if upstream and Path(upstream).read_bytes() != snapshot.read_bytes():
        raise ValueError('upstream differs: assess migration before drafting')
    rules = binding.get('rules')
    if not isinstance(rules,dict) or set(rules) != set(expected):
        raise ValueError('rule coverage mismatch')
    package = load(local_file(root,'package.json'))
    entry = package.get('scripts',{}).get('test','')
    if not isinstance(entry,str) or not entry.startswith('python3 -B scripts/verify-policy-wiring.py --site . && '):
        raise ValueError('test entry must start with policy checker')
    for rid,row in rules.items():
        if not isinstance(row,dict) or set(row) != {'evidence','checks'}:
            raise ValueError('invalid rule row: '+rid)
        evidence, checks = row['evidence'], row['checks']
        if not isinstance(evidence,list) or not evidence:
            raise ValueError('evidence required: '+rid)
        if not isinstance(checks,list):
            raise ValueError('checks must be a list: '+rid)
        for p in evidence:
            local_file(root,p)
        for p in checks:
            local_file(root,p)
            if p not in entry:
                raise ValueError('check not wired into full test entry: '+p)
    return {'version':policy['version'],'rules':len(rules),'result':'wiring-only'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site',type=Path,required=True)
    parser.add_argument('--upstream',type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.site,args.upstream),ensure_ascii=False))
    except (ValueError,OSError,TypeError,AttributeError) as exc:
        print('POLICY WIRING BLOCKED: '+str(exc),file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':
    raise SystemExit(main())
