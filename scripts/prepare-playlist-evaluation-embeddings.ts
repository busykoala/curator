import {mkdirSync,writeFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {config} from '../src/config';
import {db,stateSet} from '../src/features/db/client';
import {preparePlaylistEmbeddings,localRetrievalProvider} from '../src/features/playlists/retrieval';
async function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||!target.endsWith('.sqlite')||config.DATABASE_PATH!==target)throw Error('Only a separately supplied temporary evaluation database is permitted');
  const database=db(),source=new Database('/app/data/curator.sqlite',{readonly:true,fileMustExist:true});stateSet('paused','false');
  const output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/embeddings';mkdirSync(output,{recursive:true});
  const report:{startedAt:string;model:string;scope:string;cycles:Array<Record<string,unknown>>;completedAt?:string}={startedAt:new Date().toISOString(),model:config.CURATOR_EMBEDDING_VERSION,scope:'Local musical descriptions only; temporary database copy; at most 128 tracks per minute; yields to real interactive chat.',cycles:[]};
  let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
  const busy=()=>Boolean(source.prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get());
  const provider={...localRetrievalProvider,async embed(texts:string[],signal?:AbortSignal){if(busy())throw Error('Embedding preparation yielded to interactive chat');return localRetrievalProvider.embed(texts,signal)}};
  try{while(!stopped){
    const started=Date.now();let completed=0,error='';try{if(!busy())completed=await preparePlaylistEmbeddings(128,provider)}catch(cause){error=String(cause).slice(0,300)}
    const total=(database.prepare('SELECT count(*) n FROM playlist_track_embeddings WHERE model_version=?').get(config.CURATOR_EMBEDDING_VERSION) as {n:number}).n;
    const eligible=(database.prepare("SELECT count(*) n FROM files f JOIN track_profiles p ON p.file_id=f.id WHERE f.status='written' AND p.status='complete'").get() as {n:number}).n;
    const cycle={at:new Date(started).toISOString(),completed,total,eligible,error,durationMs:Date.now()-started};report.cycles.push(cycle);console.log(JSON.stringify(cycle));
    if(total>=eligible&&!error){report.completedAt=new Date().toISOString();stopped=true}
    writeFileSync(output+'/report.json',JSON.stringify(report,null,2));
    if(!stopped)await new Promise(resolve=>setTimeout(resolve,Math.max(1000,60000-(Date.now()-started))));
  }}finally{source.close();database.close()}
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
