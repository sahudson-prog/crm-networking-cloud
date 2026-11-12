"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {House,Coffee,CalendarDays,Menu as MenuIcon,Target,Users,BookOpen} from "lucide-react";
import {useOnboarding} from "./OnboardingProvider";
import {useTrackingViewFilters,TRACKING_QUERY_KEY} from "./useTrackingViewFilters";
export function WorkspaceNavigation() {
 const path=usePathname(),onboarding=useOnboarding(),{query}=useTrackingViewFilters();
 const href=(route:string)=>query?`${route}?${TRACKING_QUERY_KEY}=${encodeURIComponent(query)}`:route;
 const more=path==='/objetivos'||path==='/contactos';
 return <nav className="workspace-nav-v2" aria-label="Navegación principal">
  {[{route:'/',label:'Inicio',Icon:House},{route:'/registrar-avances',label:'Producir',Icon:Coffee},{route:'/planificar',label:'Planificar',Icon:CalendarDays}].map(({route,label,Icon})=>{
    const active=path===route||(route==='/'&&path==='/dashboard');
    return <Link key={route} href={href(route)} className="workspace-destination" aria-label={label} aria-current={active?'page':undefined}><Icon aria-hidden="true"/><span>{label}</span></Link>;
  })}
  <Menu.Root modal={false}><Menu.Trigger asChild><button className="workspace-destination" aria-label="Más" data-active={more||undefined}><MenuIcon aria-hidden="true"/><span>Más</span></button></Menu.Trigger>
   <Menu.Portal><Menu.Content className="shell-menu" sideOffset={6} collisionPadding={12} align="end">
    <Menu.Item asChild><Link href={href('/objetivos')} aria-current={path==='/objetivos'?'page':undefined}><Target aria-hidden="true"/>Objetivos</Link></Menu.Item>
    <Menu.Item asChild><Link href={href('/contactos')} aria-current={path==='/contactos'?'page':undefined}><Users aria-hidden="true"/>Contactos</Link></Menu.Item>
    <Menu.Item onSelect={()=>onboarding.replay()}><BookOpen aria-hidden="true"/>Tutorial</Menu.Item>
   </Menu.Content></Menu.Portal>
  </Menu.Root>
 </nav>;
}
