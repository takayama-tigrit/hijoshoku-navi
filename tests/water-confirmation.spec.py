"""Reject stale confirmations and post-proofreading edits in disposable fixtures."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='water-confirmation-') as tmp:
    fixture = Path(tmp)
    for rel in ['content', 'docs', 'tests', 'data', 'assets', 'layouts', 'themes', 'static']:
        shutil.copytree(ROOT / rel, fixture / rel)
    shutil.copy2(ROOT / 'hugo.toml', fixture / 'hugo.toml')
    record = fixture / 'docs/reviews/water-10-human-proofreading.json'
    article = fixture / 'content/posts/emergency-water-bottles.md'
    original_record = record.read_text()
    original_article = article.read_text()
    cases = [
        ('result', 'pending', 'water: actual operator confirmation'),
        ('reviewer', 'automated_reviewer', 'water: actual operator confirmation'),
        ('version', 'WATER-10-V1', 'water: actual operator confirmation'),
        ('packet_sha256', '0' * 64, 'water: confirmed packet identity'),
        ('source_sha256', '0' * 64, 'water: confirmed source identity'),
        ('article', None, 'water: published text equals confirmed source except draft flag'),
    ]
    for field, value, reason in cases:
        data = json.loads(original_record)
        if field == 'article':
            article.write_text(original_article.replace('2L×6本の12L', '2L×6本の99L'))
        else:
            data[field] = value
            record.write_text(json.dumps(data))
        result = subprocess.run(['python3', '-B', str(fixture / 'tests/amazon-readiness.spec.py')], cwd=fixture, text=True, capture_output=True)
        assert result.returncode != 0 and reason in result.stdout, (field, result.stdout, result.stderr)
        record.write_text(original_record)
        article.write_text(original_article)
    result = subprocess.run(['python3', '-B', str(fixture / 'tests/amazon-readiness.spec.py')], cwd=fixture, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
print('PASS six negative confirmation fixtures and unchanged confirmed source')
