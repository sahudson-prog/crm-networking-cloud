// Production components with isolated readers/writers; never connects to Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-redesign-'));
const write = (name, value) => fs.writeFileSync(path.join(out, name), value);
const imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
let browser, server;
async function main() {
  write('loader.cjs', `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  write('stubs.tsx', `
export const useRouter=()=>({replace(){}});export const useWorkspace=()=>({setProfile(){}});
export const CoachModule=()=>null;export const ContactDataSyncButton=()=>null;export const ReferralEditorDialog=()=>null;
export const ContactDeactivationButton=()=>null;export const ContactDeactivationConfirmDialog=()=>null;
export const readHeadhunterCompanyMaster=async()=>[];export const readAllActiveContacts=async()=>[];
export const readGoogleOAuthOperationEligibility=async()=>false;
export const normalizeHeadhunterCompanyName=x=>x.trim().toLowerCase();
export const contactToEditorInput=c=>({displayName:c.display_name,company:c.company,role:c.role,networkingFocus:c.networking_focus,isHeadhunter:c.is_headhunter,phones:(c.contact_phones||[]).map(row=>row.phone)});
export const normalizeEmail=x=>x.trim().toLowerCase();export const isValidEmail=x=>/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(x);
export {isValidPhone} from ${imp('lib/phoneValidation.ts')};
export async function saveContactFromEditor(input){window.fixture.saves.push(input);return {contactId:'created'};}
export const deactivateContacts=async()=>{};export const updateContactFlags=async()=>{};export const updateContactNetworkingStatus=async()=>{};
export const dismissReferrals=async()=>{};export const dismissInteraction=async()=>{};
export async function saveInteractionFromEditor(input){window.fixture.interactions.push(input);}
export const OBJECTIVE_TYPES=[{value:'industry',label:'Industria'}];export const objectivePriorityLabel=x=>x;export const objectiveTypeLabel=x=>'Industria';
export const readObjectives=async()=>{if(window.fixture.failRead)throw Error('simulated read');return window.fixture.choices;};
export async function setContactObjectiveAssignments(input){if(window.fixture.failPriority)throw Error('simulated');window.fixture.assignments.push(input);}
export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}
`);
  write('entry.tsx', `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ContactEditorDialog}from ${imp('components/ContactEditorDialog.tsx')};
