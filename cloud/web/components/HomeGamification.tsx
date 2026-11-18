"use client";
import {useEffect,useMemo,useState,type ReactNode} from "react";
import {nextTrackingPeriodBoundary,type TrackingSnapshot} from "../lib/trackingModel";
import {attributedCoffeeHistory,buildGamification,type GamificationExtra,type GamificationModel} from "../lib/gamificationModel";
import {readSharedGamificationExtra,peekGamificationExtra} from "../lib/indicatorReads";
import {GamificationPanel} from "./GamificationPanel";

const missing:GamificationExtra={cycles:null,opportunities:null,opportunityContacts:null,priorities:null,assignments:null,transitions:null,calendarSources:null};
export function useHomeRefresh(enabled:boolean,zone:string|null|undefined,refresh:()=>void) {
  useEffect(()=>{
    if(!enabled)return;
    let timer:ReturnType<typeof setTimeout>,last=Date.now();
    const update=(force=false)=>{const now=Date.now();if(force||now-last>=60_000){last=now;refresh();}};
    const schedule=()=>{clearTimeout(timer);let next:number;try{next=nextTrackingPeriodBoundary(Date.now(),zone||Intl.DateTimeFormat().resolvedOptions().timeZone,"weekly");}catch{return;}timer=setTimeout(()=>{update(true);schedule();},Math.max(100,next-Date.now()+20));};
    const visible=()=>{if(!document.hidden){update();schedule();}};
    schedule();window.addEventListener("focus",visible);document.addEventListener("visibilitychange",visible);
    return()=>{clearTimeout(timer);window.removeEventListener("focus",visible);document.removeEventListener("visibilitychange",visible);};
  },[enabled,zone,refresh]);
}
export function HomeGamification({snapshot,snapshotKey,readKey,loading,error,onRetry,children}:{snapshot:TrackingSnapshot|null;snapshotKey:string;readKey:string;loading:boolean;error:boolean;onRetry:()=>void;children?:ReactNode}) {
  const [result,setResult]=useState<{key:string;extra:GamificationExtra}|null>(()=>{const extra=peekGamificationExtra();return extra?{key:readKey,extra}:null;}),[reading,setReading]=useState(true);
  const [model,setModel]=useState<GamificationModel|null>(null);
  useEffect(()=>{let live=true;setReading(true);readSharedGamificationExtra().then(extra=>{if(live)setResult({key:readKey,extra});}).catch(()=>{if(live)setResult({key:readKey,extra:missing});}).finally(()=>{if(live)setReading(false);});return()=>{live=false;};},[readKey]);
  const extra=result?.key===readKey?result.extra:null;
  const computed=useMemo(()=>{
    if(!snapshot||snapshotKey!==readKey)return null;
    const evidence=snapshot.coffeeHistory;
    const inputs=extra??{...missing,calendarSources:evidence?.sources??null};
    const zone=snapshot.cycle?.timezone_name??inputs.cycles?.find(c=>c.status==="active")?.timezone_name??Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now=Date.parse(snapshot.as_of);
    try{return buildGamification({
      contacts:snapshot.contacts,
      interactions:evidence?.interactions.map(i=>({...i,metadata:i.metadata??{}}))??null,
      participants:evidence?.participants??[],sources:evidence?.sources??[],extra:inputs,
      historyReadFailed:Boolean(snapshot.coffeeHistoryError),
      history:attributedCoffeeHistory(snapshot.contacts,evidence,snapshot.as_of)
    },now,zone);}catch{return null;}
  },[snapshot,snapshotKey,readKey,extra]);
  // First temporal evidence can render independently. Refreshes publish a coherent
  // generation and keep the previous complete model until auxiliary reads finish.
  useEffect(()=>{if(computed)setModel(previous=>extra||!previous?computed:previous);},[computed,extra]);
  const displayed=model??computed;
  useEffect(()=>{
    if(loading||reading)return;
    const next=displayed?.temporal.nextChange;
    if(!next)return;
    const timer=setTimeout(onRetry,Math.min(2147483647,Math.max(100,next-Date.now()+20)));
    return()=>clearTimeout(timer);
  },[displayed,onRetry,loading,reading]);
  return <GamificationPanel model={displayed} loading={!displayed&&(loading||reading)} routeLoading={reading&&!displayed?.route}
    goalsLoading={reading&&!extra&&displayed?.goals.some(goal=>goal.id==="prioritized"&&goal.metric.value===null)}
    error={error||Boolean(extra&&Object.values(extra).some(v=>v===null))} onRetry={onRetry}>{children}</GamificationPanel>;
}
