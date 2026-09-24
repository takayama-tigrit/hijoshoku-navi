"""SEO-DEMAND-01 exact rebinding; real isolated CLI/import refusal fixtures."""
if not __debug__:
    raise RuntimeError('run test harness without optimization')
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = 'scripts/seo_demand_confirmation.py'
RECORD = 'docs/reviews/seo-demand-01-publication.json'
assert (ROOT / SCRIPT).is_file(), 'seo publication verifier missing'
with tempfile.TemporaryDirectory(prefix='seo-confirmation-', dir=os.environ.get('TMPDIR')) as temp:
    root = Path(temp)
    for rel in ['content', 'docs', 'data', 'layouts', 'scripts', 'assets', 'static']:
        shutil.copytree(ROOT / rel, root / rel, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(ROOT / 'hugo.toml', root / 'hugo.toml')
    env = {k: v for k, v in os.environ.items() if k != 'PYTHONOPTIMIZE'}
    def run(script=SCRIPT, flags=(), extra=None, imported=False, no_reads=False):
        args = [str(root / script)]
        if imported:
            module = Path(script).stem
            guard = "Path.read_bytes = Path.read_text = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('INPUT_READ_BEFORE_GUARD')); " if no_reads else ''
            args = ['-c', f"import sys; from pathlib import Path; sys.path.insert(0, {str(root / 'scripts')!r}); {guard}import {module}; {module}.verify(Path({str(root)!r}))"]
        return subprocess.run([sys.executable, '-B', *flags, *args], env={**env, **(extra or {})}, capture_output=True, text=True, timeout=30)
    for script in [SCRIPT, 'scripts/editorial_confirmation.py', 'scripts/content12_confirmation.py', 'scripts/content14_confirmation.py', 'docs/sources/verify.py']:
        result = run(script)
        assert result.returncode == 0, (script, result.stdout, result.stderr)
    receipt = json.loads((root / RECORD).read_bytes())
    count = 0
    def mutation(rel, change, reason, script=SCRIPT):
        global count
        p = root / rel
        original = p.read_bytes()
        try:
            if change is None:
                p.unlink()
            else:
                p.write_bytes(change(original))
            result = run(script)
            assert result.returncode != 0 and result.stderr.splitlines()[-1].startswith('AssertionError: ' + reason), (rel, reason, result.stdout, result.stderr)
            assert 'PASS SEO-DEMAND' not in result.stdout
            count += 1
        finally:
            p.write_bytes(original)
    def edit(fn):
        def change(raw):
            obj = json.loads(raw)
            fn(obj)
            return (json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode()
        return change
    for field, value, reason in [
        ('result', 'pending', 'actual seo confirmation'),
        ('reviewer', 'ai', 'actual seo confirmation'),
        ('version', 'SEO-DEMAND-01-DRAFT', 'actual seo confirmation'),
        ('user_quote', '進めて', 'actual seo confirmation'),
        ('publication_user_quote', '保留', 'actual seo confirmation'),
        ('publication_approval', 'PENDING', 'actual seo confirmation'),
        ('packet_sha256', '0' * 64, 'seo packet identity'),
        ('human_confirmation_record_sha256', '0' * 64, 'seo human confirmation identity'),
        ('baseline_commit', '0' * 40, 'seo baseline identity'),
        ('recorded_at', '2099-01-01', 'seo record pin'),
    ]:
        mutation(RECORD, edit(lambda obj, f=field, v=value: obj.update({f: v})), reason)
    mutation(RECORD, edit(lambda o: o['articles'].pop()), 'seo exact article coverage')
    mutation(RECORD, edit(lambda o: o['articles'].append(dict(o['articles'][0]))), 'seo exact article coverage')
    mutation(RECORD, edit(lambda o: o['articles'][0].update(key='extra')), 'seo exact article coverage')
    mutation(RECORD, edit(lambda o: o['articles'][0].update(target='content/posts/emergency-canned-food.md')), 'seo exact article coverage')
    for field in ['draft_sha256', 'promotion_expected_sha256', 'replaced_public_source_sha256']:
        mutation(RECORD, edit(lambda o, f=field: o['articles'][0].update({f: '0' * 64})), 'seo record pin')
    for field in ['reviewed_dependencies', 'publication_dependencies']:
        mutation(RECORD, edit(lambda o, f=field: o[f].pop(next(iter(o[f])))), 'seo dependency coverage')
        mutation(RECORD, edit(lambda o, f=field: o[f].update({'unexpected.txt': '0' * 64})), 'seo dependency coverage')
    for script in [SCRIPT, 'scripts/editorial_confirmation.py', 'scripts/content14_confirmation.py', 'docs/sources/verify.py']:
        mutation(RECORD, None, 'seo missing receipt', script)
    for article in receipt['articles']:
        rel = article['target']
        mutation(rel, None, 'seo missing article')
        mutation(rel, lambda b: b.replace(b'\ndraft: false\n', b'\ndraft: true\n'), 'seo publication draft flag')
        for script in [SCRIPT, 'scripts/editorial_confirmation.py', 'docs/sources/verify.py']:
            mutation(rel, lambda b: b + b'\nUNAPPROVED\n', 'seo published bytes', script)
        mutation(article['reviewed_source'], None, 'seo missing draft snapshot')
        mutation(article['reviewed_source'], lambda b: b + b'\nUNAPPROVED\n', 'seo draft snapshot')
    for group, reason in [('reviewed_dependencies', 'seo reviewed dependency'), ('publication_dependencies', 'seo publication dependency')]:
        for rel in receipt[group]:
            if rel in {a['reviewed_source'] for a in receipt['articles']}:
                continue
            mutation(rel, lambda b: b + b'\n', reason)
            mutation(rel, None, reason + ' missing')
    for rel in ['layouts/_partials/article-references.html', 'layouts/single.html']:
        mutation(rel, lambda b: b + b'\n', 'seo publication dependency', 'scripts/content14_confirmation.py')
    legacy = json.loads((root / 'docs/reviews/editorial-11-human-proofreading.json').read_bytes())
    for article in legacy['articles']:
        mutation(article['snapshot'], lambda b: b + b'\n', 'confirmed source snapshot', 'scripts/editorial_confirmation.py')
        if article['target'] not in {a['target'] for a in receipt['articles']}:
            mutation(article['target'], lambda b: b + b'\n', 'published text equals confirmed source', 'scripts/editorial_confirmation.py')
    mutation('docs/reviews/editorial-11-human-proofreading.json', lambda b: b + b'\n', 'seo legacy record pin')
    for rel in ['data/content14-visual.json', 'data/article-evidence-content14.json']:
        mutation(rel, lambda b: b + b'\n', 'content14 reviewed dependency', 'scripts/content14_confirmation.py')

    semantic_count = 0
    def semantic_mutation(rel, change, reason, helper):
        global semantic_count
        p = root / rel
        original = p.read_bytes()
        changed = change(original)
        # Load/verify the pristine fixture first, then exercise the very same read-only
        # source validator on the isolated changed bytes without forging receipt pins.
        program = ("import runpy; from pathlib import Path; "
                   f"ns = runpy.run_path({str(root / 'docs/sources/verify.py')!r}); "
                   f"root = Path({str(root)!r}); (root / {rel!r}).write_bytes({changed!r}); " + helper)
        try:
            result = subprocess.run([sys.executable, '-B', '-c', program], env=env, capture_output=True, text=True, timeout=30)
            assert result.returncode != 0 and result.stderr.splitlines()[-1].startswith('AssertionError: ' + reason), (rel, reason, result.stdout, result.stderr)
            semantic_count += 1
        finally:
            p.write_bytes(original)
    source_helper = "ns['load_seo_evidence'](root, ns['legacy_registry'], ns['legacy_ledger'], ns['legacy_records'])"
    ui_helper = "import json; r = json.loads((root / 'data/article-evidence-seo-demand01.json').read_bytes())['articles']; ns['verify_food_choices'](root, r, ns['sources'])"
    ledger = 'docs/sources/seo-demand01/ledger.json'
    retrieval = 'docs/sources/seo-demand01/retrieval.json'
    evidence = 'data/article-evidence-seo-demand01.json'
    choices = 'data/food-choices.json'
    for rel, change, reason in [
        (ledger, edit(lambda o: o[0].update(id=1)), 'seo source ID collision'),
        (ledger, edit(lambda o: o[0].update(id=43)), 'seo source ID collision'),
        (ledger, edit(lambda o: o.pop()), 'seo exact source coverage'),
        (ledger, edit(lambda o: o[0]['quotes'][0].update(text='NOT RETAINED')), 'seo quote mismatch'),
        (ledger, edit(lambda o: o[0].update(accessed='2026-09-23')), 'seo display/retrieval date mismatch'),
        (retrieval, edit(lambda o: o[0].update(id=1)), 'seo retrieval ID collision'),
        (retrieval, edit(lambda o: o.pop()), 'seo retrieval coverage'),
        (retrieval, edit(lambda o: o[0].update(excerpt='../ledger.json')), 'seo exact excerpt path'),
        (retrieval, edit(lambda o: o[0].update(excerpt_sha256='0' * 64)), 'seo excerpt hash'),
        (retrieval, edit(lambda o: o[0].update(checked_at='2099-01-01T00:00:00+09:00')), 'seo invalid or future evidence date'),
        (retrieval, edit(lambda o: o[0].update(status=404)), 'seo retrieval status'),
        (evidence, edit(lambda o: o['articles'].pop('guide_editorial11_seo01')), 'seo exact evidence coverage'),
        (evidence, edit(lambda o: o['articles']['guide_editorial11_seo01'].update(file='content/posts/emergency-canned-food.md')), 'seo exact evidence coverage'),
    ]:
        semantic_mutation(rel, change, reason, source_helper)
    for rel, change, reason in [
        (choices, edit(lambda o: o['entries'].pop()), 'seo UI exact card coverage'),
        (choices, edit(lambda o: o['entries'][0].update(id='bread')), 'seo UI exact card coverage'),
        (choices, edit(lambda o: o['entries'][0].update(condition='水は不要')), 'seo UI claim text'),
        (choices, edit(lambda o: o['entries'][0].update(source_ids=[12])), 'seo UI claim sources'),
        (evidence, edit(lambda o: o['articles']['ranking_editorial11_seo01']['ui_claims'].pop()), 'seo UI exact claim coverage'),
        (evidence, edit(lambda o: o['articles']['ranking_editorial11_seo01']['ui_claims'][0].update(dataset='other.json')), 'seo UI dataset'),
        (evidence, edit(lambda o: o['articles']['ranking_editorial11_seo01']['source_ids'].remove(30)), 'seo UI reference coverage'),
    ]:
        semantic_mutation(rel, change, reason, ui_helper)

    optimized = 0
    for script in [SCRIPT, 'scripts/editorial_confirmation.py', 'scripts/content12_confirmation.py', 'scripts/content14_confirmation.py']:
        for flags, extra in [(('-O',), {}), (('-OO',), {}), ((), {'PYTHONOPTIMIZE': '1'}), ((), {'PYTHONOPTIMIZE': '2'})]:
            for imported in [False, True]:
                result = run(script, flags, extra, imported, no_reads=imported)
                assert result.returncode != 0 and result.stderr.splitlines()[-1] == 'RuntimeError: approval verification requires assertions enabled', (script, result.stderr)
                assert result.stdout == '', (script, result.stdout)  # Exact final exception above distinguishes a read tripwire from its traceback source literal.
                optimized += 1
    evidence_optimized = 0
    for flags, extra in [(('-O',), {}), (('-OO',), {}), ((), {'PYTHONOPTIMIZE': '1'}), ((), {'PYTHONOPTIMIZE': '2'})]:
        for imported in [False, True]:
            args = [str(root / 'docs/sources/verify.py')]
            if imported:
                args = ['-c', "from pathlib import Path; import runpy; Path.read_bytes = Path.read_text = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('INPUT_READ_BEFORE_GUARD')); " + f"runpy.run_path({str(root / 'docs/sources/verify.py')!r})"]
            result = subprocess.run([sys.executable, '-B', *flags, *args], env={**env, **extra}, capture_output=True, text=True, timeout=30)
            assert result.returncode != 0 and result.stderr.splitlines()[-1] == 'RuntimeError: evidence verification does not support Python optimization', result.stderr
            assert result.stdout == '', (script, result.stdout)  # Exact final exception above distinguishes a read tripwire from its traceback source literal.
            evidence_optimized += 1
    result = run()
    assert result.returncode == 0, result.stderr
print(f'PASS seo confirmation: five positive gates, {count} exact-reason mutations, {semantic_count} semantic mutations, {optimized} approval and {evidence_optimized} evidence optimized CLI/import refusals')
