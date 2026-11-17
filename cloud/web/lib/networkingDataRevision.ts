// Invalidate derived reads after local writes; no data or identities are stored.
let revision=0;
const listeners=new Set<()=>void>();
export const getNetworkingDataRevision=()=>revision;
export const getServerNetworkingDataRevision=()=>0;
export function subscribeNetworkingDataRevision(listener:()=>void) {
  listeners.add(listener);return()=>{listeners.delete(listener);};
}
export function notifyNetworkingDataChanged() {
  revision++;
  for(const listener of listeners)listener();
}
