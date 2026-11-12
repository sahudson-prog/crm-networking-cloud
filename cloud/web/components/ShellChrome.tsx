"use client";
import Link from "next/link";
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {useSearchParams} from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import {UserRound,MessageCircle,X} from "lucide-react";
import {ActivitySyncButton} from "./ActivitySyncButton";
import {BrandBetaWordmark,BRAND_ACCESSIBLE_NAME} from "./ui/BrandBetaWordmark";
import {WorkspaceNavigation} from "./WorkspaceNavigation";
import {ShellToolbar} from "./ShellToolbar";
import {InvitationButton} from "./InvitationButton";
import {useShellActions} from "./Shell";
import {useSystemAccess} from "./SystemAccess";
import {canRenderSystemSurface} from "../lib/systemAccess";
import {useWorkspace} from "./WorkspaceState";
import {CoachModule,CoachFace} from "./CoachPreview";
import {readAllInteractions} from "../lib/cloudData";
import type {InteractionRow} from "../lib/readModel";
const mobileSnapshot=()=>window.matchMedia('(max-width:760px)').matches;
const mobileSubscribe=(notify:()=>void)=>{const media=window.matchMedia('(max-width:760px)');media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
export function ShellChrome({children}:{children:ReactNode}){
 const mobile=useSyncExternalStore(mobileSubscribe,mobileSnapshot,()=>false);
 const {onSignOut}=useShellActions(),access=useSystemAccess(),workspace=useWorkspace()!,params=useSearchParams();
 const [invitation,setInvitation]=useState(0),[coachOpen,setCoachOpen]=useState(false),[interactions,setInteractions]=useState<InteractionRow[]>([]);
 const [coachError,setCoachError]=useState(false);const account=useRef<HTMLButtonElement>(null);
 const contactId=params.get('contactId')??'';
 useEffect(()=>{if(!coachOpen||contactId)return;let active=true;setCoachError(false);void readAllInteractions().then(rows=>{if(active)setInteractions(rows);}).catch(()=>{if(active)setCoachError(true);});return()=>{active=false;};},[coachOpen,contactId,workspace.todos]);
 const hasPending=!workspace.loading&&!workspace.error&&workspace.todos.length>0;
 const contextual=contactId?workspace.profile?.profile.contact.id===contactId?workspace.profile:null:null;
 return <div className="app-shell application-shell-v2">
  <Popover.Root open={coachOpen} onOpenChange={open=>{if(open)workspace.ensureFresh();setCoachOpen(open);}}>
   <div className="shell-top-region">
   <header className="shell-header-v2">
    <Link href="/" aria-label={BRAND_ACCESSIBLE_NAME} className="shell-brand-lockup"><img src="/brand/coffeecito-isotipo.svg" alt="" aria-hidden="true"/><BrandBetaWordmark /></Link>
    <div className="shell-header-actions">
     <ActivitySyncButton variant="focus_incremental" square/>
     <Popover.Trigger asChild><button className="button secondary shell-coach-trigger" aria-label={`Coach: ${workspace.error?'total no disponible':workspace.loading?'cargando':workspace.todos.length+' sugerencias pendientes'}`}><span className="shell-coach-face" data-speaking={hasPending||undefined} aria-hidden="true"><span className="shell-coach-art"><span className="coach-bot-antenna"/><CoachFace/></span></span>{hasPending?<span className="shell-coach-count" aria-hidden="true"><MessageCircle/ ><span>{workspace.todos.length>99?'99+':workspace.todos.length}</span></span>:null}</button></Popover.Trigger>
     <Menu.Root modal={false}><Menu.Trigger asChild><button ref={account} className="button secondary square" aria-label="Cuenta"><UserRound aria-hidden="true"/></button></Menu.Trigger>
      <Menu.Portal><Menu.Content className="shell-menu" align="end" sideOffset={8} collisionPadding={12}>
       <Menu.Item asChild><Link href="/cuenta">Configuración</Link></Menu.Item>
       <Menu.Item onSelect={()=>setInvitation(n=>n+1)}>Invitar a alguien</Menu.Item>
       {canRenderSystemSurface(access,'system')?<Menu.Item asChild><Link href="/sistema">Sistema</Link></Menu.Item>:null}
       <Menu.Separator className="shell-menu-separator"/>
       <Menu.Item disabled={!onSignOut} onSelect={()=>onSignOut?.()}>Cerrar sesión</Menu.Item>
      </Menu.Content></Menu.Portal>
     </Menu.Root>
    </div>
   </header>
   {!mobile?<WorkspaceNavigation/>:null}
   <ShellToolbar/>
   </div>
   <Popover.Anchor asChild><div className="shell-overlay-anchor"/></Popover.Anchor>
   <Popover.Portal><Popover.Content forceMount onEscapeKeyDown={event=>{if(document.querySelector("[data-coach-overlay]"))event.preventDefault();}} onInteractOutside={event=>{if((event.target as Element)?.closest?.("[data-coach-overlay]"))event.preventDefault();}} className="shell-coach-popover" side="bottom" align="end" sideOffset={0} collisionPadding={12} aria-label="Coach">
    <div className="shell-popover-heading"><strong>Coach</strong><Popover.Close asChild><button className="button ghost square" aria-label="Cerrar Coach"><X/></button></Popover.Close></div>
    {workspace.error?<p role="alert">{workspace.error}<button className="button" onClick={workspace.refresh}>Reintentar</button></p>:null}
    {coachError?<p role="status">No pudimos actualizar el detalle de las interacciones.</p>:null}
    {contactId&&!contextual?<p role="status">Leyendo sugerencias del contacto…</p>:<CoachModule todos={contactId?workspace.todos.filter(todo=>todo.object_id===contactId):workspace.todos} total={workspace.todos.length} contactId={contactId||undefined} variant={contactId?'contact':'dashboard'} interactions={contextual?.profile.interactions??interactions} onExecuted={()=>{workspace.refresh();contextual?.onReload();}}/>}
   </Popover.Content></Popover.Portal>
  </Popover.Root>
  <InvitationButton hideTrigger openRequest={invitation} onDialogClose={()=>account.current?.focus()}/>
  <main id="workspace-main">{children}</main>
  {mobile?<WorkspaceNavigation/>:null}
 </div>;
}
