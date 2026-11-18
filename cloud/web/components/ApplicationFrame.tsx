"use client";
import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthGate } from "./AuthGate";
import { Shell } from "./Shell";
import { PublicLanding } from "./PublicLanding";
import { ViewSkeleton } from "./ui/ViewSkeleton";
export function ApplicationFrame({children}:{children:ReactNode}) {
  const path=usePathname();
  if (path === null) return <main className="app-shell"><ViewSkeleton kind="list" rows={3} label="Coffeecito" /></main>;
  const privateRoute=['/','/ingresar','/contactos','/objetivos','/registrar-avances','/planificar','/dashboard','/cuenta'].includes(path)||path==='/sistema'||path.startsWith('/sistema/');
  return privateRoute?<Suspense fallback={<main className="app-shell"><ViewSkeleton kind="list" rows={3} label="Coffeecito" /></main>}><AuthGate publicLanding={path==='/'?<PublicLanding/>:undefined}><Shell>{children}</Shell></AuthGate></Suspense>:children;
}
