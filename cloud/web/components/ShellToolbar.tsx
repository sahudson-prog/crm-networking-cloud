"use client";
import {useState} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import {Command} from "cmdk";
import {Search,SlidersHorizontal,X,FunnelX} from "lucide-react";
import {useWorkspace} from "./WorkspaceState";
import {useTrackingViewFilters} from "./useTrackingViewFilters";
import {ContactFilterControls} from "./ContactFilterControls";
import {DEFAULT_CONTACT_FILTERS} from "../lib/contactFilters";
export function ShellToolbar(){
 const workspace=useWorkspace()!,path=usePathname(),router=useRouter(),params=useSearchParams();
 const tracking=useTrackingViewFilters();const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false);
 const planning=path==='/planificar';const scope=path==='/registrar-avances'?'states':'contacts';
 const applicable=!params.has('contactId')&&(planning||path==='/contactos'||path==='/registrar-avances');
 const filters=planning?{...DEFAULT_CONTACT_FILTERS,objectiveIds:tracking.filters.priorityIds,isHeadhunter:tracking.filters.headhunters==='only'?'true' as const:tracking.filters.headhunters==='exclude'?'false' as const:'all' as const}:workspace.filters[scope].filters;
 const normalized=query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
 const matches=normalized?workspace.contacts.filter(c=>`${c.display_name} ${c.company||''} ${c.role||''}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').includes(normalized)).slice(0,30):[];
 const description=!applicable?'Los filtros no se aplican a esta vista.':planning?'Headhunter y Prioridades: resumen por prioridad y empresas headhunter. Foco=Sí es obligatorio; Estado no se aplica.':scope==='states'?'Filtros de Estados de networking. No afectan Oportunidades ni Últimas interacciones.':'Filtros de Contactos y Empresas. No afectan Referidos.';
 const defaults=DEFAULT_CONTACT_FILTERS;
 const text=planning?tracking.quickQuery:workspace.filters[scope].query;
 // Only controls in this panel and applicable to this route participate.
 const activeFilters=applicable&&(Boolean(text.trim())||filters.isHeadhunter!==defaults.isHeadhunter||filters.objectiveIds.length>0||(!planning&&(filters.networkingFocus!==defaults.networkingFocus||Boolean(filters.networkingStatus)||filters.networkingStatuses.length>0)));
 function resetFilters(){
  if(!applicable)return;
  if(planning){
   tracking.setFilters(current=>({...current,headhunters:'all',priorityIds:[]}));
   tracking.setQuickQuery('');
  }else{
   workspace.setFilters(current=>({...current,[scope]:{query:'',filters:{...current[scope].filters,networkingFocus:defaults.networkingFocus,isHeadhunter:defaults.isHeadhunter,networkingStatus:defaults.networkingStatus,networkingStatuses:[],objectiveIds:[],hashtag:defaults.hashtag}}}));
  }
 }
 return <Popover.Root onOpenChange={open=>{if(open)workspace.ensureFresh();}}><Popover.Anchor asChild><div className="shell-toolbar" aria-label="Búsqueda y filtros">
  <Popover.Root open={searchOpen&&!!query.trim()} onOpenChange={setSearchOpen}><Command shouldFilter={false} className="shell-search" label="Buscar contactos y abrir ficha">
   <Popover.Anchor asChild><div className="shell-search-input"><Search aria-hidden="true"/><Command.Input aria-label="Buscar contactos y abrir ficha" placeholder="Buscar contactos…" value={query} onValueChange={v=>{setQuery(v);setSearchOpen(true);}} onFocus={()=>{workspace.ensureFresh();setSearchOpen(true);}}/></div></Popover.Anchor>
   <Popover.Portal><Popover.Content className="shell-search-results" sideOffset={5} collisionPadding={12} onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()}>
    <Command.List aria-label="Contactos encontrados"><Command.Empty>{workspace.loading?'Leyendo contactos…':workspace.error?'No pudimos cargar los contactos.':'Sin coincidencias'}</Command.Empty>
    {matches.map(c=><Command.Item key={c.id} value={c.id} onSelect={()=>{setSearchOpen(false);setQuery('');router.push(`/contactos?contactId=${encodeURIComponent(c.id)}`);}}><strong>{c.display_name}</strong><span>{c.company||'Sin empresa'}</span></Command.Item>)}
    </Command.List>{matches.length===30?<p className="meta">Mostrando 30 resultados. Escribe más para precisar.</p>:null}
   </Popover.Content></Popover.Portal>
  </Command></Popover.Root>
  <Popover.Trigger asChild><button className="button secondary square shell-filter-trigger" data-filters-active={activeFilters||undefined} aria-label="Filtros" title={activeFilters?"Filtros opcionales activos":"Filtros"}><SlidersHorizontal aria-hidden="true"/></button></Popover.Trigger>
  </div></Popover.Anchor>
   <Popover.Portal><Popover.Content className="shell-filter-popover" align="start" sideOffset={8} collisionPadding={8} aria-label="Filtros">
    <div className="shell-popover-heading"><strong>Filtros</strong><div className="shell-filter-actions"><button className="button ghost square" type="button" aria-label="Restablecer filtros" title="Restablecer filtros" disabled={!activeFilters} onClick={resetFilters}><FunnelX aria-hidden="true"/></button><Popover.Close asChild><button className="button ghost square" aria-label="Cerrar filtros"><X/></button></Popover.Close></div></div>
    <p className="meta" id="shell-filter-description">{description}</p>
    {workspace.error?<p role="alert">{workspace.error}<button className="button" onClick={workspace.refresh}>Reintentar</button></p>:null}
    <fieldset disabled={!applicable} aria-describedby="shell-filter-description" className="shell-filter-fields">
     <ContactFilterControls embedded filtersOpen onFiltersOpenChange={()=>{}} filters={filters} objectiveOptions={workspace.objectives} focusLocked={planning} statusDisabled={planning}
      quickQuery={planning?tracking.quickQuery:workspace.filters[scope].query} quickSearchLabel={planning?'Texto en empresas headhunter':'Texto en contactos'}
      onQuickQueryChange={query=>planning?tracking.setQuickQuery(query):workspace.setFilters(s=>({...s,[scope]:{...s[scope],query}}))}
      onFiltersChange={filters=>planning?tracking.setFilters(s=>({...s,priorityIds:filters.objectiveIds,headhunters:filters.isHeadhunter==='true'?'only':filters.isHeadhunter==='false'?'exclude':'all'})):workspace.setFilters(s=>({...s,[scope]:{...s[scope],filters}}))}/>
    </fieldset>
   </Popover.Content></Popover.Portal>
 </Popover.Root>;
}
