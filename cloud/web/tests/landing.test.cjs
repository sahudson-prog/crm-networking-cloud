const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replaceAll('\r\n','\n');

test('existing login and all Auth behavior remain intact apart from anonymous presentation',()=>{
 const baseline=execFileSync('git',['show','6ab1913:cloud/web/components/AuthGate.tsx'],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
 const current=read('components/AuthGate.tsx')
   .replace('export function AuthGate({ children, publicLanding }: { children: ReactNode; publicLanding?: ReactNode }) {','export function AuthGate({ children }: { children: ReactNode }) {')
   .replace('    if (publicLanding) return publicLanding;\n','');
 assert.equal(current,baseline);
});
test('both entry actions target preserved gate; authenticated entry returns to Home only after AuthGate',()=>{
 const landing=read('components/PublicLanding.tsx'),frame=read('components/ApplicationFrame.tsx');
 assert.equal((landing.match(/href="\/ingresar"/g)||[]).length,2);
 assert.match(frame,/privateRoute=\['\/','\/ingresar'/);
 assert.match(frame,/publicLanding=\{path==='\/'\?<PublicLanding\/>:undefined\}/);
 assert.match(read('app/ingresar/page.tsx'),/router.replace\("\/"\)/);
});
test('approved copy and three local real-component captures',()=>{
 const source=read('components/PublicLanding.tsx');
 for(const copy of ['Conseguir pega se hace','tomando cafés.','Nosotros los ordenamos.','café concretado','Coach que te lleva la gestión','Para ir directo al grano.'])assert.ok(source.includes(copy));
 for(const id of ['kanban','coach','inicio']){
   const asset=read(`public/landing/${id}.svg`);
   assert.match(asset,/<foreignObject width="1280" height="700">/);
   assert.doesNotMatch(asset,/<script|<image|<iframe/);
   assert.match(asset,/background: transparent/);
 }
 assert.doesNotMatch(source,/supabase|cloudData|fetch\(|CoachModule|ContactTable/);
 const fixture=read('tests/local/landing-assets.cjs');
 for(const component of ['ContactTable','CoachModule','GamificationPanel','buildGamification','NETWORKING_STATUSES'])assert.ok(fixture.includes(component));
 const gam=read('public/landing/inicio.svg');
 for(const text of ['Tu networking en cifras','Metas de la semana','Racha de networking'])assert.ok(gam.includes(text));
 assert.doesNotMatch(gam, /class="[^"]*home-(chart|pyramid)-block/);
 assert.match(fixture,/No network is allowed/);
});
test('hero compositions isolate real UI without changing production component styles',()=>{
 const css=read('tests/local/landing-compositions.css');
 assert.match(css,/contacts-status-column:nth-child\(n\+4\) \{ display: none; \}/);
 assert.match(css,/\.product-kanban .*transform: scale\(2\)/);
 assert.match(css,/\.product-coach .*transform: scale\(2.2\)/);
 assert.match(css,/\.product-inicio .*width: 940px; transform: scale\(1.3\)/);
 assert.match(css,/\.product-stage .*width: 1280px; height: 700px/);
});
test('landing Coach has a static open smile without changing the real Coach',()=>{
 const mouth='.product-coach .coach-bot-mouth { height: 9px; bottom: 8px; border-radius: 0 0 10px 10px; }';
 assert.ok(read('tests/local/landing-compositions.css').includes(mouth));
 assert.ok(read('public/landing/coach.svg').includes(mouth));
 assert.match(read('styles/components.css'), /\.coach-bot-mouth \{[^}]*height: 2px;/);
});

test('product has its own Swiper, 5 seconds, loop, reduced motion and pause policy',()=>{
 const source=read('components/ProductSlideshow.tsx');
 assert.match(source,/delay: 5000/);
 assert.match(source,/loop=\{multiple\}/);
 assert.match(source,/!p.multiple \|\| p.reduced/);
 assert.match(source,/document.hidden/);
 assert.match(source,/interaction.current.focus = true; swiper.current\?\.keyboard.enable\(\)/);
 assert.match(source,/allowTouchMove=\{multiple\}/);
 assert.match(source,/onTransitionEnd=\{\(\) => syncAutoplay\(\)\}/);
 assert.doesNotMatch(source,/<button|pagination|EditorialFeed/);
 assert.doesNotMatch(source,/setInterval/);
});
test('product has stable media geometry and small-screen constraints',()=>{
 const css=read('styles/landing.css');
 assert.match(css,/aspect-ratio: 1280 \/ 700/);
 assert.match(css,/@media \(max-width: 380px\)/);
 assert.match(css,/grid-template-columns: minmax\(0, 1fr\)/);
 assert.doesNotMatch(css,/\dvw|letter-spacing:\s*-/);
});
