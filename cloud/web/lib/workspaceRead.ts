import { supabase } from "./supabaseClient";
import { readCompletePages } from "./completeRead";
import type { ContactRow, TodoRow } from "./readModel";
/** Same active-contact eligibility as readActiveTodos, with complete pagination for the global count. */
export async function readWorkspaceTodos(contacts:ContactRow[]):Promise<TodoRow[]> {
  if(!supabase)throw Error("Supabase no configurado");
  const client=supabase;
  const rows=await readCompletePages<TodoRow>(async(from,to)=>await client.from('todos')
    .select('id,todo_type,engine_type,status,summary,reason,created_at,object_type,object_id,current_state,suggested_state,evidence,actions_json',{count:'exact'})
    .eq('status','active').order('created_at',{ascending:false}).order('id').range(from,to));
  const byId=new Map(contacts.map(c=>[c.id,c]));
  return rows.filter(t=>t.object_type!=='contact'||Boolean(t.object_id&&byId.get(t.object_id)?.is_active)).map(t=>({...t,summary:(t.object_id&&byId.get(t.object_id)?.display_name?.trim())||t.summary}));
}
