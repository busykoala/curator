import {randomUUID} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
type Lease={token:string;until:number};
const key=(name:string)=>'playlist_maintenance_lease:'+name;
const read=(name:string)=>JSON.parse(stateGet(key(name),'{}')) as Partial<Lease>;
export function claimMaintenanceLease(name:string,ttl=180_000,now=Date.now()){
  return db().transaction(()=>{
    const previous=read(name);if(Number(previous.until)>now)return null;
    const token=randomUUID();stateSet(key(name),JSON.stringify({token,until:now+ttl}));return token;
  }).immediate();
}
export function heartbeatMaintenanceLease(name:string,token:string,ttl=180_000,now=Date.now()){
  return db().transaction(()=>{const previous=read(name);if(previous.token!==token||Number(previous.until)<=now)return false;stateSet(key(name),JSON.stringify({token,until:now+ttl}));return true}).immediate();
}
export function assertMaintenanceLease(name:string,token:string,now=Date.now()){
  const lease=read(name);if(lease.token!==token||Number(lease.until)<=now)throw Error('Playlist maintenance lease expired');
}
export function releaseMaintenanceLease(name:string,token:string){
  db().transaction(()=>{if(read(name).token===token)stateSet(key(name),'{}')}).immediate();
}
