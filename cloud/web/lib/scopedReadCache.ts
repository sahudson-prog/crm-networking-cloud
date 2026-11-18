/** In-memory reads only. Invalidated generations cannot publish or repopulate cache. */
export class ScopedReadCache {
  private owner: string | null = null;
  private generation = 0;
  private expiresAt=Infinity;
  private entries = new Map<string, {expires:number; promise:Promise<unknown>; value?:unknown}>();
  private ttl:number;
  private now:()=>number;
  constructor(ttl = 60_000, now = () => Date.now()) {this.ttl=ttl;this.now=now;}
  scope(owner:string|null) { if(owner!==this.owner){this.owner=owner;this.invalidate();} }
  invalidate() { this.generation++;this.entries.clear();this.expiresAt=Infinity; }
  peek<T>(key:string):T|null {return this.owner?(this.entries.get(key)?.value as T??null):null;}
  read<T>(key:string,load:()=>Promise<T>,retain:(value:T)=>boolean=()=>true):Promise<T> {
    if(!this.owner)return Promise.reject(Error("read_access_denied"));
    // Related read fragments expire as one generation, never as mixed snapshots.
    if(this.now()>=this.expiresAt)this.invalidate();
    const previous=this.entries.get(key);
    if(previous && previous.expires>this.now())return previous.promise as Promise<T>;
    const generation=this.generation;
    const entry:{expires:number;promise:Promise<T>;value?:unknown}={expires:Infinity,value:previous?.value,promise:Promise.resolve().then(()=>{
      if(generation!==this.generation)throw Error("read_superseded");
      return load();
    }).then(value=>{
      if(generation!==this.generation)throw Error("read_superseded");
      entry.expires=this.now()+this.ttl;
      this.expiresAt=Math.min(this.expiresAt,entry.expires);
      entry.value=value;
      if(!retain(value)&&this.entries.get(key)===entry)this.entries.delete(key);
      return value;
    }).catch(error=>{if(this.entries.get(key)===entry)this.entries.delete(key);throw error;})};
    this.entries.set(key,entry);return entry.promise;
  }
}
