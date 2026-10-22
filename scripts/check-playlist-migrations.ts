import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {existsSync,chmodSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {config} from '../src/config';
import {db} from '../src/features/db/client';

// Rehearse migrations on a fresh consistent copy. Never start application
// workers or open the production database through the migrating client.
async function main(){
  const target=process.env.PLAYLIST_MIGRATION_DB;
  if(!target?.startsWith('/tmp/curator-renewal-migration-')||!target.endsWith('.sqlite')||config.DATABASE_PATH!==target||existsSync(target))throw Error('Supply a new, explicitly named private migration copy');
  const started=Date.now(),source=new Database('/app/data/curator.sqlite',{readonly:true,fileMustExist:true});
  try{await source.backup(target)}finally{source.close()}
  chmodSync(target,0o600);
  const tracked={
    definitions:'SELECT id,name,category,enabled,intent,config_json,owner_user_id,navidrome_playlist_id,last_run_at FROM smart_playlists ORDER BY id',
    snapshots:'SELECT id,playlist_id,owner_user_id,status,preview,config_hash,detail_json,finished_at FROM playlist_runs ORDER BY id',
    songs:'SELECT run_id,playlist_id,file_id,navidrome_song_id,position,score,origin,reason,retained FROM playlist_items ORDER BY run_id,position,file_id',
    files:'SELECT id,path,album_key,artist_name,album_name,status,tags_json,properties_json FROM files ORDER BY id',
    profiles:'SELECT file_id,profile_json,provenance_json,manual_json,status FROM track_profiles ORDER BY file_id',
    users:'SELECT id,navidrome_user_id,username,token_ciphertext,token_iv,token_tag,token_status FROM curator_users ORDER BY id',
  };
  function inspect(database:Database.Database){
    const preserved:Record<string,{rows:number;hash:string}>={};
    for(const[name,sql]of Object.entries(tracked)){const hash=createHash('sha256');let rows=0;for(const row of database.prepare(sql).iterate()){hash.update(JSON.stringify(row)+'\n');rows++}preserved[name]={rows,hash:hash.digest('hex')}}
    return{schema:(database.prepare('SELECT max(version) n FROM schema_migrations').get() as {n:number}).n,preserved,foreignKeys:database.pragma('foreign_key_check')};
  }
  const original=new Database(target,{readonly:true,fileMustExist:true}),before=inspect(original);original.close();
  let after:ReturnType<typeof inspect>|undefined;
  for(let pass=0;pass<2;pass++){
    const migrated=db();after=inspect(migrated);
    if(JSON.stringify(before.preserved)!==JSON.stringify(after.preserved)||JSON.stringify(before.foreignKeys)!==JSON.stringify(after.foreignKeys))throw Error('Migration changed preserved user/library/playlist data or foreign-key integrity');
    if(after.schema!==27)throw Error('Expected all playlist migrations through version 27');
    if((migrated.prepare('SELECT count(*) n FROM playlist_refresh_jobs').get() as {n:number}).n||
      (migrated.prepare('SELECT count(*) n FROM playlist_publications').get() as {n:number}).n)throw Error('Migration unexpectedly created refresh or publication work');
    migrated.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;
  }
  const report={at:new Date().toISOString(),durationMs:Date.now()-started,scope:'Consistent read-only production copy, two migration passes, no workers/inference/acquisition/publication. Hashes cover preserved definitions, snapshots, song ordering, library metadata/profiles and encrypted credential fields; credentials are never printed.',before,after,passes:2,preserved:true};
  const output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/migration-rehearsal';mkdirSync(output,{recursive:true,mode:0o700});writeFileSync(output+'/report.json',JSON.stringify(report,null,2),{mode:0o600});
  unlinkSync(target);for(const sidecar of ['-wal','-shm'])if(existsSync(target+sidecar))unlinkSync(target+sidecar);
  console.log(JSON.stringify({preserved:true,passes:2,from:before.schema,to:after?.schema,durationMs:report.durationMs}));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Migration rehearsal failed');process.exitCode=1});
