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
type Publication={id:string;native_id:string|null;previous_ids_json:string;status:string};
const same=(a:string[],b:string[])=>a.length===b.length&&a.every((id,i)=>id===b[i]);

// Native APIs and SQLite cannot share a transaction. Journal the intent first,
// recover creates by a unique temporary name, then confirm exact ordering. A
// retry always reads the remote state before issuing another mutation.
export async function publishVerifiedPlaylist(definition:PlaylistDefinition,ids:string[],existingId:string|undefined,adapter:PublicationAdapter,assertCurrent:()=>void){
  if(!ids.length||new Set(ids).size!==ids.length)throw new Error('Refusing an empty or duplicate playlist publication');
  assertCurrent();
  const hash=publicationHash(ids),revision=definition.revision??1;
  db().prepare("INSERT OR IGNORE INTO playlist_publications(id,playlist_id,owner_user_id,revision,selection_hash,song_ids_json,native_id) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(),definition.id,definition.ownerUserId,revision,hash,JSON.stringify(ids),existingId??null);
  const journal=db().prepare('SELECT id,native_id,previous_ids_json,status FROM playlist_publications WHERE playlist_id=? AND revision=? AND selection_hash=?').get(definition.id,revision,hash) as Publication;
  const temporaryName=`Curator pending ${definition.id} ${journal.id}`;
  let nativeId=journal.native_id??existingId,previous=JSON.parse(journal.previous_ids_json) as string[],created=false,applied=false;
  const checkpoint=(status:string,error='')=>db().prepare('UPDATE playlist_publications SET native_id=?,previous_ids_json=?,status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(nativeId??null,JSON.stringify(previous),status,error,journal.id);
  try{
    if(!nativeId){
      const recovered=(await adapter.list()).filter(p=>p.name===temporaryName);
      if(recovered.length>1)throw new Error('Multiple pending native playlists require review');
      nativeId=recovered[0]?.id;created=Boolean(nativeId);
      if(!nativeId){
        assertCurrent();checkpoint('creating');
        nativeId=await adapter.create(temporaryName,ids);created=true;
        if(!nativeId)throw new Error('Navidrome returned no playlist identity');
      }
      checkpoint('applying');
    }
    const actual=await adapter.items(nativeId);
    if(['prepared','verified','rolled_back'].includes(journal.status)&&!created){previous=actual;checkpoint('applying')}
    assertCurrent();
    if(!same(actual,ids)||created){
      // Even a recovered create must be renamed from its journal marker.
      applied=true;await adapter.update(nativeId,definition.name,ids);
    }
    const verified=await (adapter.verify?adapter.verify(nativeId,ids):adapter.items(nativeId));
    if(!same(verified,ids))throw new Error(`Navidrome playlist verification failed: expected ${ids.length} tracks, received ${verified.length}`);
    assertCurrent();checkpoint('verified');
    return {playlistId:nativeId,publicationId:journal.id};
  }catch(error){
    // Never delete an uncertain create. Its unique name permits recovery after
    // a lost response, process death or expired lease.
    if(applied&&!created&&nativeId){
      try{await adapter.update(nativeId,definition.name,previous);checkpoint('rolled_back',String(error))}
      catch{checkpoint('uncertain',String(error))}
    }else checkpoint('uncertain',String(error));
    throw error;
  }
}
