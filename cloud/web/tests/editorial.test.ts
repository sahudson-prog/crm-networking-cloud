import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEditorialCsv,currentEditorialSlides,editorialDocument,cleanEditorialCss,safeEditorialLink,validateEditorialSource,readEditorialSource,EDITORIAL_MAX_BYTES} from '../lib/editorial.ts';
const columns=['id','orden','activo','fecha_inicio','fecha_fin','contenido_html','roles_permitidos'];
const cell=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const csv=(rows:string[][],headers=columns)=>[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');
const row=(id='one',html='<h2>Café, "conversación"</h2>\n<p>Una señal útil.</p>')=>[id,'1','Sí','','',html,'admin'];
test('CSV quoted multiline Unicode; headers recognized by name; roles are inert',()=>{
 const input=row(); const reverse=[...columns].reverse();const parsed=parseEditorialCsv(csv([[...input].reverse()],reverse));
 assert.equal(parsed.invalidRows,0);assert.equal(parsed.slides.length,1);assert.match(parsed.slides[0].srcdoc,/Café, "conversación"/);assert.equal(parsed.slides[0].id,'one');
});
test('active, UTC inclusive dates, duplicate identities, ordering, invalid ranges and cap',()=>{
 const a=row('a'),b=row('b'),c=row('c');a[1]='2';b[1]='1';b[2]='FALSE';c[1]='1';c[3]='2026-11-11T00:00:00Z';c[4]='2026-11-12T00:00:00Z';
 const bad=row('bad');bad[3]='2026-02-30T00:00:00Z';const dup=row('duplicate');
 const result=parseEditorialCsv(csv([a,b,c,bad,dup,dup]));assert.equal(result.invalidRows,3);assert.deepEqual(result.slides.map(s=>s.id),['c','a']);
 assert.equal(currentEditorialSlides(result.slides,Date.parse(c[3])).length,2);assert.equal(currentEditorialSlides(result.slides,Date.parse(c[4])).length,2);assert.equal(currentEditorialSlides(result.slides,Date.parse(c[4])+1).length,1);
 assert.equal(currentEditorialSlides(parseEditorialCsv(csv(Array.from({length:40},(_,i)=>row(String(i))))).slides).length,30);
});
test('HTML sanitizer neutralizes scripts, handlers, embeds, forms, external SVG and unsafe links',()=>{
 const html=editorialDocument(`<script>parent.document.cookie</script><p onclick="evil()">Safe</p><img src="https://evil.test/x" onerror="evil()"><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input></form><a href="javascript:evil()">unsafe</a><svg viewBox="0 0 20 20"><use href="https://evil.test/s.svg"/><circle r="5" fill="url(https://evil.test)"/><path d="M0 0 L10 10"/></svg>`)!;
 assert.doesNotMatch(html,/<script|onclick|onerror|<img|<iframe|<form|<input|<use|javascript:|evil\.test/);assert.match(html,/<svg viewBox="0 0 20 20">/);assert.match(html,/<path/);assert.match(html,/script-src 'none'/);
});
test('PostCSS reconstruction rejects imports, fonts, escaped URLs, expressions and remote resources',()=>{
 const css=cleanEditorialCss('@import "https://evil.test"; @font-face{src:url(https://evil.test)} .slide{color:#3B261B;background:linear-gradient(90deg,#fff,#eee);font-family:system-ui;background-image:u\\72l(https://evil.test);width:expression(evil());--unsafe:url(x)}');
 assert.match(css,/linear-gradient/);assert.match(css,/color:#3B261B/);assert.doesNotMatch(css,/@import|font-face|evil|unsafe|expression|url/);
 const html=editorialDocument('<style>.slide{background:url(https://evil.test);color:red}</style><p class="slide" style="background:url(https://evil.test);color:blue">Safe</p>')!;
 assert.doesNotMatch(html,/evil\.test/);assert.match(html,/color:blue/);
 assert.equal(cleanEditorialCss('.broken{'), '');
});
test('links remain explicit https with noopener; auth routes and credentials rejected',()=>{
 for(const v of ['javascript:alert(1)','data:text/html,x','//evil.test','https://x.test/oauth/authorize','https://x.test/%6fauth/authorize','https://x.test/%256fauth/','https://user:pass@x.test','https://x.test/?token=x'])assert.equal(safeEditorialLink(v),undefined);
 const html=editorialDocument('<a href="https://example.org/news">Leer</a>')!;assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);
});
const source='https://docs.google.com/spreadsheets/d/e/synthetic/pub?output=csv';
test('source allowlist blocks SSRF, alternate ports, paths, queries and formats before fetch',async()=>{
 for(const url of ['http://127.0.0.1/','https://docs.google.com.evil.test/spreadsheets/d/e/x/pub?output=csv','https://docs.google.com:444/spreadsheets/d/e/x/pub?output=csv','https://docs.google.com/spreadsheets/d/x/edit','https://docs.google.com/spreadsheets/d/e/x/pub?output=csv&url=https://evil.test']){
  assert.throws(()=>validateEditorialSource(url));const result=await readEditorialSource(url,(()=>{throw Error('must not fetch');}) as typeof fetch);assert.equal(result.status,'error');
 }
});
test('safe reader: success, errors, redirects, content type and bounded stream',async()=>{
 const mock=(response:Response)=>(async(_url:any,init:any)=>{assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.ok(init.signal);return response;}) as typeof fetch;
 assert.equal((await readEditorialSource(source,mock(new Response(csv([row()]),{headers:{'content-type':'text/csv'}})))).slides.length,1);
 for(const response of [new Response('',{status:302,headers:{location:'https://evil.test'}}),new Response('<html>bad</html>',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(EDITORIAL_MAX_BYTES+1),{headers:{'content-type':'text/csv'}})])assert.equal((await readEditorialSource(source,mock(response))).status,'error');
 assert.equal((await readEditorialSource(source,(async()=>{throw Error('network');}) as typeof fetch)).status,'error');
});

const publicationHost='doc-0s-34-sheets.googleusercontent.com';
const download=`https://${publicationHost}/pub/publicA/publicB/1794438480000/123456789/*/e@synthetic?output=csv`;
const redirect=(location:string,status=307)=>new Response('',{status,headers:{location,'set-cookie':'unused=synthetic; Secure'}});
const csvResponse=()=>new Response(csv([row('one'),row('two')]),{headers:{'content-type':'text/csv; charset=utf-8'}});

test('verified publication redirect: manual GET, same deadline, no forwarded cookies/auth, two sanitized slides',async()=>{
 for(const status of [301,302,303,307,308]){
  const seen:string[]=[];const signals:AbortSignal[]=[];const first=redirect(download,status);
  const result=await readEditorialSource(source,(async(url:any,init:any)=>{
   seen.push(String(url));signals.push(init.signal);
   assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');
   assert.deepEqual(init.headers,{Accept:'text/csv'});assert.equal(init.body,undefined);
   return seen.length===1?first:csvResponse();
  }) as typeof fetch);
  assert.deepEqual(seen,[source,download]);assert.equal(signals[0],signals[1]);assert.equal(first.bodyUsed,true);
  assert.equal(result.status,'ready');assert.equal(result.invalidRows,0);assert.equal(currentEditorialSlides(result.slides).length,2);assert.match(result.slides[0].srcdoc,/script-src 'none'/);
 }
});

test('redirect host/path/query allowlist rejects malicious targets before a second request',async()=>{
 const bad=[
  'https://evil.test/csv','http://'+publicationHost+'/pub/file',
  download.replace(publicationHost,'googleusercontent.com'),download.replace(publicationHost,'other-sheets.googleusercontent.com'),
  download.replace(publicationHost,'doc-99-99-sheets.googleusercontent.com'),download.replace(publicationHost,publicationHost+'.evil.test'),
  download.replace(publicationHost,publicationHost+'.'),download.replace(publicationHost,publicationHost+':444'),
  download.replace(publicationHost,'user:pass@'+publicationHost),download.replace(publicationHost,publicationHost+'@evil.test'),
  ...['127.0.0.1','2130706433','0x7f000001','10.0.0.1','169.254.169.254','[::1]','[::ffff:127.0.0.1]','[fc00::1]','localhost'].map(host=>download.replace(publicationHost,host)),
  '//evil.test/file','file:///etc/passwd','data:text/csv,anything','javascript:alert(1)',
  download.replace('/pub/','/other/'),download.replace('/pub/','/pub/../'),download.replace('e@synthetic','e@anotherPublication'),
  download.replace('e@synthetic','e%40synthetic'),download+'#fragment',download+'&output=csv',download+'&url=https://evil.test',
  download+'&gid=1',download+'&single=true',download.replace('output=csv','output=html'),source
 ];
 for(const target of bad){let calls=0;const first=redirect(target);const result=await readEditorialSource(source,(async()=>{calls++;assert.equal(calls,1,'must not follow: '+target);return first;}) as typeof fetch);assert.equal(result.status,'error',target);assert.equal(calls,1);assert.equal(first.bodyUsed,true);}
});

test('initial URL remains docs.google.com only, with unique and well-formed publication parameters',async()=>{
 for(const url of [download,source+'&output=csv',source+'&gid=abc',source+'&single=yes',source+'#fragment',source.replace('docs.google.com','user:pass@docs.google.com')]){
  let calls=0;const result=await readEditorialSource(url,(async()=>{calls++;return csvResponse();}) as typeof fetch);assert.equal(calls,0);assert.equal(result.status,'error');
 }
 const full=source+'&gid=0&single=true',target=download+'&single=true&gid=0';let calls=0;
 assert.equal((await readEditorialSource(full,(async()=>++calls===1?redirect(target):csvResponse()) as typeof fetch)).slides.length,2);
});

test('redirect cap, missing Location and silently auto-followed responses fail closed',async()=>{
 for(const second of [source,download]){let calls=0;const result=await readEditorialSource(source,(async()=>{calls++;assert.ok(calls<=2);return redirect(calls===1?download:second);}) as typeof fetch);assert.equal(result.status,'error');assert.equal(calls,2);}
 assert.equal((await readEditorialSource(source,(async()=>new Response('',{status:307})) as typeof fetch)).status,'error');
 const followed=csvResponse();Object.defineProperty(followed,'redirected',{value:true});
 assert.equal((await readEditorialSource(source,(async()=>followed) as typeof fetch)).status,'error');
});

test('redirected response retains content and size limits, including streaming without Content-Length',async()=>{
 const overflow=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(EDITORIAL_MAX_BYTES));controller.enqueue(new Uint8Array(1));controller.close();}});
 for(const last of [new Response('x',{status:503}),new Response('<html/>',{headers:{'content-type':'text/html'}}),new Response('x',{headers:{'content-type':'text/csv-evil'}}),new Response('x',{headers:{'content-type':'text/csv','content-length':String(EDITORIAL_MAX_BYTES+1)}}),new Response(overflow,{headers:{'content-type':'text/csv'}})]){
  let calls=0;assert.equal((await readEditorialSource(source,(async()=>++calls===1?redirect(download):last) as typeof fetch)).status,'error');assert.equal(calls,2);assert.equal(last.bodyUsed,true);
 }
});

test('five-second budget is created once and is not reset by a redirect',async(t)=>{
 const controller=new AbortController();let timeouts=0,calls=0;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,5000);timeouts++;return controller.signal;});
 const last=csvResponse();const result=await readEditorialSource(source,(async(_url:any,init:any)=>{
  assert.equal(init.signal,controller.signal);calls++;if(calls===1)return redirect(download);
  controller.abort(new DOMException('Timed out','TimeoutError'));return last;
 }) as typeof fetch);
 assert.equal(timeouts,1);assert.equal(calls,2);assert.equal(result.status,'error');assert.equal(last.bodyUsed,true);
});