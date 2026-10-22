import Database from 'better-sqlite3';
import {createHash,createDecipheriv} from 'node:crypto';
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {config} from '../src/config';
import {scheduledDateInstant} from '../src/features/playlists/refresh-policy';

type Definition={id:number;owner_user_id:number;name:string;category:string;enabled:number;revision:number;created_at:string;config_json:string};
type Run={id:number;finished_at:string|null;detail_json:string;preview:number;source_kind:string;source_preview_id:number|null;owner_user_id:number};
type Job={id:string;status:string;attempts:number;run_id:number|null;updated_at:number;error:string;result_json:string;mode:string};
type NativeItem={Id:string;Name?:string};
const time=(value:string|null)=>value?Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z'):NaN;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main(){
  const date=process.env.PLAYLIST_OBSERVER_DATE,kind=process.env.PLAYLIST_OBSERVER_KIND==='shadow'?'shadow':'nightly';
  if(!date||!/^20\d\d-\d\d-\d\d$/.test(date))throw Error('Supply the exact Zurich scheduled date');
  const scheduled=scheduledDateInstant(date),deadline=scheduled+90*60_000,now=Date.now();
  const database=new Database(config.DATABASE_PATH,{readonly:true,fileMustExist:true,timeout:5000});
  const state=(key:string,fallback='')=>(database.prepare('SELECT value FROM state WHERE key=?').get(key) as {value:string}|undefined)?.value??fallback;
  const mode=state('playlist_refresh_mode','off'),canaries=state('playlist_refresh_canary_ids','6').split(',').map(Number);
  const definitions=(database.prepare('SELECT id,owner_user_id,name,category,enabled,revision,created_at,config_json FROM smart_playlists WHERE enabled=1 AND owner_user_id IS NOT NULL ORDER BY id').all() as Definition[])
    .filter(p=>time(p.created_at)<=scheduled&&(kind==='shadow'||mode==='enabled'||mode==='canary'&&canaries.includes(p.id)));
  const tokens=new Map<number,string>(),inventories=new Map<number,Promise<NativeItem[]>>();
  async function native<T>(ownerId:number,path:string):Promise<T>{
    let token=tokens.get(ownerId);
    if(!token){
      const row=database.prepare('SELECT token_ciphertext,token_iv,token_tag FROM curator_users WHERE id=?').get(ownerId) as {token_ciphertext:string|null;token_iv:string|null;token_tag:string|null}|undefined;
      if(!row?.token_ciphertext||!row.token_iv||!row.token_tag)throw Error('Native credentials are unavailable');
      const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(config.CURATOR_CREDENTIAL_KEY).digest(),Buffer.from(row.token_iv,'base64'));decipher.setAuthTag(Buffer.from(row.token_tag,'base64'));
      token=Buffer.concat([decipher.update(Buffer.from(row.token_ciphertext,'base64')),decipher.final()]).toString('utf8');tokens.set(ownerId,token);
    }
    const response=await fetch(config.NAVIDROME_URL.replace(/\/$/,'')+'/jellyfin/'+path,{headers:{'X-Emby-Token':token},signal:AbortSignal.timeout(12000),cache:'no-store'});
    if(!response.ok)throw Error('Native verification returned HTTP '+response.status);
    return response.json() as Promise<T>;
  }
  async function pages(ownerId:number,path:string){
    const items:NativeItem[]=[],seen=new Set<string>();let total:number|undefined;
    for(let offset=0;offset<10000;){
      const page=await native<{Items?:NativeItem[];TotalRecordCount?:number}>(ownerId,path+(path.includes('?')?'&':'?')+'Limit=500&StartIndex='+offset),rows=page.Items??[];
      if(page.TotalRecordCount!=null){if(!Number.isInteger(page.TotalRecordCount)||page.TotalRecordCount<0||total!=null&&total!==page.TotalRecordCount)throw Error('Native inventory changed during verification');total=page.TotalRecordCount}
      for(const row of rows){if(!row.Id||seen.has(row.Id))throw Error('Native verification repeated an identity');seen.add(row.Id);items.push(row)}
      offset+=rows.length;if(total!=null&&offset>total)throw Error('Native verification exceeded the declared count');
      if(total!=null&&offset===total)return items;
      if(!rows.length){if(total!=null)throw Error('Native verification is incomplete');return items}
      if(total==null&&rows.length<500)return items;
    }
    throw Error('Native verification exceeded its pagination bound');
  }
  const results:Array<Record<string,unknown>>=[];
  try{for(const p of definitions){
    const job=database.prepare('SELECT id,status,attempts,run_id,updated_at,error,result_json,mode FROM playlist_refresh_jobs WHERE playlist_id=? AND owner_user_id=? AND scheduled_date=? AND kind=?').get(p.id,p.owner_user_id,date,kind) as Job|undefined;
    const proposed=job?.run_id?database.prepare('SELECT id,finished_at,detail_json,preview,source_kind,source_preview_id,owner_user_id FROM playlist_runs WHERE id=? AND playlist_id=?').get(job.run_id,p.id) as Run|undefined:undefined;
    const published=database.prepare("SELECT id,finished_at,detail_json,preview,source_kind,source_preview_id,owner_user_id FROM playlist_runs WHERE playlist_id=? AND owner_user_id=? AND status='complete' AND preview=0 ORDER BY id DESC LIMIT 1").get(p.id,p.owner_user_id) as Run|undefined;
    const run=kind==='shadow'?proposed:published,detail=JSON.parse(run?.detail_json??'{}'),configValue=JSON.parse(p.config_json),violations:string[]=[];
    const rows=run?database.prepare('SELECT i.file_id,i.navidrome_song_id,i.position,f.artist_name,f.tags_json FROM playlist_items i JOIN files f ON f.id=i.file_id WHERE i.run_id=? ORDER BY i.position').all(run.id) as Array<{file_id:number;navidrome_song_id:string|null;position:number;artist_name:string;tags_json:string}>:[];
    const expected=rows.map(row=>row.navidrome_song_id),requested=Number(detail.evaluation?.requested??configValue.targetTracks),finished=time(run?.finished_at??null);
    if(!run)violations.push('No completed '+(kind==='shadow'?'comparison':'publication'));
    if(run&&run.owner_user_id!==p.owner_user_id)violations.push('Run ownership mismatch');
    if(rows.length!==requested)violations.push('Requested song count is not present');
    if(expected.some(id=>!id)||new Set(expected).size!==expected.length)violations.push('Missing or duplicate native song identities');
    if(detail.evaluation?.violations?.length)violations.push(...detail.evaluation.violations);
    if(detail.evaluation?.shortage)violations.push('Matching-song shortage remains unresolved');
    if(kind==='shadow'&&detail.selectionVersion!==1)violations.push('The comparison has no new-pipeline selection receipt');
    if(kind==='nightly'){
      const receipt=job?.run_id?database.prepare("SELECT detail_json,finished_at FROM playlist_runs WHERE source_preview_id=? AND preview=0 AND status='complete' AND owner_user_id=? ORDER BY id DESC LIMIT 1").get(job.run_id,p.owner_user_id) as {detail_json:string;finished_at:string}|undefined:undefined;
      const modern=receipt?JSON.parse(receipt.detail_json):detail,modernAt=receipt?time(receipt.finished_at):finished;
      if(modern.selectionVersion!==1||!modern.evaluation||modernAt<scheduled||modernAt>deadline)violations.push('No new-pipeline publication receipt in this nightly window');
      if(modern.evaluation?.shortage||modern.evaluation?.violations?.length)violations.push('The nightly publication receipt failed its selection checks');
    }
    const intent=detail.resolvedIntent;
    if(intent){
      for(const pin of detail.protectedSelection?.pins??intent.pinnedRecordings??[])if(!rows.some(row=>row.file_id===pin.fileId))violations.push('A saved valid pin is absent');
      for(const lock of detail.protectedSelection?.positions??intent.positionLocks??[])if(rows[lock.position]?.file_id!==lock.fileId)violations.push('A saved valid position lock changed');
    }
    if(!Number.isFinite(finished)||finished<scheduled||finished>deadline)violations.push('No completed result within the 04:30–06:00 Zurich window');
    let nativeVerification:Record<string,unknown>={notRequested:kind==='shadow'};
    if(kind==='shadow'){
      if(job?.status!=='completed'||JSON.parse(job?.result_json??'{}').unpublished!==true||run?.source_kind!=='shadow'||!run.preview)violations.push('Comparison is not a completed unpublished shadow proposal');
      const children=run?(database.prepare("SELECT count(*) n FROM playlist_runs WHERE source_preview_id=? AND preview=0 AND status='complete'").get(run.id) as {n:number}).n:0;
      if(children)violations.push('A shadow comparison was published');
    }else if(published){
      const nativeId=String(detail.navidromeId??'');
      try{
        if(!nativeId)throw Error('Published native playlist identity is missing');
        if(!inventories.has(p.owner_user_id))inventories.set(p.owner_user_id,pages(p.owner_user_id,'Items?IncludeItemTypes=Playlist&Recursive=true'));
        const listed=await inventories.get(p.owner_user_id)!;
        if(!listed.some(item=>item.Id===nativeId))throw Error('Published playlist is absent from its owner’s native inventory');
        const actual=(await pages(p.owner_user_id,'Playlists/'+encodeURIComponent(nativeId)+'/Items')).map(item=>item.Id),match=JSON.stringify(actual)===JSON.stringify(expected);
        const journal=database.prepare('SELECT native_id FROM playlist_publications WHERE playlist_id=? AND owner_user_id=? AND native_id IS NOT NULL').all(p.id,p.owner_user_id) as Array<{native_id:string}>;
        const liveJournalIds=new Set(journal.filter(row=>listed.some(item=>item.Id===row.native_id)).map(row=>row.native_id));
        if(!match)violations.push('Native selection differs from the latest verified local publication');
        if(liveJournalIds.size>1)violations.push('Multiple live native identities are associated with one playlist');
        nativeVerification={matched:match,count:actual.length,orderedIdsHash:digest(actual),expectedIdsHash:digest(expected),associatedLivePlaylists:liveJournalIds.size};
      }catch(error){violations.push(error instanceof Error?error.message:'Native verification failed');nativeVerification={matched:false,error:violations.at(-1)}}
    }
    const recommendations=database.prepare('SELECT d.status,d.direction_revision,d.evidence_json,r.identity_verified_at FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id WHERE d.playlist_id=? AND d.owner_user_id=?').all(p.id,p.owner_user_id) as Array<{status:string;direction_revision:number;evidence_json:string;identity_verified_at:string|null}>;
    const verified=recommendations.filter(row=>row.direction_revision===p.revision&&row.identity_verified_at&&JSON.parse(row.evidence_json).some((source:{provider:string;url?:string;claims?:object})=>!['musicbrainz','official-release'].includes(source.provider)&&source.url&&source.claims&&Object.keys(source.claims).length));
    results.push({playlistId:p.id,ownerId:p.owner_user_id,name:p.name,category:p.category,job:job?{id:job.id,status:job.status,attempts:job.attempts,mode:job.mode,error:job.error}:null,runId:run?.id??null,sourceKind:run?.source_kind??null,finishedAt:run?.finished_at??null,requested,count:rows.length,evaluation:detail.evaluation??null,nativeVerification,
      discovery:{verifiedPool:verified.filter(row=>['researched','queued','downloading','ready'].includes(row.status)).length,pending:recommendations.filter(row=>['queued','downloading','deferred'].includes(row.status)).length},
      sample:rows.slice(0,6).map(row=>{const tags=JSON.parse(row.tags_json);return{artist:row.artist_name,title:Array.isArray(tags.title)?tags.title[0]:tags.title}}),violations});
  }
  const day=new Date(now).setUTCHours(0,0,0,0),sourceUsage=database.prepare("SELECT count(*) total,coalesce(sum(kind='editorial'),0) editorial,coalesce(sum(kind='search'),0) search FROM playlist_source_requests WHERE created_at>=?").get(day) as {total:number;editorial:number;search:number};
  const admissions=database.prepare("SELECT playlist_id,count(*) n FROM playlist_discovery_admissions WHERE created_at>=? AND status IN ('reserved','admitted') GROUP BY playlist_id").all(new Date(day).toISOString().slice(0,10)) as Array<{playlist_id:number;n:number}>;
  const budgetViolations:string[]=[];if(sourceUsage.total>100||sourceUsage.editorial>20||sourceUsage.search>5)budgetViolations.push('Discovery source budget exceeded');if(admissions.some(row=>row.n>1)||admissions.reduce((n,row)=>n+row.n,0)>3)budgetViolations.push('Discovery admission budget exceeded');
  const violations=results.reduce((n,result)=>n+(result.violations as string[]).length,0)+budgetViolations.length;
  const report={observedAt:new Date(now).toISOString(),scheduledDate:date,kind,mode,scheduledAt:new Date(scheduled).toISOString(),deadline:new Date(deadline).toISOString(),scope:'Read-only production SQLite and owner-authenticated native GET verification. No application startup, migrations, playlist mutation, acquisition or inference. Credentials remain in memory and are never included in the report.',results,sourceUsage,admissions,budgetViolations,summary:{enabledInScope:definitions.length,passed:results.filter(result=>!(result.violations as string[]).length).length,violations,windowHasClosed:now>=deadline,allPassed:definitions.length>0&&violations===0&&mode!=='off'}};
  const output=process.env.PLAYLIST_OBSERVER_OUTPUT??'/tmp/curator-renewal-observations';mkdirSync(output,{recursive:true,mode:0o700});chmodSync(output,0o700);
  const path=join(output,date+'-'+kind+'-'+now+'.json');writeFileSync(path,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({path,...report.summary}));
  }finally{tokens.clear();database.close()}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Playlist observation failed');process.exitCode=1});
