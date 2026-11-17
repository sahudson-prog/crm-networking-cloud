"use client";
import {useEffect,useMemo,useState,type ReactNode} from "react";
import type {DashboardDetails} from "../lib/dashboardDetails";
import {nextTrackingPeriodBoundary,type TrackingSnapshot} from "../lib/trackingModel";
import {attributedCoffeeHistory,buildGamification,type GamificationExtra} from "../lib/gamificationModel";
import {readGamificationExtra} from "../lib/gamificationRead";
import {GamificationPanel} from "./GamificationPanel";

const missing:GamificationExtra={cycles:null,opportunities:null,opportunityContacts:null,priorities:null,assignments:null,transitions:null,calendarSources:null};
export function useHomeRefresh(enabled:boolean,zone:string|null|undefined,refresh:()=>void) {
  useEffect(()=>{
    if(!enabled)return;
    let timer:ReturnType<typeof setTimeout>,last=0;
    const update=()=>{const now=Date.now();if(now-last>1000){last=now;refresh();}};
    const schedule=()=>{clearTimeout(timer);let next:number;try{next=nextTrackingPeriodBoundary(Date.now(),zone||Intl.DateTimeFormat().resolvedOptions().timeZone,"weekly");}catch{return;}timer=setTimeout(()=>{update();schedule();},Math.max(100,next-Date.now()+20));};
    const visible=()=>{if(!document.hidden){update();schedule();}};
    schedule();window.addEventListener("focus",visible);document.addEventListener("visibilitychange",visible);
    return()=>{clearTimeout(timer);window.removeEventListener("focus",visible);document.removeEventListener("visibilitychange",visible);};
  },[enabled,zone,refresh]);
}
export function HomeGamification({snapshot,details,loading,error,onRetry,children}:{snapshot:TrackingSnapshot|null;details:DashboardDetails|null;loading:boolean;error:boolean;onRetry:()=>void;children?:ReactNode}) {
  const [extra,setExtra]=useState<GamificationExtra|null>(null),[reading,setReading]=useState(true);
  useEffect(()=>{let live=true;setReading(true);if(loading)return;readGamificationExtra(snapshot?.coffeeHistory).then(v=>{if(live)setExtra(v);}).catch(()=>{if(live)setExtra(missing);}).finally(()=>{if(live)setReading(false);});return()=>{live=false;};},[loading,details,snapshot]);
  const model=useMemo(()=>{
    if(!extra)return null;
    const zone=snapshot?.cycle?.timezone_name??extra.cycles?.find(c=>c.status==="active")?.timezone_name??Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now=snapshot?Date.parse(snapshot.as_of):Date.now();
    try{return buildGamification({
      contacts:snapshot?.contacts??null,
      interactions:details?.interactions.map(i=>({...i,metadata:i.metadata??{}}))??null,
      participants:details?.participants??[],sources:(details?.sources??[]).map(s=>({...s,sync_status:s.sync_status??"",is_active:true})),extra,
      historyReadFailed:!snapshot||Boolean(snapshot.coffeeHistoryError),
      history:snapshot?attributedCoffeeHistory(snapshot.contacts,snapshot.coffeeHistory,snapshot.as_of):null
    },now,zone);}catch{return null;}
  },[details,snapshot,extra]);
  useEffect(()=>{
    const next=model?.temporal.nextChange;
    if(!next)return;
    const timer=setTimeout(onRetry,Math.min(2147483647,Math.max(100,next-Date.now()+20)));
    return()=>clearTimeout(timer);
  },[model,onRetry]);
  return <GamificationPanel model={model} loading={loading||reading} error={!error&&!snapshot?.coffeeHistoryError&&Boolean(extra&&Object.values(extra).some(v=>v===null))} onRetry={onRetry}>{children}</GamificationPanel>;
}
