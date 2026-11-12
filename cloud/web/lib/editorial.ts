import sanitizeHtml from "sanitize-html";
import postcss from "postcss";
import { parse } from "csv-parse/sync";

export type EditorialSlide = { id: string; order: number; start: number | null; end: number | null; srcdoc: string };
export const EDITORIAL_MAX_BYTES = 512 * 1024;
export const EDITORIAL_MAX_SLIDES = 30;
const properties = new Set("color background background-color background-image font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform white-space overflow-wrap word-break display flex flex-direction flex-wrap align-items justify-content gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left border border-width border-style border-color border-radius box-shadow width max-width min-width height min-height max-height box-sizing opacity fill stroke stroke-width".split(" "));
const functions = new Set(['rgb','rgba','hsl','hsla','linear-gradient','radial-gradient','repeating-linear-gradient','min','max','clamp','calc','repeat','minmax']);
export function cleanEditorialCss(css: string, inline = false): string {
  try {
    const root = postcss.parse(inline ? `x{${css}}` : css);
    // Reconstruct from parsed nodes: never emit raw input/comments/unknown at-rules.
    const rules: string[] = [];
    for (const rule of root.nodes) {
      if (rule.type !== 'rule' || !/^[a-zA-Z0-9_.#\s,>*:+()-]+$/.test(rule.selector)) continue;
      const declarations: string[] = [];
      for (const node of rule.nodes) {
        if (node.type !== 'decl' || !properties.has(node.prop.toLowerCase())) continue;
        const v = node.value;
        if (!/^[a-zA-Z0-9\s#.,%()+*/'"_-]+$/.test(v) || /url|expression|image-set|attr\s*\(|var\s*\(/i.test(v)) continue;
        if ([...v.matchAll(/([a-zA-Z-]+)\s*\(/g)].some(m=>!functions.has(m[1].toLowerCase()))) continue;
        declarations.push(`${node.prop.toLowerCase()}:${v}`);
      }
      if (declarations.length) rules.push(inline ? declarations.join(';') : `${rule.selector}{${declarations.join(';')}}`);
    }
    return rules.join('\n');
  } catch { return ''; }
}
export function safeEditorialLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    let path=url.pathname;
    for(let i=0;i<3&&/%[0-9a-f]{2}/i.test(path);i++)path=decodeURIComponent(path);
    if(/%[0-9a-f]{2}/i.test(path))return;
    if(url.protocol !== 'https:' || url.username || url.password || /(?:auth|oauth|login|signin|callback|authorize)/i.test(path) || [...url.searchParams.keys()].some(k=>/token|code|redirect|secret|key/i.test(k))) return;
    return url.href;
  } catch { return; }
}
export function editorialDocument(html: string): string | null {
  if (!html.trim() || Buffer.byteLength(html,'utf8') > 64000) return null;
  const tags = ['div','section','article','header','footer','p','h1','h2','h3','h4','span','strong','em','b','i','ul','ol','li','br','hr','a','style','svg','g','path','circle','ellipse','rect','line','polyline','polygon','text','title','desc'];
  const svgTags = new Set(['svg','g','path','circle','ellipse','rect','line','polyline','polygon','text']);
  const styles:string[]=[];
  const cleaned = sanitizeHtml(html, {
    exclusiveFilter: frame=>{if(frame.tag!=="style")return false;styles.push(cleanEditorialCss(frame.text));return true;},
    allowedTags: tags, allowVulnerableTags: true,
    allowedAttributes: { '*':['class','id','style','title','aria-label','role'], a:['href','target','rel'], svg:['viewBox','width','height','role','aria-label'], g:['fill','stroke'], path:['d','fill','stroke','stroke-width'], circle:['cx','cy','r','fill','stroke'], ellipse:['cx','cy','rx','ry','fill'], rect:['x','y','width','height','rx','fill'], line:['x1','y1','x2','y2','stroke','stroke-width'], polyline:['points','fill','stroke'], polygon:['points','fill','stroke'], text:['x','y','fill','font-size','text-anchor'] },
    parser: { lowerCaseAttributeNames: false }, allowedSchemes:['https'], allowProtocolRelative:false, parseStyleAttributes:false,
    transformTags: { '*': (tag, attrs) => {
      const a = {...attrs};
      if(a.style) a.style=cleanEditorialCss(a.style,true);
      if(tag==='a') { const href=safeEditorialLink(a.href||''); if(href) a.href=href; else delete a.href; a.target='_blank';a.rel='noopener noreferrer'; }
      if(svgTags.has(tag)) for(const [k,v] of Object.entries(a)) {
        if(['class','id','style','role','aria-label','title'].includes(k)) continue;
        if(!/^[a-zA-Z0-9#.,\s+-]+$/.test(v)) delete a[k];
      }
      return {tagName:tag,attribs:a};
    } },
    textFilter: (text, tag) => tag==='style' ? cleanEditorialCss(text) : text
  });
  if (!sanitizeHtml(cleaned,{allowedTags:[],allowedAttributes:{}}).trim() && !cleaned.includes('<svg')) return null;
  const csp="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html{box-sizing:border-box;height:100%;overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain}*,*:before,*:after{box-sizing:inherit}body{margin:0;min-height:100%;overscroll-behavior-y:contain;color:#3B261B;background:#FFFDFB;font-family:system-ui,sans-serif;overflow-wrap:anywhere}main{min-height:100vh;padding:20px 20px 60px}main,main *{max-width:100%!important;min-width:0!important;overflow-wrap:anywhere!important;white-space:normal!important}svg{max-width:100%;height:auto}a{color:#633d28;text-decoration:underline}a:focus-visible{outline:3px solid #3B261B;outline-offset:3px}h1,h2,h3,p{max-width:100%}</style></head><body><main><style>${styles.join("\n")}</style>${cleaned}</main></body></html>`;
}
const headers=['id','orden','activo','fecha_inicio','fecha_fin','contenido_html','roles_permitidos'];
function instant(value: string): number | null {
  if(!value) return null;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw Error('date');
  const n=Date.parse(value); if(!Number.isFinite(n)||new Date(n).toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))throw Error('date'); return n;
}
export function parseEditorialCsv(csv:string): { slides:EditorialSlide[]; invalidRows:number } {
  const rows = parse(csv,{bom:true,skip_empty_lines:true,max_record_size:80000}) as string[][];
  if(!rows.length) return {slides:[],invalidRows:0};
  const cols=rows.shift()!.map(c=>c.trim());
  if(new Set(cols).size!==cols.length || headers.some(h=>!cols.includes(h))||rows.length>500)throw Error('Invalid editorial schema');
  const index=(h:string)=>cols.indexOf(h);
  const counts=new Map<string,number>(); for(const row of rows){const id=row[index('id')]?.trim();if(id)counts.set(id,(counts.get(id)||0)+1);}
  let invalidRows=0; const slides:EditorialSlide[]=[];
  for(const row of rows) try {
    const v=(h:string)=>row[index(h)]?.trim()??'';
    const id=v('id'), active=v('activo').toLowerCase();
    if(row.length!==cols.length || !id || id.length>100 || counts.get(id)!==1 || !/^-?\d+$/.test(v('orden')) || !Number.isSafeInteger(Number(v('orden'))) || !['sí','si','true','no','false'].includes(active))throw Error('row');
    const start=instant(v('fecha_inicio')),end=instant(v('fecha_fin')); if(start!==null&&end!==null&&start>end)throw Error('range');
    // roles_permitidos is deliberately ignored. Every V1 slide is public.
    if(['no','false'].includes(active))continue;
    const srcdoc=editorialDocument(v('contenido_html'));if(!srcdoc)throw Error('html');
    slides.push({id,order:Number(v('orden')),start,end,srcdoc});
  } catch {invalidRows++;}
  slides.sort((a,b)=>a.order-b.order||(a.id<b.id?-1:a.id>b.id?1:0));
  return {slides,invalidRows};
}
export function currentEditorialSlides(slides:EditorialSlide[],now=Date.now()) {
  return slides.filter(s=>(s.start===null||s.start<=now)&&(s.end===null||now<=s.end)).slice(0,EDITORIAL_MAX_SLIDES);
}
function validEditorialQuery(url: URL): boolean {
  const keys = [...url.searchParams.keys()];
  return new Set(keys).size === keys.length && keys.every(k => ['output', 'gid', 'single'].includes(k))
    && url.searchParams.get('output') === 'csv'
    && (!url.searchParams.has('gid') || /^\d+$/.test(url.searchParams.get('gid')!))
    && (!url.searchParams.has('single') || /^(true|false)$/.test(url.searchParams.get('single')!));
}
function publicHttps(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash;
}
export function validateEditorialSource(source:string):string {
  const url=new URL(source);
  if(!publicHttps(url)||url.hostname!=='docs.google.com'||!/^\/spreadsheets\/d\/e\/[a-zA-Z0-9_-]+\/pub$/.test(url.pathname)||!validEditorialQuery(url))throw Error('Invalid editorial source');
  return url.href;
}
// Only the exact publication host observed in the authorized public GET is allowed.
// A different Google shard must be verified explicitly; never trust a suffix wildcard.
const EDITORIAL_PUBLICATION_HOST = 'doc-0s-34-sheets.googleusercontent.com';
const EDITORIAL_MAX_REDIRECTS = 1;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
function validateEditorialRedirect(location: string, source: string): string {
  const initial = new URL(source), target = new URL(location, initial);
  const publicationId = initial.pathname.split('/')[4];
  const path = /^\/pub\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/\d+\/\d+\/\*\/e@([a-zA-Z0-9_-]+)$/.exec(target.pathname);
  if(!publicHttps(target) || target.hostname !== EDITORIAL_PUBLICATION_HOST || !path || path[1] !== publicationId
    || !validEditorialQuery(target) || [...initial.searchParams.keys()].length !== [...target.searchParams.keys()].length
    || [...initial.searchParams].some(([key, value]) => target.searchParams.get(key) !== value))throw Error('Invalid editorial redirect');
  return target.href;
}
export async function readEditorialSource(source:string,fetcher:typeof fetch=fetch):Promise<{slides:EditorialSlide[];status:'ready'|'error';invalidRows:number}> {
  try {
    const initial=validateEditorialSource(source);
    let url=initial;
    // One deadline covers both requests and the final bounded body read.
    const signal=AbortSignal.timeout(5000);
    let response:Response;
    for(let redirects=0;;redirects++) {
      signal.throwIfAborted();
      response=await fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal,headers:{Accept:'text/csv'}});
      if(response.redirected) {await response.body?.cancel();throw Error('Automatic redirect');}
      if(!redirectStatuses.has(response.status))break;
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(redirects>=EDITORIAL_MAX_REDIRECTS || !location)throw Error('Redirect limit or missing location');
      url=validateEditorialRedirect(location,initial);
    }
    if(!response.ok || !/^text\/(csv|plain)(?:\s*;|$)/i.test(response.headers.get('content-type')||'') || Number(response.headers.get('content-length')||0)>EDITORIAL_MAX_BYTES || !response.body) {
      await response.body?.cancel();throw Error('response');
    }
    const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let bytes=0;
    try {while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>EDITORIAL_MAX_BYTES)throw Error('size');chunks.push(value);}}finally{await reader.cancel();}
    const parsed=parseEditorialCsv(Buffer.concat(chunks).toString('utf8'));
    return {...parsed,status:'ready'};
  }catch{return {slides:[],invalidRows:0,status:'error'};}
}
