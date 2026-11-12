"use client";
import { createContext,useContext,useState,useEffect,useCallback,useRef,useSyncExternalStore,type ReactNode,type Dispatch,type SetStateAction } from "react";
import {readAllActiveContacts} from "../lib/cloudData";
import {readObjectives} from "../lib/cycleObjectiveActions";
import {readWorkspaceTodos} from "../lib/workspaceRead";
import type {ContactRow,TodoRow,ObjectiveRow,ContactProfileData} from "../lib/readModel";
import {DEFAULT_CONTACT_FILTERS,type ContactFilters} from "../lib/contactFilters";
import {subscribeGlobalActivitySync,getGlobalActivitySyncSnapshot,getGlobalActivitySyncServerSnapshot} from "../lib/activitySyncExecution";
type FilterState={filters:ContactFilters;query:string};
type Profile={profile:ContactProfileData;onReload:()=>void};
type Value={contacts:ContactRow[];todos:TodoRow[];objectives:ObjectiveRow[];loading:boolean;error:string;refresh:()=>void;ensureFresh:()=>void;profile:Profile|null;setProfile:Dispatch<SetStateAction<Profile|null>>;filters:Record<'contacts'|'states',FilterState>;setFilters:Dispatch<SetStateAction<Record<'contacts'|'states',FilterState>>>};
const Context=createContext<Value|null>(null);
export const useWorkspace=()=>useContext(Context);
export function WorkspaceProvider({children}:{children:ReactNode}) {
  const [contacts,setContacts]=useState<ContactRow[]>([]),[todos,setTodos]=useState<TodoRow[]>([]),[objectives,setObjectives]=useState<ObjectiveRow[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [filters,setFilters]=useState<Record<'contacts'|'states',FilterState>>({contacts:{filters:{...DEFAULT_CONTACT_FILTERS},query:''},states:{filters:{...DEFAULT_CONTACT_FILTERS},query:''}});
  const syncedAt=useSyncExternalStore(subscribeGlobalActivitySync,getGlobalActivitySyncSnapshot,getGlobalActivitySyncServerSnapshot).lastSuccess?.calendar;
  const lastRead=useRef(0);
  const ensureFresh=useCallback(()=>{if(Date.now()-lastRead.current>10000){lastRead.current=Date.now();setRevision(n=>n+1);}},[]);
  const refresh=useCallback(()=>setRevision(n=>n+1),[]);
  useEffect(()=>{let active=true;lastRead.current=Date.now();setLoading(true);setError('');
    Promise.all([readAllActiveContacts(true),readObjectives()]).then(async([people,priorities])=>{
      const pending=await readWorkspaceTodos(people);if(active){setContacts(people);setObjectives(priorities);setTodos(pending);}
    }).catch(()=>{if(active)setError('No pudimos actualizar búsqueda, filtros y Coach.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[revision,syncedAt]);
  return <Context.Provider value={{contacts,todos,objectives,loading,error,refresh,ensureFresh,profile,setProfile,filters,setFilters}}>{children}</Context.Provider>;
}
