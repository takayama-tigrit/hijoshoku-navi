"""Regression: evidence verification must reject Python optimization before reading inputs."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

if not __debug__:
    raise RuntimeError('run this test harness without Python optimization')

SOURCE = Path(os.environ.get('TARGET_SOURCE', Path(__file__).resolve().parents[1])).resolve()
BASE_ENV = {k: v for k, v in os.environ.items() if k != 'PYTHONOPTIMIZE'}
SCRATCH = Path(os.environ.get('TMPDIR') or tempfile.gettempdir()).resolve()
OUT = Path(os.environ.get('ARTIFACT_DIR', tempfile.mkdtemp(prefix='content14-opt-', dir=SCRATCH)))
OUT.mkdir(parents=True, exist_ok=True)
FIXTURE = Path(tempfile.mkdtemp(prefix='content14-opt-fixture-', dir=SCRATCH))
for rel in ['content', 'data', 'docs', 'scripts', 'layouts', 'assets', 'static']:
    shutil.copytree(SOURCE / rel, FIXTURE / rel, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
shutil.copy2(SOURCE / 'hugo.toml', FIXTURE / 'hugo.toml')
EMPTY = Path(tempfile.mkdtemp(prefix='content14-opt-empty-', dir=SCRATCH))
(EMPTY / 'docs/sources').mkdir(parents=True)
shutil.copy2(SOURCE / 'docs/sources/verify.py', EMPTY / 'docs/sources/verify.py')
GUARD = 'evidence verification does not support Python optimization'
IMPORT = ('import importlib.util, pathlib; p=pathlib.Path("docs/sources/verify.py"); '
          's=importlib.util.spec_from_file_location("evidence_verifier_probe", p); '
          'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)')
MODES = [('normal', [], None), ('O', ['-O'], None), ('OO', ['-OO'], None),
         ('env1', [], '1'), ('env2', [], '2')]
rows = []
failures = []


def hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def run_state(name, root, normal_error=None):
    before = hashes(root)
    for entry in ['cli', 'import']:
        for mode, flags, value in MODES:
            env = dict(BASE_ENV)
            if value is not None:
                env['PYTHONOPTIMIZE'] = value
            args = [sys.executable, '-B', *flags]
            args += ['docs/sources/verify.py'] if entry == 'cli' else ['-c', IMPORT]
            p = subprocess.run(args, cwd=root, env=env, text=True, capture_output=True, timeout=30)
            output = p.stdout + p.stderr
            label = f'{name}-{entry}-{mode}'
            (OUT / (label + '.log')).write_text(output)
            if mode != 'normal':
                ok = p.returncode != 0 and GUARD in output and 'PASS ' not in p.stdout
                ok = ok and 'FileNotFoundError' not in output
            elif normal_error:
                ok = p.returncode != 0 and normal_error in output and 'PASS ' not in p.stdout
            else:
                ok = p.returncode == 0 and 'PASS arithmetic' in output
            rows.append({'case': label, 'exit': p.returncode, 'accepted': ok})
            if not ok:
                failures.append(label)
    assert hashes(root) == before, f'verifier must not mutate fixture: {name}'


run_state('valid-public', FIXTURE)
article = FIXTURE / 'content/posts/emergency-canned-food.md'
article_original = article.read_bytes()
assert b'draft: false' in article_original
article.write_bytes(article_original.replace(b'draft: false', b'draft: true', 1))
run_state('unapproved-draft-change', FIXTURE, 'content14 published bytes')
article.write_bytes(article_original)
ledger = FIXTURE / 'docs/sources/content14/ledger.json'
ledger_original = ledger.read_bytes()
data = json.loads(ledger_original)
data[0]['id'] = 1
ledger.write_text(json.dumps(data))
run_state('source-collision', FIXTURE, 'content14 source ID collision')
ledger.write_bytes(ledger_original)
run_state('missing-inputs', EMPTY, 'FileNotFoundError')
result = {'status': 'PASS' if not failures else 'FAIL', 'source': str(SOURCE),
          'verifierSha256': hashlib.sha256((SOURCE / 'docs/sources/verify.py').read_bytes()).hexdigest(),
          'scope': 'CLI/import; valid PUBLIC, unapproved flag change, source collision, absent inputs; no publish',
          'cases': rows, 'failures': failures}
(OUT / 'optimization-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'checks': len(rows), 'failures': failures, 'result': str(OUT / 'optimization-result.json')}))
if failures:
    raise SystemExit(1)
