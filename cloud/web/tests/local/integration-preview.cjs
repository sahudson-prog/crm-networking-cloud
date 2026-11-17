// Local review hub: real candidate components, synthetic adapters, no environment files.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-int-preview-'));
const { webpack } = require('next/dist/compiled/webpack/webpack');
const write = (name, content) => fs.writeFileSync(path.join(output, name), content);
const imp = name => JSON.stringify(path.join(root, name).replaceAll('\\', '/'));
const children = [];

function fixture(script, marker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: os.tmpdir(), TMP: os.tmpdir(), NODE_ENV: 'development' }
    });
    children.push(child);
    let text = '';
    child.stdout.on('data', data => {
      text += data;
      const match = text.match(new RegExp(marker + ' (http://127\\.0\\.0\\.1:\\d+)'));
      if (match) resolve(match[1]);
    });
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', reject);
    child.on('exit', code => { if (code) reject(Error(script + ' failed: ' + code)); });
  });
}

async function main() {
  write('loader.cjs', `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(src){if(${process.argv.includes('--trace-product')}&&this.resourcePath.endsWith('ProductSlideshow.tsx'))src=src.replace('swiper.current = value;', 'value.onAny((event,s)=>{if(!["autoplayTimeLeft","setTranslate","setTransition"].includes(event))console.debug("product-event",event,JSON.stringify({index:s.realIndex,animating:s.animating,running:s.autoplay?.running,paused:s.autoplay?.paused}));}); swiper.current = value;');return ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;};`);
  write('transport.ts', `export const supabase=null;export const supabaseConfigError='';`);
  write('navigation.tsx', `import React from 'react';export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>};export const useRouter=()=>({push(url){location.assign(url)},replace(url){location.replace(url)}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`);
  write('entry.tsx', `import React from 'react';import {createRoot} from 'react-dom/client';import {PublicLanding} from ${imp('components/PublicLanding.tsx')};import {AuthGate} from ${imp('components/AuthGate.tsx')};createRoot(document.getElementById('root')).render(<AuthGate publicLanding={location.pathname==='/ingresar'?undefined:<PublicLanding/>}><p>Sin sesión en fixture.</p></AuthGate>);`);
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, context: root, entry: path.join(output, 'entry.tsx'), output: { path: output, filename: 'preview.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js', '.json'], modules: [path.join(root, 'node_modules')] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) }),
        new webpack.NormalModuleReplacementPlugin(/^(next\/link|next\/navigation)$/, path.join(output, 'navigation.tsx')),
        new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/, path.join(output, 'transport.ts'))] });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  const onboarding = await fixture('onboarding-three-step-preview.cjs', 'SYNTHETIC_PREVIEW');
  const home = await fixture('gamification-preview.cjs', 'GAM_SYNTHETIC_PREVIEW');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self'; frame-src 'none'");
    if (url.pathname === '/responsive') {
      const width = Number(url.searchParams.get('width'));
      const surface = url.searchParams.get('surface');
      const targets = { home: `${home}/?scenario=goals`, figures: `${home}/?scenario=figures`, landing: '/' };
      if (![320, 390, 1280].includes(width) || !Object.hasOwn(targets, surface)) { res.writeHead(400); res.end('Invalid local preview'); return; }
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' ${home}`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><title>INT-01 responsive ${width}px</title><body style="margin:0;background:#ddd"><iframe title="Preview ${surface} ${width}px" src="${targets[surface]}" width="${width}" height="1700" style="display:block;border:0;background:white"></iframe></body></html>`); return;
    }
    if (url.pathname === '/review') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>INT-01 · revisión sintética</title><body style="font:16px system-ui;padding:24px"><h1>INT-01</h1><p>Componentes reales del candidato. Datos sintéticos, sin Auth ni Supabase.</p><ul><li><a href="/">Landing</a></li><li><a href="/ingresar">Login (sin transporte ni CAPTCHA)</a></li><li><a href="${onboarding}/?case=owner">Tutorial de tres pasos</a></li><li><a href="${onboarding}/?surface=objectives&case=owner">Objetivos</a></li><li><a href="${onboarding}/?surface=account&case=owner">Campos de Cuenta</a></li><li><a href="${home}/?scenario=goals">Inicio: Ruta, Metas y Novedades</a></li><li><a href="${home}/?scenario=figures">Inicio: Cifras</a></li></ul></body></html>`); return;
    }
    if (url.pathname === '/' || url.pathname === '/ingresar') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>INT-01 · fixture público</title><link rel="stylesheet" href="/app/globals.css"><link rel="stylesheet" href="/swiper.css"><div id="root"></div><script src="/preview.js"></script></html>'); return;
    }
    const file = url.pathname === '/preview.js' ? path.join(output, 'preview.js') : url.pathname === '/swiper.css' ? require.resolve('swiper/css/bundle') :
      /^\/(styles\/[^/]+\.css|app\/globals\.css)$/.test(url.pathname) ? path.join(root, url.pathname.slice(1)) :
      /^\/(brand|landing)\/[\w-]+\.(svg|webp)$/.test(url.pathname) ? path.join(root, 'public', url.pathname) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('Fuera del fixture. No se realizan solicitudes remotas.'); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webp') ? 'image/webp' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  const port = Number(process.argv[2] || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid preview port');
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ preview: `http://127.0.0.1:${server.address().port}/review`, onboarding, home, pid: process.pid })));
}
process.on('exit', () => { for (const child of children) child.kill(); });
main().catch(error => { console.error(error.message); process.exit(1); });
