"""Offline fixtures for the public-only monitor; these are not traffic data."""
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import importlib.util
from io import StringIO
import json
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts' / 'check-public-seo.py'


EXPECTED_ARTICLES = ('/guide/', '/ranking/', '/posts/alpha-mai-osusume/', '/posts/emergency-food-set-check/', '/posts/emergency-food-side-dishes/', '/posts/emergency-canned-food/', '/posts/supermarket-emergency-food-list/')
EXPECTED_ROUTES = (*EXPECTED_ARTICLES, '/sitemap.xml', '/robots.txt')

class PublicSeoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = None
        if SOURCE.exists():
            spec = importlib.util.spec_from_file_location('public_seo', SOURCE)
            assert spec is not None and spec.loader is not None
            cls.mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.mod)

    def module(self):
        self.assertIsNotNone(self.mod, 'Public SEO monitor has not been implemented')
        assert self.mod is not None
        return self.mod

    def fixtures(self, mod):
        pages = {}
        for route in EXPECTED_ARTICLES:
            url = mod.ORIGIN + route
            ld = {'@context': 'https://schema.org', '@graph': [
                {'@type': 'Article', 'headline': 'Fixture article', 'mainEntityOfPage': url}]}
            pages[route] = (200, 'text/html', '', '<title>Fixture</title><meta name="description" content="Fixture description"><link rel="canonical" href="'+url+'"><h1>Fixture article</h1><script type="application/ld+json">'+json.dumps(ld)+'</script>')
        pages['/sitemap.xml'] = (200, 'application/xml', '', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join('<url><loc>'+mod.ORIGIN+r+'</loc></url>' for r in EXPECTED_ARTICLES)+'</urlset>')
        pages['/robots.txt'] = (200, 'text/plain', '', 'User-agent: *\nDisallow:\nSitemap: '+mod.ORIGIN+'/sitemap.xml\n')
        return pages

    def test_all_expected_urls_and_no_analytics_claim(self):
        m = self.module(); data = self.fixtures(m); requested = []
        def fetch(route):
            requested.append(route); return data[route]
        result = m.audit(fetch)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(tuple(m.ARTICLES), EXPECTED_ARTICLES)
        self.assertEqual(tuple(m.ROUTES), EXPECTED_ROUTES)
        self.assertEqual(tuple(requested), EXPECTED_ROUTES)
        self.assertEqual(len(requested), len(set(requested)))
        self.assertEqual(result['measurement_scope'], 'public technical SEO only; not indexing, traffic, attribution or revenue')
        self.assertNotIn('sessions', result)

    def test_corrupt_metadata_sitemap_robots_and_network_fail_closed(self):
        m = self.module()
        mutations = [
            ('canonical', lambda d: d.__setitem__(m.ARTICLES[0], (200,'text/html','',d[m.ARTICLES[0]][3].replace('rel="canonical"','rel="alternate"')))),
            ('noindex', lambda d: d.__setitem__(m.ARTICLES[0], (200,'text/html','',d[m.ARTICLES[0]][3]+'<meta name="googlebot" content="noindex">'))),
            ('header', lambda d: d.__setitem__(m.ARTICLES[0], (200,'text/html','noindex',d[m.ARTICLES[0]][3]))),
            ('missing_h1', lambda d: d.__setitem__(m.ARTICLES[0], (200,'text/html','',d[m.ARTICLES[0]][3].replace('<h1>','<h2>').replace('</h1>','</h2>')))),
            ('ld', lambda d: d.__setitem__(m.ARTICLES[0], (200,'text/html','',d[m.ARTICLES[0]][3].replace('"Article"','"Product"')))),
            ('sitemap', lambda d: d.__setitem__('/sitemap.xml', (200,'application/xml','','<urlset/>'))),
            ('robots', lambda d: d.__setitem__('/robots.txt', (200,'text/plain','','User-agent: *\nDisallow: /\n'))),
            ('404', lambda d: d.__setitem__(m.ARTICLES[0], (404,'text/html','','Not found'))),
            ('403', lambda d: d.__setitem__(m.ARTICLES[0], (403,'text/html','','Just a moment'))),
            ('wrong_mime', lambda d: d.__setitem__(m.ARTICLES[0], (200,'application/json','',d[m.ARTICLES[0]][3]))),
        ]
        for label, mutate in mutations:
            with self.subTest(label=label):
                data=self.fixtures(m);mutate(data)
                self.assertEqual(m.audit(data.__getitem__)['status'],'FAIL')
        def failure(_):
            raise TimeoutError('credential-like raw error must not persist')
        result=m.audit(failure)
        self.assertEqual(result['status'],'FAIL')
        self.assertNotIn('credential-like',json.dumps(result))

    def test_robots_path_rules_and_split_agent_groups_fail_closed(self):
        m = self.module()
        cases = {
            'allow_before_disallow_guide': 'User-agent: *\nAllow: /\nDisallow: /guide/\n',
            'wildcard_posts': 'User-agent: *\nDisallow: /posts/*\n',
            'split_googlebot_groups': 'User-agent: *\nDisallow:\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /guide/\n',
            'unknown_directive': 'User-agent: *\nDisallow:\nCrawl-delay: 10\n',
            'missing_delimiter': 'User-agent: *\nDisallow\n',
            'duplicate_wildcard_group': 'User-agent: *\nDisallow:\n\nUser-agent: *\nDisallow:\n',
        }
        for label, rules in cases.items():
            with self.subTest(label=label):
                data = self.fixtures(m)
                data['/robots.txt'] = (200, 'text/plain', '', rules + 'Sitemap: ' + m.ORIGIN + '/sitemap.xml\n')
                result = m.audit(data.__getitem__)
                self.assertEqual(result['status'], 'FAIL')
                self.assertIs(result['site_checks']['robots_allow_articles'], False)

    def test_robots_only_accepts_fixed_open_rules_and_exact_single_sitemap(self):
        m = self.module()
        for rules in ('Disallow:\n', 'Allow: /\n', 'Disallow:\nAllow: /\n'):
            with self.subTest(rules=rules):
                data = self.fixtures(m)
                data['/robots.txt'] = (200, 'text/plain', '', '# public\nUser-agent: *\n' + rules + 'Sitemap: ' + m.ORIGIN + '/sitemap.xml\n')
                self.assertEqual(m.audit(data.__getitem__)['status'], 'PASS')
        for sitemap in (m.ORIGIN + '/sitemap.xml?extra=1', m.ORIGIN + '/sitemap.xml\nSitemap: https://elsewhere.example/sitemap.xml'):
            with self.subTest(sitemap=sitemap):
                data = self.fixtures(m)
                data['/robots.txt'] = (200, 'text/plain', '', 'User-agent: *\nDisallow:\nSitemap: ' + sitemap + '\n')
                result = m.audit(data.__getitem__)
                self.assertEqual(result['status'], 'FAIL')
                self.assertIs(result['site_checks']['robots_sitemap'], False)

    def test_sitemap_requires_namespaced_urlset_with_direct_url_loc_structure(self):
        m = self.module()
        ns = 'http://www.sitemaps.org/schemas/sitemap/0.9'
        entries = ''.join('<url><loc>' + m.ORIGIN + r + '</loc></url>' for r in m.ARTICLES)
        cases = {
            'wrong_root': '<not-a-sitemap xmlns="' + ns + '">' + entries + '</not-a-sitemap>',
            'foreign_root_namespace': '<urlset xmlns="https://elsewhere.example/"><group xmlns="' + ns + '">' + entries + '</group></urlset>',
            'nested_urls': '<urlset xmlns="' + ns + '"><group>' + entries + '</group></urlset>',
            'direct_locs': '<urlset xmlns="' + ns + '">' + entries.replace('<url>', '').replace('</url>', '') + '</urlset>',
            'nested_locs': '<urlset xmlns="' + ns + '">' + entries.replace('<loc>', '<group><loc>').replace('</loc>', '</loc></group>') + '</urlset>',
            'extra_loc_in_url': '<urlset xmlns="' + ns + '">' + entries.replace('</url>', '<loc>' + m.ORIGIN + '/about/</loc></url>', 1) + '</urlset>',
            'unknown_url_child': '<urlset xmlns="' + ns + '">' + entries.replace('</url>', '<unknown/></url>', 1) + '</urlset>',
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                data = self.fixtures(m)
                data['/sitemap.xml'] = (200, 'application/xml', '', body)
                result = m.audit(data.__getitem__)
                self.assertEqual(result['status'], 'FAIL')
                self.assertIs(result['site_checks']['sitemap_structure'], False)

    def test_sitemap_requires_each_cohort_url_exactly_once(self):
        m = self.module()
        for route in EXPECTED_ARTICLES:
            for label in ('duplicate', 'missing'):
                with self.subTest(route=route, label=label):
                    data = self.fixtures(m)
                    body = data['/sitemap.xml'][3]
                    entry = '<url><loc>' + m.ORIGIN + route + '</loc></url>'
                    self.assertEqual(body.count(entry), 1)
                    body = body.replace(entry, entry + entry if label == 'duplicate' else '')
                    data['/sitemap.xml'] = (200, 'application/xml', '', body)
                    result = m.audit(data.__getitem__)
                    self.assertEqual(result['status'], 'FAIL')
                    self.assertIs(result['site_checks']['article_sitemap_membership'], False)

    def test_sitemap_current_optional_lastmod_shape_is_supported(self):
        m = self.module(); data = self.fixtures(m)
        body = data['/sitemap.xml'][3].replace('</url>', '<lastmod>2026-09-20T00:00:00+09:00</lastmod></url>')
        data['/sitemap.xml'] = (200, 'application/xml', '', body)
        self.assertEqual(m.audit(data.__getitem__)['status'], 'PASS')

    def test_article_schema_requires_exact_supported_context(self):
        m = self.module(); route = m.ARTICLES[0]
        article = {'@type': 'Article', 'headline': 'Fixture article', 'mainEntityOfPage': m.ORIGIN + route}
        cases = {
            'foreign_direct': {**article, '@context': 'https://elsewhere.example/'},
            'foreign_graph': {'@context': 'https://elsewhere.example/', '@graph': [article]},
            'missing_context': article,
            'foreign_node_override': {'@context': 'https://schema.org', '@graph': [{**article, '@context': 'https://elsewhere.example/'}]},
            'null_node_override': {'@context': 'https://schema.org', '@graph': [{**article, '@context': None}]},
            'unsupported_context_mapping': {**article, '@context': {'@vocab': 'https://elsewhere.example/'}},
        }
        for label, schema in cases.items():
            with self.subTest(label=label):
                data = self.fixtures(m)
                prefix = data[route][3].split('<script type="application/ld+json">')[0]
                data[route] = (200, 'text/html', '', prefix + '<script type="application/ld+json">' + json.dumps(schema) + '</script>')
                result = m.audit(data.__getitem__)
                self.assertEqual(result['status'], 'FAIL')
                self.assertIs(result['pages'][0]['checks']['article_schema'], False)

    def test_article_schema_accepts_current_graph_and_explicit_node_context(self):
        m = self.module(); route = m.ARTICLES[0]
        article = {'@context': 'https://schema.org', '@type': 'Article', 'headline': 'Fixture article', 'mainEntityOfPage': m.ORIGIN + route}
        for schema in (article, [article], {'@context': 'https://schema.org', '@graph': [article]}):
            with self.subTest(schema=schema):
                data = self.fixtures(m)
                prefix = data[route][3].split('<script type="application/ld+json">')[0]
                data[route] = (200, 'text/html', '', prefix + '<script type="application/ld+json">' + json.dumps(schema) + '</script>')
                self.assertEqual(m.audit(data.__getitem__)['status'], 'PASS')

    def test_malformed_schema_fails_with_readable_response_reason(self):
        m = self.module(); data = self.fixtures(m); route = m.ARTICLES[0]
        body = data[route][3].replace('</script>', ', invalid-json-fixture}</script>')
        data[route] = (200, 'text/html', '', body)
        result = m.audit(data.__getitem__)
        self.assertEqual(result['status'], 'FAIL')
        self.assertIs(result['pages'][0]['checks']['readable_response'], False)
        self.assertNotIn('invalid-json-fixture', json.dumps(result))

    def test_live_transport_fixed_target_and_secret_headers_discarded(self):
        m=self.module()
        with self.assertRaises(ValueError):m.fetch('/unexpected?email=anything')
        with self.assertRaises(ValueError):m.fetch('https://elsewhere.example/')
        # Inject response bytes at the network seam, not a real analytics response.
        raw='HTTP/2 200\r\ncontent-type: text/html\r\nset-cookie: must-not-persist\r\nx-robots-tag: noindex\r\n\r\nhello'
        with patch.object(m.subprocess,'run') as run:
            run.return_value.stdout=raw;run.return_value.returncode=0
            self.assertEqual(m.fetch(m.ARTICLES[0]),(200,'text/html','noindex','hello'))
            args=run.call_args.args[0]
            for forbidden in ('--location', '-L', '--cookie', '-b', '--cookie-jar', '-c', '--user', '--data'):
                self.assertNotIn(forbidden, args)
            self.assertIn('--disable',args)
            self.assertIn('--max-filesize',args)
            self.assertNotIn('must-not-persist',json.dumps(m.fetch(m.ARTICLES[0])))

    def test_final_http_status_cannot_be_overwritten_by_body_headers(self):
        m = self.module(); data = self.fixtures(m)
        for status in (404, 302, 200):
            with self.subTest(status=status):
                fake_body = 'HTTP/2 200\r\ncontent-type: application/json\r\n\r\n' + data[m.ARTICLES[0]][3]
                raw = 'HTTP/2 ' + str(status) + '\r\ncontent-type: text/html\r\nx-robots-tag: noindex\r\nset-cookie: must-not-persist\r\n\r\n' + fake_body
                with patch.object(m.subprocess, 'run') as run:
                    run.return_value.stdout = raw; run.return_value.returncode = 0
                    self.assertEqual(m.fetch(m.ARTICLES[0]), (status, 'text/html', 'noindex', fake_body.replace('\r\n', '\n')))

    def test_audit_reports_real_404_even_when_body_impersonates_success(self):
        m = self.module(); data = self.fixtures(m)
        def response(args, **kwargs):
            route = args[-1].removeprefix(m.ORIGIN)
            status, mime, robots, body = data[route]
            raw = 'HTTP/2 200\r\ncontent-type: ' + mime + '\r\n\r\n' + body
            if route == m.ARTICLES[0]:
                raw = 'HTTP/2 404\r\ncontent-type: text/html\r\nset-cookie: must-not-persist\r\n\r\n' + raw
            return CompletedProcess(args, 0, stdout=raw, stderr='')
        with patch.object(m.subprocess, 'run', side_effect=response) as run:
            result = m.audit()
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(result['pages'][0]['http_status'], 404)
            self.assertIs(result['pages'][0]['checks']['http_200'], False)
            self.assertEqual(run.call_count, len(m.ROUTES))
            self.assertNotIn('must-not-persist', json.dumps(result))

    def test_transport_accepts_early_hints_and_explicit_connect_before_final_headers(self):
        m = self.module()
        prefixes = ('HTTP/2 103\r\nlink: </style.css>; rel=preload\r\n\r\n',
                    'HTTP/1.1 200 Connection established\r\n\r\n',
                    'HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 103\r\n\r\n')
        for prefix in prefixes:
            with self.subTest(prefix=prefix), patch.object(m.subprocess, 'run') as run:
                run.return_value.stdout = prefix + 'HTTP/2 200\r\ncontent-type: text/html\r\n\r\nhello'
                run.return_value.returncode = 0
                self.assertEqual(m.fetch(m.ARTICLES[0]), (200, 'text/html', '', 'hello'))

    def test_transport_requires_final_headers_after_early_hints(self):
        m = self.module()
        with patch.object(m.subprocess, 'run') as run:
            run.return_value.stdout = 'HTTP/2 103\r\n\r\nnot a final response'
            run.return_value.returncode = 0
            with self.assertRaises(ValueError):
                m.fetch(m.ARTICLES[0])

    def test_window_is_jst_bounded_and_unknown_observation_is_not_zero(self):
        m=self.module()
        self.assertFalse(m.in_window('2026-09-20'))
        self.assertTrue(m.in_window('2026-09-21'))
        self.assertTrue(m.in_window('2026-10-18'))
        self.assertFalse(m.in_window('2026-10-19'))
        self.assertFalse(m.in_window('2027-09-21'))

    def test_scheduled_main_uses_jst_and_makes_no_http_calls_outside_window(self):
        m = self.module()
        cases = (
            ('2026-09-20T14:59:59+00:00', False),
            ('2026-09-20T15:00:00+00:00', True),
            ('2026-10-18T14:59:59+00:00', True),
            ('2026-10-18T15:00:00+00:00', False),
            ('2027-09-20T15:00:00+00:00', False),
        )
        for instant, active in cases:
            with self.subTest(instant=instant), TemporaryDirectory() as temp:
                dest = Path(temp) / 'scheduled.json'
                out = StringIO()
                utc_now = datetime.fromisoformat(instant).astimezone(timezone.utc)
                with patch('sys.argv', ['check-public-seo.py', '--scheduled', '--output', str(dest)]), \
                        patch.object(m, 'datetime') as clock, patch.object(m, 'audit', return_value={'status': 'PASS'}) as audit, \
                        patch.object(m.subprocess, 'run') as network, redirect_stdout(out):
                    clock.now.side_effect = lambda zone: utc_now.astimezone(zone)
                    self.assertEqual(m.main(), 0)
                    clock.now.assert_called_once_with(m.JST)
                    network.assert_not_called()
                    if active:
                        audit.assert_called_once_with()
                    else:
                        audit.assert_not_called()
                report = json.loads(dest.read_text())
                self.assertEqual(json.loads(out.getvalue()), report)
                self.assertEqual(report['status'], 'PASS' if active else 'NOT_RUN_OUTSIDE_WINDOW')
                self.assertEqual(report['checked_at'], utc_now.astimezone(m.JST).isoformat(timespec='seconds'))

    def test_main_never_persists_or_prints_cookie_headers_bodies_or_provider_errors(self):
        m = self.module(); data = self.fixtures(m)
        for failure in (False, True):
            with self.subTest(failure=failure), TemporaryDirectory() as temp:
                dest = Path(temp) / 'report.json'; out = StringIO(); err = StringIO()
                def response(args, **kwargs):
                    route = args[-1].removeprefix(m.ORIGIN)
                    status, mime, robots, body = data[route]
                    raw = 'HTTP/2 200\r\ncontent-type: ' + mime + '\r\nset-cookie: private-cookie-fixture\r\nx-private: private-header-fixture\r\n\r\n' + body
                    if route in m.ARTICLES:
                        raw += '<p>private-body-fixture</p>'
                    return CompletedProcess(args, int(failure), stdout=raw, stderr='private-provider-error-fixture')
                with patch('sys.argv', ['check-public-seo.py', '--output', str(dest)]), \
                        patch.object(m.subprocess, 'run', side_effect=response) as network, \
                        redirect_stdout(out), redirect_stderr(err):
                    self.assertEqual(m.main(), 1 if failure else 0)
                    self.assertEqual(network.call_count, len(m.ROUTES))
                saved = dest.read_text()
                self.assertEqual(json.loads(saved)['status'], 'FAIL' if failure else 'PASS')
                self.assertEqual(json.loads(out.getvalue()), json.loads(saved))
                for secret in ('private-cookie-fixture', 'private-header-fixture', 'private-body-fixture', 'private-provider-error-fixture'):
                    self.assertNotIn(secret, saved + out.getvalue() + err.getvalue())


if __name__=='__main__':unittest.main()
