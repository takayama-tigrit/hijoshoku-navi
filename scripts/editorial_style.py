#!/usr/bin/env python3
"""Reject known editorial regressions; flag contextual style issues for real review.

No AI-authorship inference or automatic rewriting. Safety/fact checking is separate.
"""
import argparse
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re

RULES = [
    ('E001', 'error', r'商品名と販売単位は\d{4}年\d{1,2}月\d{1,2}日に確認(?:しました|済み)', '確認日を読者本文で実況せず、出典台帳へ。'),
    ('E002', 'error', r'価格・在庫・送料・配送条件は、?注文時の商品ページで確かめます', '運営者主語の汎用案内を削る。必要条件は商品近くへ。'),
    ('E003', 'error', r'長期保存水という名前だけで、?置き場所の条件がなくなるわけではありません', '抽象的な否定補足を削り、具体的な保存条件を残す。'),
    ('E004', 'error', r'わかりやすく整理しました|信頼できる情報をお届けします', '編集者の姿勢を宣伝しない。'),
    ('E005', 'error', r'商品・販売店の一致、在庫、配送条件を保証しません|広告・アフィリエイトリンクではありません', '包括免責を本文へ反復しない。必要な広告開示は維持。'),
    ('R005', 'review', r'混同しないでください|取り違えないでください|読み替えないでください', '抽象的な説教なら具体化する。アレルギー等の必要な識別・安全指示は理由付きで維持。'),
    ('R001', 'review', r'と案内しています|とされています', '出典主語の間接話法。帰属が重要か、事実として直接書けるか審査。'),
    ('R002', 'review', r'わけではありません|に限りません|ではないこと', '具体的な違いを示さない否定補足・予防線になっていないか。'),
    ('R003', 'review', r'この記事では|以下で解説|詳しく解説します|紹介していきます', '説明予定の実況を削って実際の内容から始められるか。'),
    ('R004', 'review', r'ことが重要です|ことが大切です|と言えるでしょう', '重要性の強調より具体的な理由・行動を示す。'),
]


def scan(text):
    results = []
    for rule, severity, pattern, reason in RULES:
        for match in re.finditer(pattern, text):
            results.append({'rule': rule, 'severity': severity,
                            'line': text.count('\n', 0, match.start()) + 1,
                            'excerpt': text[max(0, match.start()-28):match.end()+40],
                            'reason': reason})
    return sorted(results, key=lambda x: (x['line'], x['rule']))


class ReaderText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.skip += 1
        if tag == 'meta':
            attrs = dict(attrs)
            if attrs.get('name') == 'description':
                self.parts.append((attrs.get('content') or '') + '\n')
        if tag in {'p', 'div', 'section', 'h1', 'h2', 'h3', 'li', 'tr', 'figcaption'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'script', 'style'}:
            self.skip = max(0, self.skip-1)
        if tag in {'p', 'div', 'section', 'h1', 'h2', 'h3', 'li', 'tr', 'figcaption'}:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_text(text):
    parser = ReaderText()
    parser.feed(text)
    return ''.join(parser.parts)


def source_text(text):
    # Preserve frontmatter display strings but not markup delimiters.
    text = re.sub(r'\{\{<\s*mark\s+("(?:[^"\\]|\\.)*")\s*>\}\}',
                  lambda m: json.loads(m.group(1)), text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    return html.unescape(re.sub(r'<[^>]+>', '', text))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+', type=Path, help='explicit .md/.html files or directories')
    args = parser.parse_args()
    files = set()
    for path in args.paths:
        if not path.exists():
            parser.error(f'missing path: {path}')
        files.update(p for p in path.rglob('*') if p.suffix in {'.md', '.html'}) if path.is_dir() else files.add(path)
    if not files:
        parser.error('empty inspection set')
    results = []
    for path in sorted(files):
        raw = path.read_text()
        text = html_text(raw) if path.suffix == '.html' else source_text(raw)
        for hit in scan(text):
            results.append({'file': str(path), **hit})
    print(json.dumps({'files': len(files), 'findings': results,
                      'errors': sum(x['severity']=='error' for x in results),
                      'review_items': sum(x['severity']=='review' for x in results),
                      'limitation': '字句検査。自然さ・事実・安全の合格を証明しない。review項目の採否は独立レビューへ。'},
                     ensure_ascii=False, indent=2))
    return int(any(x['severity']=='error' for x in results))


if __name__ == '__main__':
    raise SystemExit(main())
