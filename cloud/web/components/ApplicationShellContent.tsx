"use client";
import {useEffect,type ReactNode} from "react";
import {expectedNetworkingCycleId} from "../lib/networkingCycles";
import {useOnboarding} from "./OnboardingProvider";
import {WorkspaceProvider} from "./WorkspaceState";
import {ShellChrome} from "./ShellChrome";
import {Button} from "./ui/Button";
export function ApplicationShellContent({children}:{children:ReactNode}) {
 const onboarding=useOnboarding();
 useEffect(()=>{void expectedNetworkingCycleId().catch(()=>undefined);},[]);
 if(onboarding.loadFailed)return <main className="app-shell" role="alert"><p>{onboarding.error}</p><Button onClick={onboarding.retry}>Reintentar</Button></main>;
 if(onboarding.loading||!onboarding.routeReady)return <main className="app-shell" role="status">Preparando recorrido...</main>;
 return <WorkspaceProvider><ShellChrome>{children}</ShellChrome></WorkspaceProvider>;
}
