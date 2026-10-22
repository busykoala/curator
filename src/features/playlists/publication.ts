import {randomUUID} from 'node:crypto';
import {db} from '@/features/db/client';
import {publicationHash} from './refresh-policy';
import type {PlaylistDefinition} from './types';

export type PublicationAdapter={
  list:()=>Promise<Array<{id:string;name:string}>>;
  items:(id:string)=>Promise<string[]>;
  verify?:(id:string,expected:string[])=>Promise<string[]>;
  create:(name:string,ids:string[])=>Promise<string>;
  update:(id:string,name:string,ids:string[])=>Promise<void>;
};
type Publication={id:string;native_id:string|null;previous_ids_json:string;previous_name:string|null;status:string};
const same=(a:string[],b:string[])=>a.length===b.length&&a.every((id,i)=>id===b[i]);
const pendingName=(playlistId:number,journalId:string)=>`Curator pending ${playlistId} ${journalId}`;
export function recoverPublicationPlaylist(definition:PlaylistDefinition,listed:Array<{id:string;name:string}>,preferredId?:string){
  if(preferredId&&listed.some(item=>item.id===preferredId))return preferredId;
  const rows=db().prepare('SELECT id,native_id FROM playlist_publications WHERE playlist_id=? AND owner_user_id=? ORDER BY rowid DESC').all(definition.id,definition.ownerUserId) as Array<{id:string;native_id:string|null}>;
  const candidates=new Set<string>();
  for(const row of rows)for(const item of listed)if(item.id===row.native_id||item.name===pendingName(definition.id,row.id))candidates.add(item.id);
  if(candidates.size>1)throw Error('Multiple native playlists associated with this Curator playlist require review');
  return[...candidates][0];
}

// Native APIs and SQLite cannot share a transaction. Journal the intent first,
// recover creates by a unique temporary name, then confirm exact ordering. A
// retry always reads the remote state before issuing another mutation.
export async function publishVerifiedPlaylist(definition:PlaylistDefinition,ids:string[],existingId:string|undefined,adapter:PublicationAdapter,assertCurrent:()=>void,assertOwnership:()=>void=()=>{}){
  if(!ids.length||new Set(ids).size!==ids.length)throw new Error('Refusing an empty or duplicate playlist publication');
  assertCurrent();
  const hash=publicationHash(ids),revision=definition.revision??1;
  db().prepare("INSERT OR IGNORE INTO playlist_publications(id,playlist_id,owner_user_id,revision,selection_hash,song_ids_json,native_id) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(),definition.id,definition.ownerUserId,revision,hash,JSON.stringify(ids),existingId??null);
  const journal=db().prepare('SELECT id,native_id,previous_ids_json,previous_name,status FROM playlist_publications WHERE playlist_id=? AND revision=? AND selection_hash=?').get(definition.id,revision,hash) as Publication;
  const temporaryName=pendingName(definition.id,journal.id),listed=await adapter.list();
  let nativeId=recoverPublicationPlaylist(definition,listed,existingId??journal.native_id??undefined),previous=JSON.parse(journal.previous_ids_json) as string[],previousName=journal.previous_name??definition.name;
  const remoteName=nativeId?listed.find(item=>item.id===nativeId)?.name:undefined;
  const recoveredJournal=remoteName?.startsWith(`Curator pending ${definition.id} `)?remoteName.slice(`Curator pending ${definition.id} `.length):null;
  let created=Boolean(remoteName?.startsWith(`Curator pending ${definition.id} `)),applied=false;
  const checkpoint=(status:string,error='')=>db().transaction(()=>{
    assertOwnership();if(status==='verified')assertCurrent();
    const result=db().prepare('UPDATE playlist_publications SET native_id=?,previous_ids_json=?,previous_name=?,status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(nativeId??null,JSON.stringify(previous),previousName,status,error,journal.id);
    if(status==='verified')db().prepare("UPDATE playlist_publications SET status='superseded',native_id=coalesce(native_id,?),updated_at=CURRENT_TIMESTAMP WHERE playlist_id=? AND owner_user_id=? AND id<>? AND (native_id=? OR id=?) AND status IN ('prepared','creating','applying','uncertain')")
      .run(nativeId,definition.id,definition.ownerUserId,journal.id,nativeId,recoveredJournal);
    return result;
  }).immediate();
  try{
    if(!nativeId){
      assertCurrent();assertOwnership();previous=[];previousName=temporaryName;checkpoint('creating');
      nativeId=await adapter.create(temporaryName,ids);created=true;
      if(!nativeId)throw new Error('Navidrome returned no playlist identity');
      checkpoint('applying');
    }
    const actual=await adapter.items(nativeId);
    if(['prepared','verified','rolled_back'].includes(journal.status)&&!created){previous=actual;previousName=remoteName??definition.name;checkpoint('applying')}
    assertCurrent();
    if(!same(actual,ids)||created||remoteName!==definition.name){
      // Even a recovered create must be renamed from its journal marker.
      assertOwnership();applied=true;await adapter.update(nativeId,definition.name,ids);
    }
    const verified=await (adapter.verify?adapter.verify(nativeId,ids):adapter.items(nativeId));
    if(!same(verified,ids))throw new Error(`Navidrome playlist verification failed: expected ${ids.length} tracks, received ${verified.length}`);
    assertCurrent();checkpoint('verified');
    return {playlistId:nativeId,publicationId:journal.id};
  }catch(error){
    // A stale worker must not roll back or overwrite its successor's journal.
    try{assertOwnership()}catch{throw error}
    // Never delete an uncertain create. Its unique name permits recovery after
    // a lost response, process death or expired lease.
    if(applied&&!created&&nativeId){
      try{await adapter.update(nativeId,previousName,previous);checkpoint('rolled_back',String(error))}
      catch{checkpoint('uncertain',String(error))}
    }else if(applied&&created&&nativeId){
      // Retain the recoverable draft identity while hiding an unverified mix
      // behind its unique pending name. Never delete an uncertain create.
      try{await adapter.update(nativeId,temporaryName,ids)}catch{/* Retry will reconcile this same journal/native identity. */}
      checkpoint('uncertain',String(error));
    }else checkpoint('uncertain',String(error));
    throw error;
  }
}
