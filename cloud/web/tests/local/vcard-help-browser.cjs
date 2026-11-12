// Synthetic mounted help, no env, credentials or external transport.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const root = path.resolve(__dirname, '../..');
const { webpack } = require(path.join(root, 'node_modules/next/dist/compiled/webpack/webpack'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-vcard-help-'));
let server, browser;
async function main() {
  const component = fs.readFileSync(path.join(root, 'components/VCardHelp.tsx'), 'utf8');
  assert.doesNotMatch(component, /supabase|fetch\(|moveTo\(|localStorage|sessionStorage/);
  assert.match(fs.readFileSync(path.join(root, 'components/OnboardingRoutePage.tsx'), 'utf8'), /Empieza importando tus contactos y, después/);
  assert.match(fs.readFileSync(path.join(root, 'components/ContactImportDialog.tsx'), 'utf8'), /sourceHelp=\{<VCardHelp inline \/>\}/);
  fs.writeFileSync(path.join(out, 'loader.cjs'), `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  fs.writeFileSync(path.join(out, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {VCardHelp} from ${JSON.stringify(path.join(root, 'components/VCardHelp').replaceAll('\\','/'))};createRoot(document.getElementById('root')).render(<main className="app-shell"><section className="panel"><h2>Comienza con tus contactos.</h2><VCardHelp onboarding/></section><section className="panel"><h2>Contactos</h2><div className="vcard-source-title"><strong>vCard (.vcf)</strong><VCardHelp/></div></section></main>);`);
  await new Promise((resolve, reject) => {
    const compiler = webpack({mode:'development',devtool:false,context:root,entry:path.join(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(out,'loader.cjs')]}]}});
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({all:false,errors:true}))) : resolve()));
  });
  server = http.createServer((req,res) => {
    const assets = {'/bundle.js':path.join(out,'bundle.js'),'/app/globals.css':path.join(root,'app/globals.css')};
    for(const name of ['tokens','components','invitations','tracking']) assets[`/styles/${name}.css`]=path.join(root,`styles/${name}.css`);
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'");
    if(assets[req.url]) {res.setHeader('Content-Type', req.url.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(assets[req.url]));return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const {chromium} = require(process.env.VCARD_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage();
  const errors=[], external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{if(new URL(r.request().url()).origin!==url){external.push(r.request().url());return r.abort();}return r.continue();});
  for(const width of [320,375,1280]) {
    await page.setViewportSize({width,height:900});await page.goto(url);
    for(const [label,tab] of [['Google','Google'],['Apple','iCloud'],['Samsung','Samsung'],['(cómo?)','Google']]) {
      const trigger=page.getByRole('button',{name:label,exact:true});await trigger.click();
      const dialog=page.getByRole('dialog');await dialog.waitFor();
      assert.equal(await page.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true');
      for(const provider of ['Google','iCloud','iPhone','Samsung']) {
        await page.getByRole('tab',{name:provider,exact:true}).click();
        assert.equal(await dialog.locator('li').count(),4);
        assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
        await page.waitForTimeout(250);
        await page.screenshot({path:path.join(out,`${width}-${provider}.png`)});
      }
      await page.getByRole('tab',{name:'Samsung',exact:true}).press('Home');
      assert.equal(await page.getByRole('tab',{name:'Google',exact:true}).getAttribute('aria-selected'),'true');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab',{name:'iCloud',exact:true}).getAttribute('aria-selected'),'true');
      const link=dialog.locator('a');assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
      for(let i=0;i<10;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
      if(label==='Google') await page.getByRole('button',{name:'Cerrar ayuda',exact:true}).click();
      else if(label==='Apple') await page.getByRole('button',{name:'Entendido',exact:true}).click();
      else await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(),0);
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      assert.equal(page.url(),url+'/');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(`PASS: 12 entry/viewport flows, 48 tab checks, close/focus/keyboard/no transport. Screenshots: ${out}`);
  if(process.argv.includes('--serve')) {await browser.close();browser=null;console.log(`PREVIEW ${url}`);return;}
  await browser.close();browser=null;server.close();
}
main().catch(async e=>{console.error(e);await browser?.close();server?.close();process.exitCode=1;});
