"""Exact operator confirmation is additive; no old approval is rewritten."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

if not __debug__:
    raise RuntimeError('run test harness without optimization')
ROOT = Path(__file__).resolve().parents[1]
SCRIPT = 'scripts/content14_confirmation.py'
RECORD = 'docs/reviews/content-14-visual-human-confirmation.json'
assert (ROOT / SCRIPT).is_file(), 'content14 publication verifier missing'
with tempfile.TemporaryDirectory(prefix='content14-confirmation-', dir=os.environ.get('TMPDIR')) as temp:
    root = Path(temp)
    for rel in ['content', 'docs', 'data', 'layouts', 'scripts', 'assets', 'static']:
        shutil.copytree(ROOT / rel, root / rel, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(ROOT / 'hugo.toml', root / 'hugo.toml')
    env = {k: v for k, v in os.environ.items() if k != 'PYTHONOPTIMIZE'}
    def run(script=SCRIPT, flags=(), extra_env=None, imported=False):
        args = [str(root / script)]
        if imported:
            args = ['-c', f"import sys; from pathlib import Path; sys.path.insert(0, {str(root / 'scripts')!r}); import content14_confirmation; content14_confirmation.verify(Path({str(root)!r}))"]
        return subprocess.run([sys.executable, '-B', *flags, *args], env={**env, **(extra_env or {})}, capture_output=True, text=True)
    for script in [SCRIPT, 'scripts/editorial_confirmation.py', 'scripts/content12_confirmation.py', 'docs/sources/verify.py']:
        result = run(script)
        assert result.returncode == 0, (script, result.stdout, result.stderr)
    count = 0
    def mutation(rel, change, reason, script=SCRIPT):
        global count
        p = root / rel
        original = p.read_bytes()
        try:
            p.write_bytes(change(original))
            result = run(script)
            assert result.returncode != 0 and reason in result.stderr, (rel, reason, result.stdout, result.stderr)
            count += 1
        finally:
            p.write_bytes(original)
    def edit(fn):
        def change(raw):
            data = json.loads(raw)
            fn(data)
            return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
        return change
    for field, value, reason in [
        ('result', 'pending', 'actual content14 confirmation'),
        ('reviewer', 'ai', 'actual content14 confirmation'),
        ('version', 'CONTENT-14-TEXT-V1', 'actual content14 confirmation'),
        ('user_quote', '進めて', 'actual content14 confirmation'),
        ('publication_approval', 'PENDING', 'actual content14 confirmation'),
        ('packet_sha256', '0' * 64, 'content14 packet identity'),
        ('recorded_at', '2099-01-01', 'content14 record pin'),
    ]:
        mutation(RECORD, edit(lambda obj, f=field, v=value: obj.update({f: v})), reason)
    for field in ['articles', 'reviewed_dependencies']:
        mutation(RECORD, edit(lambda obj, f=field: obj.update({f: [] if f == 'articles' else {}})), 'content14 record pin')
    for slug in ['emergency-canned-food', 'supermarket-emergency-food-list']:
        rel = f'content/posts/{slug}.md'
        for fn in [lambda b: b + b'\nUNAPPROVED CHANGE\n', lambda b: b.replace(b'\ndraft: false\n', b'\ndraft: true\n', 1)]:
            mutation(rel, fn, 'content14 published bytes')
        # Evidence entrypoint must enforce the same confirmation, not only npm's wrapper.
        mutation(rel, lambda b: b + b'\nUNAPPROVED CHANGE\n', 'content14 published bytes', 'docs/sources/verify.py')
    for rel in ['data/content14-visual.json', 'data/content14-product-images.json',
                'data/article-evidence-content14.json', 'docs/sources/content14/ledger.json',
                'docs/sources/content14/retrieval.json', 'docs/sources/content14/excerpts/30.txt',
                'layouts/shortcodes/visual-panel.html', 'assets/css/content14-visual.css',
                'static/images/content14/main-5741064201.webp']:
        mutation(rel, lambda b: b + b'\n', 'content14 reviewed dependency')
    for rel in ['data/article-evidence.json', 'docs/sources/ledger.json', 'docs/sources/retrieval.json']:
        mutation(rel, lambda b: b + b'\n', 'content12 publication dependency', 'scripts/content12_confirmation.py')
    # Missing receipt must fail through each real gate. Optimization rejects before any input read.
    p = root / RECORD
    original = p.read_bytes()
    optimized = 0
    try:
        for missing in [False, True]:
            if missing:
                p.unlink()
                for script in [SCRIPT, 'docs/sources/verify.py']:
                    result = run(script)
                    assert result.returncode != 0 and 'FileNotFoundError' in result.stderr
                    assert 'PASS' not in result.stdout
            for flags, extra in [(('-O',), {}), (('-OO',), {}), ((), {'PYTHONOPTIMIZE': '1'}), ((), {'PYTHONOPTIMIZE': '2'})]:
                for imported in [False, True]:
                    result = run(flags=flags, extra_env=extra, imported=imported)
                    assert result.returncode != 0 and 'approval verification requires assertions enabled' in result.stderr
                    assert 'PASS' not in result.stdout and 'FileNotFoundError' not in result.stderr
                    optimized += 1
    finally:
        p.write_bytes(original)
    assert run().returncode == 0
print(f'PASS content14 confirmation: four positive gates, {count} mutations, {optimized} optimized refusals and missing-record refusals')
