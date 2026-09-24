import {execFileSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
// Exercise the reviewed SEO browser contract against a fresh NORMAL production build.
// The source confirmation gate is a separate required npm check, never bypassed here.
const work=await mkdtemp(path.join(tmpdir(),'seo-demand-public-'));
const output=path.join(work,'public');
execFileSync(process.env.HUGO_BIN||'hugo',['--destination',output,'--cacheDir',path.join(work,'cache'),'--environment','production','--baseURL','https://hijoshoku-navi.com/','--minify','--panicOnWarning'],{stdio:'inherit',env:{...process.env,CF_PAGES_BRANCH:'main'}});
process.env.SEO_OUTPUT=output;
process.env.ARTIFACT_DIR=path.join(process.env.ARTIFACT_DIR||work,'seo-demand');
await import('./seo-demand-browser.spec.mjs');
