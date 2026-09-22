"""New approval is additive; old approval, draft snapshot and exact new bytes stay bound."""
import json, shutil, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
assert (ROOT/'scripts/content12_confirmation.py').is_file(), 'content12 publication verifier missing'
with tempfile.TemporaryDirectory(prefix='content12-confirmation-') as d:
    root=Path(d)
    for p in ['content','docs','data','layouts','scripts']:
        shutil.copytree(ROOT/p,root/p,ignore=shutil.ignore_patterns('__pycache__'))
    def run(script='content12_confirmation.py'):
        return subprocess.run(['python3','-B',str(root/'scripts'/script)],capture_output=True,text=True)
    assert run().returncode==0,run().stderr
    assert run('editorial_confirmation.py').returncode==0,run('editorial_confirmation.py').stderr
    p=root/'docs/reviews/content-12-human-proofreading.json';original=p.read_bytes();data=json.loads(original)
    for field,value,reason in [('result','pending','actual content12 confirmation'),('reviewer','ai','actual content12 confirmation'),('version','CONTENT-12-V1','actual content12 confirmation'),('user_quote','進めて','actual content12 confirmation'),('packet_sha256','0'*64,'content12 packet identity'),('recorded_at','2099-01-01','content12 record pin')]:
        changed=dict(data);changed[field]=value;p.write_text(json.dumps(changed));r=run()
        assert r.returncode!=0 and reason in r.stderr,(field,r.stderr)
        p.write_bytes(original)
    for rel,reason in [('content/posts/pack-rice-or-alpha-rice.md','content12 published bytes'),('docs/drafts/content-12/pack-rice-or-alpha-rice.md','content12 frozen dependency'),('docs/reviews/content-12/CONTENT-12-V2.md','content12 packet bytes'),('data/article-evidence.json','content12 publication dependency'),('docs/sources/ledger.json','content12 publication dependency')]:
        q=root/rel;raw=q.read_bytes();q.write_bytes(raw+b'\nmutation');r=run()
        assert r.returncode!=0 and reason in r.stderr,(rel,r.stderr)
        q.write_bytes(raw)
    # Existing evidence cannot be changed while preserving only the new keys.
    q=root/'data/article-evidence.json';raw=q.read_bytes();obj=json.loads(raw);key=next(k for k in obj['articles'] if k not in ['pack_rice_12','food_to_go_12']);obj['articles'][key]['source_ids'].append(999)
    q.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n');r=run('editorial_confirmation.py')
    assert r.returncode!=0 and 'confirmed dependency identity' in r.stderr,r.stderr
    q.write_bytes(raw)
    assert run().returncode==run('editorial_confirmation.py').returncode==0
    # Optimization must fail closed before reading approvals, through CLI and import.
    import os
    optimized_cases=0
    variants=[None,'docs/reviews/content-12-human-proofreading.json','content/posts/pack-rice-or-alpha-rice.md','content/posts/emergency-food-to-go.md','docs/sources/retrieval.json','docs/sources/excerpts/29.txt']
    for variant in variants:
        before=b''
        if variant:
            q=root/variant;before=q.read_bytes()
            if variant.endswith('human-proofreading.json'):
                mutation=json.loads(before);mutation['result']='pending';q.write_text(json.dumps(mutation))
            else:q.write_bytes(before+b'\nUNAPPROVED CHANGE\n')
        for mode in ['-O','-OO','env']:
            env=dict(os.environ);env.pop('PYTHONOPTIMIZE',None)
            flags=[] if mode=='env' else [mode]
            if mode=='env':env['PYTHONOPTIMIZE']='1'
            for module in ['content12_confirmation','editorial_confirmation']:
                for entry in ['direct','import']:
                    args=[str(root/'scripts'/(module+'.py'))] if entry=='direct' else ['-c',f"import sys; from pathlib import Path; sys.path.insert(0,{str(root/'scripts')!r}); import {module}; {module}.verify(Path({str(root)!r}))"]
                    r=subprocess.run(['python3','-B',*flags,*args],capture_output=True,text=True,env=env)
                    assert r.returncode!=0 and 'approval verification requires assertions enabled' in r.stderr,(variant,mode,module,entry,r.stdout,r.stderr)
                    assert 'PASS' not in r.stdout
                    optimized_cases+=1
        if variant:q.write_bytes(before)
    assert run().returncode==run('editorial_confirmation.py').returncode==0
print(f'PASS content12 approval: two positive gates, 12 mutation fixtures, {optimized_cases} optimized-mode refusals')
