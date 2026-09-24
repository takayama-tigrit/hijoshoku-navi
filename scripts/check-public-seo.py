#!/usr/bin/env python3
"""Read-only fixed-origin public SEO probe. No browser, cookies, analytics or ASP clicks."""
import argparse
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree

ORIGIN = 'https://hijoshoku-navi.com'
ARTICLES = ('/guide/', '/ranking/', '/posts/alpha-mai-osusume/',
            '/posts/emergency-food-set-check/', '/posts/emergency-food-side-dishes/',
            '/posts/emergency-canned-food/', '/posts/supermarket-emergency-food-list/')
ROUTES = (*ARTICLES, '/sitemap.xml', '/robots.txt')
JST = timezone(timedelta(hours=9))
SCOPE = 'public technical SEO only; not indexing, traffic, attribution or revenue'


def in_window(jst_date):
    return '2026-09-21' <= jst_date <= '2026-10-18'


def fetch(route):
    if route not in ROUTES:
        raise ValueError('Route outside fixed public allowlist')
    # Ignore user curlrc; no redirects, cookie jar, authentication, or raw header output.
    proc = subprocess.run([
        'curl', '--disable', '--silent', '--show-error', '--max-time', '20',
        '--max-filesize', '2000000', '--proto', '=https', '--dump-header', '-',
        '--user-agent', 'HijoshokuNaviSiteCheck/1.0 (+https://hijoshoku-navi.com/about/)',
        ORIGIN + route,
    ], capture_output=True, text=True, timeout=25)
    if proc.returncode:
        raise RuntimeError('public_fetch_failed')
    remaining = proc.stdout.replace('\r\n', '\n')
    status, mime, robots = None, '', ''
    while remaining.startswith('HTTP/'):
        header, separator, remaining = remaining.partition('\n\n')
        if not separator:
            raise ValueError('invalid_response')
        lines = header.splitlines()
        status = int(lines[0].split()[1])
        if 100 <= status < 200 or lines[0].lower() in (
                'http/1.0 200 connection established', 'http/1.1 200 connection established'):
            status = None  # Interim/proxy headers must be followed by a final response.
            continue
        fields = [line.partition(':') for line in lines[1:]]
        mime = next((v.strip().split(';')[0].lower() for k, _, v in fields if k.lower() == 'content-type'), '')
        robots = ','.join(v.strip() for k, _, v in fields if k.lower() == 'x-robots-tag')
        break  # After the final headers, even an HTTP-looking prefix is body data.
    if status is None:
        raise ValueError('missing_http_status')
    return status, mime, robots, remaining


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals, self.descriptions, self.robots, self.headings, self.schemas = [], [], [], [], []
        self.title, self.active, self.buffer = '', None, ''

    def handle_starttag(self, tag, attrs):
        attrs = {key: value or '' for key, value in attrs}
        if tag == 'link' and 'canonical' in attrs.get('rel', '').split():
            self.canonicals.append(attrs.get('href', ''))
        if tag == 'meta':
            if attrs.get('name', '').lower() == 'description':
                self.descriptions.append(attrs.get('content', ''))
            if attrs.get('name', '').lower() in ('robots', 'googlebot'):
                self.robots.append(attrs.get('content', ''))
        if tag in ('title', 'h1') or (tag == 'script' and attrs.get('type') == 'application/ld+json'):
            self.active, self.buffer = tag, ''

    def handle_data(self, data):
        if self.active:
            self.buffer += data

    def handle_endtag(self, tag):
        if tag != self.active:
            return
        value = self.buffer.strip()
        if tag == 'title':
            self.title = value
        elif tag == 'h1':
            self.headings.append(value)
        elif tag == 'script':
            parsed = json.loads(value)
            nodes = parsed if isinstance(parsed, list) else parsed.get('@graph', [parsed])
            # Support the site's simple schema.org graph, not arbitrary JSON-LD expansion.
            context = parsed.get('@context') if isinstance(parsed, dict) else None
            self.schemas.extend({'@context': context, **node} for node in nodes if isinstance(node, dict))
        self.active, self.buffer = None, ''


