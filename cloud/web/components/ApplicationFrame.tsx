"use client";
import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { Shell } from "./Shell";
import { PublicLanding } from "./PublicLanding";
export function ApplicationFrame({children}:{children:ReactNode}) {
  const path=usePathname();
  const privateRoute=['/','/ingresar','/contactos','/objetivos','/registrar-avances','/planificar','/dashboard','/cuenta'].includes(path)||path==='/sistema'||path.startsWith('/sistema/');
  return privateRoute?<Suspense fallback={<p role="status">Cargando…</p>}><AuthGate publicLanding={path==='/'?<PublicLanding/>:undefined}><Shell>{children}</Shell></AuthGate></Suspense>:children;
}
