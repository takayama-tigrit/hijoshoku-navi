"""Complete confirmed publication coverage plus isolated draft-exclusion fixture."""
import importlib.util, json, os, re, shutil, subprocess, tempfile, sys
from pathlib import Path
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
editorial_confirmation=load('editorial_confirmation')
editorial_style=load('editorial_style')
editorial_confirmation.verify()
manifest=json.loads((ROOT/'docs/reviews/editorial-11-manifest.json').read_text())
assert manifest['human_review']=='confirmed_no_changes'
content12_confirmation=load('content12_confirmation')
content12_confirmation.verify()
additional=json.loads((ROOT/'docs/reviews/content-12-human-proofreading.json').read_text())
articles=manifest['articles']+additional['articles']
expected={a['target'] for a in articles}
utility={'content/about/index.md','content/privacy/index.md','content/photo-credits/index.md'}
public={str(p.relative_to(ROOT)) for p in (ROOT/'content').rglob('*.md') if p.name!='_index.md' and str(p.relative_to(ROOT)) not in utility and not re.search(r'^draft: true$',p.read_text(),re.M)}
assert expected==public, 'exact published article coverage'
assert not (ROOT/'content/revisions').exists(), 'review snapshots must not become duplicate articles'
def route(a):
    p=Path(a['target']).relative_to('content')
    return '/'+str(p.parent if p.name=='index.md' else p.with_suffix(''))+'/'
routes={route(a) for a in articles}
with tempfile.TemporaryDirectory(prefix='editorial-batch-') as temp:
    tmp=Path(temp); source=tmp/'source'; source.mkdir()
    for folder in ['content','layouts','assets','themes','static','data','docs']:
        shutil.copytree(ROOT/folder,source/folder)
    shutil.copy2(ROOT/'hugo.toml',source/'hugo.toml')
    def build(dest,drafts=False):
        cmd=[os.environ.get('HUGO_BIN','hugo'),'--source',str(source),'--destination',str(dest),'--environment','production','--minify','--panicOnWarning']
        if drafts:cmd+=['--buildDrafts']
        subprocess.run(cmd,env=dict(os.environ,CF_PAGES_BRANCH='main'),check=True,stdout=subprocess.DEVNULL)
    build(tmp/'normal')
    def sitemap(dest):
        return {x.text for x in ET.parse(dest/'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc') if x.text}
    normal_urls=sitemap(tmp/'normal')
    assert {x for x in normal_urls if '/posts/' in x and x!='https://hijoshoku-navi.com/posts/'} == {'https://hijoshoku-navi.com'+r for r in routes if r.startswith('/posts/')}, 'exact normal post URL set'
    findings=[]
    for a in articles:
        r=route(a); page=tmp/'normal'/r.lstrip('/')/'index.html'
        assert page.exists() and 'https://hijoshoku-navi.com'+r in normal_urls
        assert r in (tmp/'normal/index.html').read_text()
        assert not [x for x in editorial_style.scan(editorial_style.source_text((ROOT/a['target']).read_text())) if x['severity']=='error']
        findings += [{'article':r,**x} for x in editorial_style.scan(editorial_style.html_text(page.read_text()))]
        p=source/a['target'];p.write_bytes(p.read_bytes().replace(b'\ndraft: false\n',b'\ndraft: true\n'))
    assert not [x for x in findings if x['severity']=='error'], findings
    build(tmp/'excluded');build(tmp/'drafts',True)
    for r in routes:
        assert not (tmp/'excluded'/r.lstrip('/')/'index.html').exists(), 'draft HTML leaked'
        assert (tmp/'drafts'/r.lstrip('/')/'index.html').exists(), 'buildDrafts missing page'
        assert 'https://hijoshoku-navi.com'+r not in sitemap(tmp/'excluded'), 'draft sitemap leaked'
        for rel in ['index.html','posts/index.html','index.xml','posts/index.xml','index.json']:
            p=tmp/'excluded'/rel
            if p.exists():
                text=p.read_text()
                if rel.endswith('.html'):
                    # Static nav may retain guide/ranking links; article cards must not.
                    text=''.join(re.findall(r'<article\b[^>]*>.*?</article>',text,re.S))
                assert r not in text, ('draft listing/feed leaked',rel,r)
    print(json.dumps({'articles':len(public),'normal_routes':sorted(routes),'draft_isolation':'PASS','rendered_style_findings':findings},ensure_ascii=False))
print('PASS complete confirmed editorial batch; lexical checks are not a naturalness score')