def audit(fetcher=fetch):
    results, bodies = [], {}
    for route in ROUTES:
        checks, status = {}, None
        try:
            status, mime, header_robots, body = fetcher(route)
            checks['http_200'] = status == 200
            if status == 200:
                bodies[route] = body
                if route in ARTICLES:
                    page = Page(); page.feed(body)
                    checks.update(
                        html=mime == 'text/html',
                        title_present=bool(page.title),
                        description=len(page.descriptions) == 1 and bool(page.descriptions[0].strip()),
                        canonical=page.canonicals == [ORIGIN + route],
                        h1=len(page.headings) == 1 and bool(page.headings[0]),
                        indexable=not bool(re.search(r'\b(?:noindex|none)\b', ','.join([header_robots, *page.robots]), re.I)),
                        article_schema=any(isinstance(x, dict) and x.get('@type') == 'Article'
                                           and x.get('@context') == 'https://schema.org'
                                           and x.get('mainEntityOfPage') == ORIGIN + route
                                           and page.headings == [x.get('headline')]
                                           for x in page.schemas),
                    )
        except Exception:
            checks['readable_response'] = False  # Do not persist provider errors or raw bodies.
        results.append({'route': route, 'http_status': status, 'checks': checks})
    site_checks = {}
    try:
        root = ElementTree.fromstring(bodies['/sitemap.xml'])
        ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
        # Only the site's urlset > url > loc (+ optional lastmod) shape is supported.
        site_checks['sitemap_structure'] = root.tag == ns + 'urlset' and all(
            entry.tag == ns + 'url'
            and [child.tag for child in entry] in ([ns + 'loc'], [ns + 'loc', ns + 'lastmod'])
            and all(len(child) == 0 for child in entry)
            for entry in root)
        urls = [x.text for x in root.findall(ns + 'url/' + ns + 'loc')]
        site_checks['article_sitemap_membership'] = all(urls.count(ORIGIN + r) == 1 for r in ARTICLES)
        site_checks['no_taxonomy_in_sitemap'] = not any(u and u.startswith((ORIGIN + '/tags/', ORIGIN + '/categories/')) for u in urls)
    except (KeyError, ElementTree.ParseError):
        site_checks['sitemap_parse'] = False
    try:
        # Fixed-site contract, not a general robots interpreter: reject path rules,
        # extra groups/directives and duplicates instead of guessing Google semantics.
        lines = [line.split('#', 1)[0].strip() for line in bodies['/robots.txt'].splitlines()]
        rules = [(key.strip().lower() if separator else '', value.strip()) for line in lines if line
                 for key, separator, value in [line.partition(':')]]
        open_rules = rules[1:-1]
        site_checks['robots_allow_articles'] = (
            bool(rules) and rules[0] == ('user-agent', '*') and bool(open_rules)
            and len(open_rules) == len(set(open_rules))
            and all(rule in (('disallow', ''), ('allow', '/')) for rule in open_rules))
        site_checks['robots_sitemap'] = (
            bool(rules) and rules[-1] == ('sitemap', ORIGIN + '/sitemap.xml')
            and sum(key == 'sitemap' for key, value in rules) == 1)
    except (KeyError, ValueError):
        site_checks['robots_parse'] = False
    passed = all(all(row['checks'].values()) for row in results) and all(site_checks.values())
    return {'status': 'PASS' if passed else 'FAIL', 'measurement_scope': SCOPE,
            'target_origin': ORIGIN, 'pages': results, 'site_checks': site_checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--scheduled', action='store_true', help='Skip HTTP outside the fixed experiment window')
    args = parser.parse_args()
    now = datetime.now(JST)
    if args.scheduled and not in_window(now.date().isoformat()):
        report = {'status': 'NOT_RUN_OUTSIDE_WINDOW', 'measurement_scope': SCOPE}
    else:
        report = audit()
    report['checked_at'] = now.isoformat(timespec='seconds')
    dest = Path(args.output); dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open('x', encoding='utf-8') as file:
        json.dump(report, file, ensure_ascii=False, indent=2); file.write('\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report['status'] == 'FAIL' else 0


if __name__ == '__main__':
    raise SystemExit(main())