import{ContactProfile}from ${imp('components/ContactProfile.tsx')};
window.fixture={saves:[],interactions:[],assignments:[],choices:[{id:'p1',objective_name:'Prioridad de prueba',objective_type:'industry',priority_level:'MEDIUM'},{id:'p2',objective_name:'Una prioridad con un nombre extenso para comprobar el ajuste de los chips',objective_type:'industry',priority_level:'MEDIUM'}]};
const contact={id:'synthetic',display_name:'Contacto de prueba',company:'Empresa de prueba',role:'Cargo de prueba',networking_status:'Pendiente',networking_focus:true,is_headhunter:false,contact_emails:[],contact_phones:[],contact_objective_assignments:[]};
const profile={contact,interactions:[{id:'i1',interaction_type:'message',occurred_at:'2026-11-24T12:00:00Z',subject:'Título extenso que debe verse completo sin recortar información importante',user_notes_raw:'Una nota larga para comprobar que la historia contraída permite leer dos líneas completas en móvil sin perder acceso al resto del contenido. '.repeat(4)}],interactionParticipants:[],externalInteractionSources:[],referrals:[],todos:[]};
const visual=new URLSearchParams(location.search).has('visual');
if(visual){
  window.fixture.choices=['Fintech','Retail','Gerencia de Operaciones','Consultoría'].map((name,i)=>({id:'v'+i,objective_name:name,objective_type:'industry',priority_level:'MEDIUM'}));
  const media=new URLSearchParams(location.search).get('media');
  Object.assign(contact,{display_name:'Ana de Prueba',company:'Empresa ejemplo',role:'Directora de producto',is_headhunter:!new URLSearchParams(location.search).has('person'),contact_emails:media==='none'?[]:media==='multi'?[{email:'ana@contacto.example'},{email:'otra@contacto.example'},{email:'ANA@contacto.example'},{email:'no-es-correo'}]:[{email:'ana@contacto.example'}],contact_phones:media==='none'?[]:media==='multi'?[{phone:'+56 9 1234 5678'},{phone:'+56 9 8765 4321'},{phone:'+56912345678'},{phone:'12'}]:[{phone:'+56 9 1234 5678'}]});
  if(!new URLSearchParams(location.search).has('empty'))contact.contact_objective_assignments=window.fixture.choices.slice(0,3).map(objective=>({objective_id:objective.id,objective}));
  profile.interactions=[{id:'v1',interaction_type:'calendar',occurred_at:'2026-11-20T15:37:28.123Z',subject:'Café para conocer su experiencia',user_notes_raw:'Conversamos sobre su experiencia y los próximos pasos del equipo. Acordamos compartir algunas ideas y retomar la conversación la próxima semana.'},{id:'v2',interaction_type:'message',occurred_at:'2026-11-14T12:00:00Z',subject:'Mensaje inicial para coordinar un café',user_notes_raw:'Le escribí para presentarme y proponer una conversación.'}];
}
function App(){const[open,setOpen]=useState(false);return <main style={{maxWidth:1180,margin:'24px auto',padding:16}}><button id="create" onClick={()=>setOpen(true)}>Nuevo contacto</button><ContactProfile profile={profile} onReload={()=>{}}/><ContactEditorDialog initialValues={visual?{displayName:contact.display_name,company:contact.company,role:contact.role,emails:['ana@contacto.example']}:undefined} open={open} onClose={()=>setOpen(false)} onSaved={()=>{}}/></main>};
createRoot(document.getElementById('root')).render(<App/>);`);
  await new Promise((resolve,reject)=>{
    const gatePlugin = new webpack.NormalModuleReplacementPlugin(/googleSyncAuthorization$/,path.join(out,'stubs.tsx'));
    const compiler=webpack({mode:'development',devtool:false,context:root,entry:path.join(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')]},module:{rules:[{test:/\.tsx?$/,use:path.join(out,'loader.cjs')}]},plugins:[new webpack.NormalModuleReplacementPlugin(/(WorkspaceState|CoachPreview|ContactDataSyncButton|ReferralEditorDialog|ContactDeactivationButton|ContactDeactivationConfirmDialog|contactActions|cycleObjectiveActions|headhunterCompanyActions|headhunterCompanyMaster|cloudData|referralActions|interactionActions|next\/navigation|next\/link)$/,path.join(out,'stubs.tsx')),new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/,()=>{throw Error('Remote transport forbidden');})]});
    gatePlugin.apply(compiler);
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(out,'bundle.js')));}
    if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');return res.end(['styles/tokens.css','styles/components.css','styles/contact-redesign.css','app/globals.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^@import.*$/gm,'')).join('\n'));}
    res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=require(process.env.CONTACT_PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({locale:'es-CL',timezoneId:'America/Santiago'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const url='http://127.0.0.1:'+server.address().port;
  const shot=async name=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});
  };
  if(process.env.CONTACT_TYPO_ONLY==='1'){
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:1000});await page.goto(url+'?visual=1');
      await page.locator('#create').click();
      const dialog=page.locator('dialog');await dialog.waitFor();
      await dialog.getByText('Más detalles').click();
      const titles=dialog.locator('.contact-form-subsection-title');
      assert.deepEqual(await titles.allTextContents(),['Foco networking','Headhunter','Prioridades']);
      const styles=await titles.evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.color,s.letterSpacing]}));
      assert.ok(styles.every(style=>JSON.stringify(style)===JSON.stringify(styles[0])),'subsection hierarchy '+width);
      assert.ok(Number.parseInt(styles[0][1],10)>=700);
      const labels=dialog.locator('.contact-form-field-label');
      assert.equal(await labels.count(),6);
      assert.ok(await labels.evaluateAll(els=>els.every(el=>getComputedStyle(el).textTransform==='uppercase')));
      const gaps=await dialog.evaluate(el=>{
        const status=el.querySelector('.contact-editor-state-row > .field');
        const toggles=[...el.querySelectorAll('.contact-editor-toggle')];
        const priority=el.querySelector('.contact-editor-priorities');
        const blocks=[status,...toggles,priority];
        return blocks.slice(1).map((item,i)=>item.getBoundingClientRect().top-blocks[i].getBoundingClientRect().bottom);
      });
      assert.ok(gaps.every(gap=>Math.abs(gap-16)<1),'equal subsection gaps '+width+' '+gaps);
      await dialog.locator('.contact-editor-priorities').scrollIntoViewIfNeeded();
      await shot('contact-form-type-'+width);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',mode:'typography',viewports:[1280,390,320],screenshots:out}));return;
  }
  if(process.env.CONTACT_PHONE_ONLY==='1'){
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:900});await page.goto(url+'?visual=1');
      await page.getByRole('button',{name:'Editar contacto'}).click();
      let dialog=page.locator('dialog');await dialog.waitFor();
      await dialog.getByRole('button',{name:'Agregar teléfono adicional'}).click();
      const second=dialog.getByRole('textbox',{name:'Teléfono 2'});
      await second.fill('+56 9abc 1234 5678');
      assert.equal(await dialog.getByText('Ingresa un número de teléfono válido, incluyendo el código de país.').count(),0);
      await dialog.getByRole('button',{name:'Guardar cambios'}).click();
      assert.equal(await second.getAttribute('aria-invalid'),'true');
      assert.equal(await dialog.getByText('Ingresa un número de teléfono válido, incluyendo el código de país.').count(),1);
      assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
      await shot('phone-edit-invalid-'+width);
      await second.fill('+1 (415) 555-2671');
      assert.equal(await second.getAttribute('aria-invalid'),'false');
      await dialog.getByRole('button',{name:'Guardar cambios'}).click();await dialog.waitFor({state:'hidden'});
      assert.deepEqual(await page.evaluate(()=>window.fixture.saves.at(-1).phones),['+56 9 1234 5678','+1 (415) 555-2671']);
      await page.goto(url);await page.locator('#create').click();dialog=page.locator('dialog');await dialog.waitFor();
      await dialog.getByPlaceholder('Nombre del contacto').fill('Contacto sintético');
      const first=dialog.getByRole('textbox',{name:'Teléfono 1'});
      await first.fill('56912345678x12');await dialog.getByRole('button',{name:'Agregar teléfono adicional'}).click();
      await dialog.getByRole('textbox',{name:'Teléfono 2'}).fill('912345678');
      await dialog.getByRole('button',{name:'Crear contacto'}).click();
      assert.equal(await first.getAttribute('aria-invalid'),'true');
      assert.equal(await dialog.getByRole('textbox',{name:'Teléfono 2'}).getAttribute('aria-invalid'),'false');
      assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
      await shot('phone-create-invalid-'+width);
      await first.fill('');await dialog.getByRole('button',{name:'Crear contacto'}).click();await dialog.waitFor({state:'hidden'});
      assert.deepEqual(await page.evaluate(()=>window.fixture.saves.at(-1).phones),['912345678']);
      await page.goto(url+'?visual=1&media=multi');
      assert.equal(await page.locator('.contact-secondary-actions').getByRole('button',{name:'Elegir medio para WhatsApp'}).count(),1);
      await page.locator('.contact-secondary-actions').getByRole('button',{name:'Elegir medio para WhatsApp'}).click();
      assert.equal(await page.locator('.contact-medium-popover').getByRole('link').count(),2);
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',mode:'phone',viewports:[1280,390,320],screenshots:out}));return;
  }
  if(process.env.CONTACT_MEDIA_ONLY==='1'){
    const names=['Café','Correo','WhatsApp'];
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:900});
      for(const kind of ['none','one','multi']){
        await page.goto(url+'?visual=1&media='+kind);
        await page.getByRole('heading',{name:'Historia',exact:true}).waitFor();
        await page.evaluate(()=>{window.selectedHrefs=[];document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(a&&/^(mailto:|https:\/\/(calendar\.google\.com|wa\.me))/.test(a.href)){window.selectedHrefs.push(a.getAttribute('href'));event.preventDefault();}},true);});
        const group=page.locator('.contact-secondary-actions');
        assert.equal(await group.locator('.button').count(),3);
        assert.equal(await page.locator('.contact-method-card a[href^="https://wa.me/"]').count(),0);
        const boxes=await group.locator('.button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height,r.top]}));
        for(const box of boxes.slice(1))boxes[0].forEach((size,i)=>assert.ok(Math.abs(size-box[i])<1,'equal geometry '+kind+' '+width));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        if(kind==='none'){
          for(const name of names){const button=group.getByRole('button',{name,exact:true});assert.ok(await button.isDisabled());}
          await shot('media-disabled-'+width);
        }else if(kind==='one'){
          const expected=['https://calendar.google.com/calendar/render?action=TEMPLATE&add=ana%40contacto.example','mailto:ana%40contacto.example','https://wa.me/56912345678'];
          for(let i=0;i<3;i++){
            const link=group.getByRole('link',{name:names[i],exact:true});assert.equal(await link.getAttribute('href'),expected[i]);
            await link.click();assert.equal(await page.evaluate(()=>window.selectedHrefs.at(-1)),expected[i]);
          }
          assert.equal(await page.locator('.contact-medium-popover').count(),0);
        }else{
          for(const name of names){
            const trigger=group.getByRole('button',{name:`Elegir medio para ${name}`});await trigger.click();
            const popover=page.locator('.contact-medium-popover');await popover.waitFor();
            assert.equal(await popover.getByRole('link').count(),2,'deduplicated options');
            for(const key of ['Tab','Shift+Tab'])for(let n=0;n<6;n++){
              await page.keyboard.press(key);
              assert.ok(await page.evaluate(()=>Boolean(document.activeElement.closest('.contact-medium-popover'))),'focus trapped');
            }
            if(name==='Café')await shot('media-popover-coffee-'+width);
            if(name==='Correo')await shot('media-popover-mail-'+width);
            if(name==='WhatsApp')await shot('media-popover-whatsapp-'+width);
            await page.keyboard.press('Escape');await popover.waitFor({state:'hidden'});
            assert.ok(await trigger.evaluate(el=>el===document.activeElement),'Escape restores focus');
            await trigger.click();await page.locator('.contact-medium-popover').getByRole('link').nth(1).click();
            await popover.waitFor({state:'hidden'});
          }
          assert.deepEqual(await page.evaluate(()=>window.selectedHrefs.slice(-3)),['https://calendar.google.com/calendar/render?action=TEMPLATE&add=otra%40contacto.example','mailto:otra%40contacto.example','https://wa.me/56987654321']);
          await group.getByRole('button',{name:'Elegir medio para Café'}).click();
          await page.mouse.click(5,5);
          await page.locator('.contact-medium-popover').waitFor({state:'hidden'});
        }
      }
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',mode:'media',viewports:[1280,390,320],screenshots:out}));return;
  }
  if(process.env.CONTACT_FOCAL_ONLY==='1'){
    const confined=async(selector)=>{
      for(const key of ['Tab','Shift+Tab'])for(let i=0;i<16;i++){
        await page.keyboard.press(key);
        assert.ok(await page.evaluate(s=>Boolean(document.activeElement.closest(s)),selector),key+' confined to '+selector);
      }
    };
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:900});await page.goto(url+'?visual=1');
      const trigger=page.getByRole('button',{name:'Editar prioridades',exact:true});await trigger.click();
      await page.getByRole('button',{name:'Fintech',exact:true}).waitFor();
      const close=await page.getByRole('button',{name:'Cerrar prioridades',exact:true}).boundingBox();
      const search=await page.getByPlaceholder('Buscar prioridad…').boundingBox();
      assert.ok(close.y+close.height<=search.y,'close is separate from search');
      await confined('.contact-priority-popover');
      await page.getByPlaceholder('Buscar prioridad…').fill('Fintech');
      assert.equal(await page.getByRole('button',{name:'Retail',exact:true}).count(),0);
      await page.getByPlaceholder('Buscar prioridad…').fill('');
      await shot('focal-popover-open-'+width);
      await page.evaluate(()=>{window.fixture.failPriority=true;});
      await page.getByRole('button',{name:'Fintech',exact:true}).click();
      assert.equal(await page.getByRole('alert').textContent(),'No pudimos guardar las prioridades. Inténtalo de nuevo');
      assert.equal(await page.getByRole('button',{name:'Fintech',exact:true}).getAttribute('aria-pressed'),'true');
      await confined('.contact-priority-popover');await shot('focal-popover-error-'+width);
      await page.keyboard.press('Escape');
      await page.locator('.contact-priority-popover').waitFor({state:'hidden'});
      assert.ok(await trigger.evaluate(el=>el===document.activeElement),'Escape restores trigger');
      await shot('focal-popover-closed-'+width);
      await trigger.click();await page.evaluate(()=>{window.fixture.failPriority=false;});
      await page.getByRole('button',{name:'Fintech',exact:true}).click();
      await page.getByRole('alert').waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>window.fixture.assignments.length),1,'recovery persists once');
      await page.getByRole('button',{name:'Cerrar prioridades',exact:true}).click();
      assert.ok(await page.locator('.contact-priority-trigger').evaluate(el=>el===document.activeElement),'close restores trigger');
      await page.getByRole('button',{name:'Expandir todas',exact:true}).click();
      assert.equal(await page.locator('.contact-timeline-item[open]').count(),2);
      await page.getByRole('button',{name:'Contraer todas',exact:true}).click();
      assert.equal(await page.locator('.contact-timeline-item[open]').count(),0);
      await page.getByRole('button',{name:'Editar minuta'}).first().click();
      const date=page.getByRole('textbox',{name:'Fecha',exact:true});
      assert.equal(await date.inputValue(),'20/11/2026');
      await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.fixture.interactions.at(-1).occurredAt),'2026-11-20T15:37:28.123Z');
      await page.getByRole('button',{name:'Registrar interacción',exact:true}).click();
      const saveInteraction=page.locator('.interaction-editor-dialog').getByRole('button',{name:'Registrar interacción',exact:true});
      await date.fill('31/11/2026');await page.getByLabel('Hora',{exact:true}).focus();
      assert.ok(await saveInteraction.isDisabled());
      assert.equal(await date.getAttribute('aria-invalid'),'true');
      await date.fill('29/02/2025');
      assert.ok(await saveInteraction.isDisabled());
      await date.fill('29/02/2024');
      assert.ok(await saveInteraction.isEnabled());
      await date.fill('25/11/2026');
      await page.getByLabel('Hora',{exact:true}).selectOption('09');await page.getByLabel('Minutos',{exact:true}).selectOption('37');
      await shot('focal-interaction-date-'+width);
      await saveInteraction.click();
      assert.match(await page.evaluate(()=>window.fixture.interactions.at(-1).occurredAt),/^2026-11-25T09:37:/);
      await page.goto(url);await page.locator('#create').click();const dialog=page.locator('dialog');await dialog.waitFor();
      assert.equal(await dialog.locator('#contact-name-error').count(),0);
      await confined('dialog');assert.equal(await dialog.locator('#contact-name-error').count(),0);
      await shot('focal-create-initial-'+width);
      await dialog.getByRole('button',{name:'Crear contacto',exact:true}).click();
      await dialog.getByText('El nombre es obligatorio.').waitFor();
      await dialog.getByPlaceholder('Nombre del contacto').fill('Contacto sintético');
      assert.equal(await dialog.locator('#contact-name-error').count(),0);
      await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'Descartar contacto',exact:true}).click();
      await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement.id),'create');
      assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',mode:'focal',viewports:[1280,390,320],screenshots:out}));return;
  }
  if(process.env.CONTACT_ACTIONS_ONLY==='1'){
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:900});await page.goto(url+'?visual=1');
      await page.getByRole('heading',{name:'Historia',exact:true}).waitFor();
      const whatsapp=page.locator('.contact-secondary-actions').getByRole('link',{name:'WhatsApp'});
      assert.equal(await whatsapp.count(),1);
      assert.equal(await whatsapp.getAttribute('href'),'https://wa.me/56912345678');
      assert.equal(await page.locator('.contact-secondary-actions').getByRole('link',{name:'Correo'}).count(),1);
      assert.equal(await page.locator('.contact-secondary-actions').getByRole('link',{name:'Café'}).count(),1);
      assert.equal(await page.locator('.contact-method-card a[href^="https://wa.me/"]').count(),0);
      assert.equal(await page.getByRole('button',{name:'Cambiar a Persona'}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.getByRole('button',{name:'En foco: activo'}).getAttribute('aria-pressed'),'true');
      assert.deepEqual(await page.locator('.contact-secondary-actions > .button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height),Math.round(r.top)]})).then(rows=>rows.map(row=>row.join(','))),Array(3).fill((await page.locator('.contact-secondary-actions > .button').first().evaluate(el=>{const r=el.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height),Math.round(r.top)]})).join(',')));
      assert.equal(await whatsapp.locator('svg').evaluate(el=>getComputedStyle(el).fill),'rgb(37, 211, 102)');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await shot('focal-actions-'+width);
      await page.getByRole('button',{name:'Cambiar a Persona'}).click();
      assert.equal(await page.getByRole('button',{name:'Cambiar a Headhunter'}).getAttribute('aria-pressed'),'false');
      await shot('focal-person-'+width);
      await page.getByRole('button',{name:'Cambiar a Headhunter'}).click();
      assert.equal(await page.getByRole('button',{name:'Cambiar a Persona'}).getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'Editar contacto'}).click();
      const dialog=page.locator('dialog');await dialog.waitFor();
      const focus=dialog.getByRole('checkbox',{name:/Foco networking/});
      const headhunter=dialog.getByRole('checkbox',{name:/Headhunter/});
      assert.equal(await focus.isChecked(),true);assert.equal(await headhunter.isChecked(),true);
      await dialog.locator('.contact-editor-toggle').filter({hasText:'Headhunter'}).click();assert.equal(await headhunter.isChecked(),false);
      await dialog.locator('.contact-editor-toggle').filter({hasText:'Headhunter'}).click();await shot('focal-headhunter-editor-'+width);
      await page.keyboard.press('Escape');
      if(await dialog.getByRole('button',{name:'Descartar contacto'}).count())await dialog.getByRole('button',{name:'Descartar contacto'}).click();
      await page.locator('#create').click();
      await dialog.locator('summary').click();
      const createFocus=dialog.getByRole('checkbox',{name:/Foco networking/});
      const createHeadhunter=dialog.getByRole('checkbox',{name:/Headhunter/});
      assert.equal(await createFocus.isChecked(),true);assert.equal(await createHeadhunter.isChecked(),false);
      await dialog.locator('.contact-editor-toggle').filter({hasText:'Headhunter'}).click();
      assert.equal(await createHeadhunter.isChecked(),true);
      await shot('focal-headhunter-create-'+width);
      await page.keyboard.press('Escape');
      await dialog.getByRole('button',{name:'Descartar contacto'}).click();
      await page.goto(url);
      assert.equal(await page.getByRole('link',{name:'WhatsApp'}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Cambiar a Headhunter'}).getAttribute('aria-pressed'),'false');
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',mode:'actions',viewports:[1280,390,320],screenshots:out}));return;
  }
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});await page.goto(url+'?visual=1');
    await page.getByRole('heading',{name:'Historia',exact:true}).waitFor();
    assert.ok(await page.locator('.contact-status-select').evaluate(el=>{
      const style=getComputedStyle(el);const ctx=document.createElement('canvas').getContext('2d');
      ctx.font=style.font;
      return el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)>=ctx.measureText(el.selectedOptions[0].text).width;
    }),'status label fits '+width);
    await page.locator('.contact-profile-page').screenshot({path:path.join(out,'visual-profile-'+width+'.png')});
    await page.getByRole('button',{name:'Editar prioridades',exact:true}).click();
    await page.getByRole('button',{name:'Fintech',exact:true}).waitFor();
    await shot('visual-popover-'+width);await page.keyboard.press('Escape');
    await page.goto(url+'?visual=1&empty=1');
    await page.getByRole('button',{name:'Agregar prioridades',exact:true}).waitFor();
    await page.locator('.contact-profile-page').screenshot({path:path.join(out,'visual-profile-empty-'+width+'.png')});
    await page.locator('#create').click();const dialog=page.locator('dialog');await dialog.waitFor();
    await shot('visual-create-compact-'+width);
    await dialog.locator('summary').click();
    await shot('visual-create-expanded-'+width);
    const geometry=()=>dialog.evaluate(el=>{
      const scroll=el.querySelector('.contact-editor-scroll').getBoundingClientRect();
      const footer=el.querySelector('footer').getBoundingClientRect();
      return {noOverlap:scroll.bottom<=footer.top+1,footerVisible:footer.bottom<=innerHeight+1,noOverflow:el.scrollWidth<=el.clientWidth};
    });
    assert.deepEqual(await geometry(),{noOverlap:true,footerVisible:true,noOverflow:true},'footer geometry '+width);
    await dialog.locator('.contact-editor-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await shot('visual-create-bottom-'+width);
    const priorities=await dialog.locator('.contact-editor-priorities').boundingBox();
    const footer=await dialog.locator('footer').boundingBox();
    assert.ok(priorities.y+priorities.height<=footer.y+1,'last fields accessible '+width);
    if(width<760){
      await page.setViewportSize({width,height:500});
      await dialog.locator('.contact-editor-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
      assert.deepEqual(await geometry(),{noOverlap:true,footerVisible:true,noOverflow:true},'short viewport footer '+width);
      await page.screenshot({path:path.join(out,'visual-create-short-bottom-'+width+'.png')});
      await page.setViewportSize({width,height:900});
    }
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Registrar interacción',exact:true}).click();
    await page.getByLabel('Hora',{exact:true}).selectOption('09');await page.getByLabel('Minutos',{exact:true}).selectOption('37');
    await shot('visual-interaction-'+width);
    await page.getByRole('button',{name:'Cerrar editor de interaccion'}).click();
    await page.getByRole('button',{name:'Editar minuta'}).first().click();
    const before='2026-11-20T15:37:28.123Z';
    await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.fixture.interactions.at(-1).occurredAt),before,'unchanged timestamp preserved');
  }
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('heading',{name:'Historia',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Agregar interaccion',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Actualizar datos del contacto',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'profile overflow '+width);
    if(width<760)assert.ok(await page.locator('.contact-interactions-panel').evaluate(el=>el.getBoundingClientRect().top)<await page.locator('.contact-side-stack').evaluate(el=>el.getBoundingClientRect().top));
    await page.screenshot({path:path.join(out,'profile-'+width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'Agregar prioridades',exact:true}).click();
    await page.getByRole('button',{name:'Prioridad de prueba',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.fixture.assignments.length),1);
    await page.getByPlaceholder('Buscar prioridad…').fill('no coincide');
    await page.getByText('No hay prioridades con ese nombre.').waitFor();
    await page.getByPlaceholder('Buscar prioridad…').fill('');
    await page.getByRole('button',{name:'Una prioridad con un nombre extenso para comprobar el ajuste de los chips',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'priority overflow');
    await page.evaluate(()=>{window.fixture.failPriority=true;});
    await page.getByRole('button',{name:'Prioridad de prueba',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:'Prioridad de prueba',exact:true}).getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{window.fixture.failPriority=false;});
    await page.screenshot({path:path.join(out,'priorities-'+width+'.png'),fullPage:true});
    await page.keyboard.press('Escape');
    await page.locator('#create').click();const dialog=page.locator('dialog');await dialog.waitFor();
    assert.equal(await dialog.getByText('El nombre es obligatorio.').count(),0);
    await dialog.getByPlaceholder('Sin empresa').focus();
    assert.equal(await dialog.getByText('El nombre es obligatorio.').count(),0,'name remains quiet before submit');
    await dialog.getByRole('button',{name:'Crear contacto',exact:true}).click();await dialog.getByText('El nombre es obligatorio.').waitFor();
    await dialog.getByPlaceholder('Nombre del contacto').fill('Contacto sintético');
    await dialog.getByPlaceholder('correo@empresa.cl',{exact:true}).first().fill('incorrecto');
    await dialog.getByPlaceholder('Nombre del contacto').focus();await dialog.getByText('Debe tener formato de correo, por ejemplo nombre@empresa.cl.').waitFor();
    await dialog.getByPlaceholder('correo@empresa.cl',{exact:true}).first().fill('');
    await dialog.getByRole('button',{name:'Agregar correo adicional',exact:true}).click();
    await dialog.getByRole('textbox',{name:'Correo 2',exact:true}).fill('adicional@contacto.example');
    await dialog.locator('summary').click();
    await page.screenshot({path:path.join(out,'create-'+width+'.png'),fullPage:true});
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,'dialog overflow '+width);
    await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'Seguir editando'}).click();
    assert.equal(await dialog.getByPlaceholder('Nombre del contacto').inputValue(),'Contacto sintético');
    for(let i=0;i<25;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('dialog'))),true);}
    await dialog.getByRole('button',{name:'Crear contacto',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.fixture.saves.length),1);
    assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].emails),['adicional@contacto.example']);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'create');
    await page.evaluate(()=>{window.fixture.failRead=true;});
    await page.getByRole('button',{name:'Editar prioridades',exact:true}).click();
    await page.getByText('No pudimos cargar tus prioridades.').waitFor();
    assert.equal(await page.getByRole('button',{name:'Prioridad de prueba',exact:true}).isDisabled(),true);
    await page.evaluate(()=>{window.fixture.failRead=false;});
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();
    await page.getByRole('button',{name:'Prioridad de prueba',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Registrar interacción',exact:true}).click();
    await page.getByRole('button',{name:'Ayer',exact:true}).click();
    assert.match(await page.getByRole('textbox',{name:'Fecha',exact:true}).inputValue(),/^\d{2}\/\d{2}\/\d{4}$/);
    await page.screenshot({path:path.join(out,'interaction-'+width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'Cerrar editor de interaccion'}).click();
    await page.getByRole('button',{name:'Editar minuta'}).click();
    await page.getByRole('heading',{name:'Editar interacción',exact:true}).waitFor();
    assert.equal(await page.locator('.contact-timeline-item').getAttribute('open'),null);
    await page.getByRole('button',{name:'Cerrar editor de interaccion'}).click();
    await page.locator('.contact-timeline-item summary').click();
    assert.equal(await page.locator('.contact-timeline-item').getAttribute('open'),'');
    await page.locator('#create').click();
    await dialog.getByPlaceholder('Nombre del contacto').fill('Descartar prueba');
    await page.keyboard.press('Escape');
    await dialog.getByRole('button',{name:'Descartar contacto',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.fixture.saves.length),1);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',viewports:[1280,390,320],screenshots:out}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
