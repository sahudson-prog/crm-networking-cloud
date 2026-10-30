// Standard npm build in an isolated copy: never load the worktree's real .env.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-opportunities-build-'));
try {
  const source = path.join(temp, 'web');
  fs.cpSync(root, source, {recursive:true, filter:file=>{
    const parts = path.relative(root,file).split(path.sep);
    return !parts.some(part=>part==='.next'||part==='.git'||part.startsWith('.env')||part==='tsconfig.tsbuildinfo');
  }});
  const cachedFont = fs.readdirSync(path.join(root,'.next/static/media')).find(file=>file.endsWith('.woff2'));
  if(!cachedFont)throw new Error('Local font fixture missing; no Google request authorized');
  const font = path.join(temp,'fixture.woff2');
  fs.copyFileSync(path.join(root,'.next/static/media',cachedFont),font);
  const fontPath=font.replaceAll('\\','/').replace(/^[A-Za-z]:/,'');
  const css=`/* latin */\n@font-face {font-family:'Lato';font-style:normal;font-weight:900;font-display:swap;src:url(${fontPath}) format('woff2');}`;
  const mock = path.join(temp,'fonts.cjs');
  fs.writeFileSync(mock,`module.exports=${JSON.stringify({'https://fonts.googleapis.com/css2?family=Lato:wght@900&display=swap':css})};`);
  const env={};
  for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','Path','PATHEXT','TEMP','TMP','COMSPEC','ComSpec','LOCALAPPDATA']) {
    if(process.env[key])env[key]=process.env[key];
  }
  Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_local_only',NEXT_PUBLIC_ICS_IMPORT_ENABLED:'false',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES:mock});
  console.log('Build: isolated source/dependencies copy, synthetic config, cached font fixture; no .env copied.');
  const result=spawnSync(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/s','/c','npm run build']:['run','build'],
    {cwd:source,env,stdio:'inherit',timeout:300000});
  if(result.error)throw result.error;
  if(result.status!==0)process.exitCode=result.status||1;
  else console.log('PASS standard npm build (font download replaced by local fixture; external delivery not certified)');
} finally {
  const target=path.resolve(temp);
  if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('coffeecito-opportunities-build-'))throw new Error('Unsafe cleanup target');
  fs.rmSync(target,{recursive:true,force:true});
}
