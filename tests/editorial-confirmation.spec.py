"""Confirmation gate rejects each independently mutated boundary."""
import json, shutil, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='editorial-confirmation-') as temp:
    root = Path(temp)
    for folder in ['content','docs/reviews','data','layouts','scripts']:
        shutil.copytree(ROOT/folder, root/folder)
    record = root/'docs/reviews/editorial-11-human-proofreading.json'
    original = record.read_bytes() if record.exists() else b'{}'
    def run():
        return subprocess.run(['python3','-B',str(root/'scripts/editorial_confirmation.py')],text=True,capture_output=True)
    good = run()
    assert good.returncode == 0, 'confirmed publication gate missing: ' + good.stdout + good.stderr
    data = json.loads(original)
    for field, value, reason in [
        ('result','pending','actual operator confirmation'),
        ('reviewer','automated_reviewer','actual operator confirmation'),
        ('version','EDITORIAL-11-V1','actual operator confirmation'),
        ('packet_sha256','0'*64,'confirmed packet identity'),
        ('user_quote','進めて','actual operator confirmation'),
        ('recorded_at','2099-01-01T00:00:00+09:00','confirmation record pin'),
    ]:
        changed = dict(data); changed[field] = value
        record.write_text(json.dumps(changed))
        result = run()
        assert result.returncode != 0 and reason in result.stderr, (field,result.stdout,result.stderr)
        record.write_bytes(original)
    for field, reason in [('draft_sha256','confirmed source identity'),('published_sha256','published bytes match record')]:
        changed = json.loads(original); changed['articles'][0][field] = '0'*64
        record.write_text(json.dumps(changed))
        result=run()
        assert result.returncode != 0 and reason in result.stderr, (field,result.stderr)
        record.write_bytes(original)
    for rel, reason in [(data['articles'][0]['target'],'published text equals confirmed source except draft flag'),
                        (data['articles'][0]['snapshot'],'confirmed source snapshot'),
                        ('layouts/shortcodes/product-compare.html','confirmed dependency identity')]:
        p=root/rel; raw=p.read_bytes(); p.write_bytes(raw+b'\nmutated')
        result=run()
        assert result.returncode != 0 and reason in result.stderr, (rel,result.stderr)
        p.write_bytes(raw)
    assert run().returncode == 0
print('PASS editorial confirmation: 11 negative fixtures plus valid confirmed publication')
