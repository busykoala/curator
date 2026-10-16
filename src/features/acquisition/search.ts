import { db } from "@/features/db/client";
import type { AcquisitionTarget } from "./types";
import { album, albumCatalog, parseRelease, pushRelease, releaseIsBlocked, SearchDeferred } from "./lidarr";
import { nativeAlbum, nativeArtist, directCandidates, directArtist, cachedArtistCandidates } from "./discovery";
import { allowedQuality, conflictingAlbum, decodeTitle, matchesAlbum, needsQualityRepair, parserRejections, releaseQuality, repairedTitle, type Release } from "./matching";
import { releaseScore } from "./policy";
import { sourceScores, withHybrid } from "./quality";
import { qbitCapacity, releaseInfoHash } from "./qbittorrent";
import { updateTarget } from "./repository";

export function viable(item:Release,fallback:boolean){return allowedQuality(item,fallback)&&String(item.protocol??"torrent")==="torrent"&&Number(item.seeders??0)>=2&&!(item.rejections as unknown[]|undefined)?.length&&!item.rejected}
export function confirmedGrabConflict(error:unknown){const message=String(error);return/Lidarr \/release failed \(409\)/.test(message)||(/Lidarr \/release failed \(500\)/.test(message)&&/409:Conflict/.test(message)&&/qbittorrent|torrents\/add/i.test(message))}
export function confirmedCandidateFailure(error:unknown){
  const message=String(error);
  if(/JSON value could not be converted|One or more validation errors occurred/i.test(message))return false;
  if(/Lidarr \/release\/push failed \((?:400|409)\)/.test(message))return true;
  return confirmedGrabConflict(error)||(
    /Lidarr \/release(?:\/push)? failed \((?:429|5\d\d)\)/.test(message)&&
    /Downloading torrent failed|Download failed|ReleaseDownloadException|prowlarr.*\/download|\/download\?/i.test(message)
  );
}

export async function findRelease(target:AcquisitionTarget,fallback:boolean,cachedArtistOnly=false):Promise<{grabbed:boolean;reason?:string;searchCompleted?:boolean}> {
  let completed=0;
  const unresolved=db().prepare("SELECT status FROM acquisition_submissions WHERE target_id=?").get(target.id) as {status:string}|undefined;
  if(unresolved?.status==='submitting'||unresolved?.status==='accepted') {
    updateTarget(target.id,{status:'queued',detail_json:JSON.stringify({reason:'Awaiting confirmed download outcome',strategyVersion:3})});
    return {grabbed:false,reason:'Awaiting confirmed download outcome'};
  }
  const metadata=await album(target.lidarr_album_id);
  if(!metadata.monitored||Number(metadata.statistics?.percentOfTracks??0)>=100) {
    updateTarget(target.id,{status:metadata.monitored?'imported':'inactive',next_retry_at:null,detail_json:JSON.stringify({reason:metadata.monitored?'Verified album files in Lidarr':'Album is not monitored',strategyVersion:3})});
    return {grabbed:false,reason:'Album is no longer missing'};
  }
  const day=new Date().toISOString().slice(0,10),attempts=target.attempts_day===day?target.attempts_today+1:1;
  const evidence:Record<string,number>={};
  const discoveryErrors:Array<{stage:string;reason:string;retryAt?:string}>=[];
  let catalog:Awaited<ReturnType<typeof albumCatalog>>|undefined;
  const work=async()=>{
    const scores=sourceScores(),seen=new Set<string>(),failedSources=new Set<string>();let tried=0;
    const discover=async(stage:string,fetcher:()=>Promise<Release[]>)=>{
      try{const items=await fetcher();completed++;return items}catch(error){
        discoveryErrors.push({stage,reason:error instanceof Error?error.message:String(error),...(error instanceof SearchDeferred?{retryAt:error.retryAt}:{})});
        return [];
      }
    };
    const submit=async(items:Release[])=>{
      const filtered:Release[]=[],parsedTitles=new Map<string,Awaited<ReturnType<typeof parseRelease>>>();
      for(const item of items){
        const id=`${item.indexer}:${item.guid}`;
        if(seen.has(id))continue;seen.add(id);
        for(const reason of (item.rejections as string[]|undefined)??[])evidence[reason]=(evidence[reason]??0)+1;
        const reject=(reason:string)=>{evidence[reason]=(evidence[reason]??0)+1};
        if(!allowedQuality(item,fallback)){reject('Unsupported or unreported audio quality');continue}
        if(item.direct&&!item.downloadUrl&&!item.magnetUrl){reject('Missing torrent download handle');continue}
        if(Number(item.seeders??0)<2){reject('Fewer than two reported seeders');continue}
        if(String(item.protocol??'torrent')!=='torrent'){reject('Unsupported download protocol');continue}
        let matched=matchesAlbum(item,metadata,target.artist);
        if(!matched){
          // Artist aliases and generic titles require the original source title
          // to resolve to exactly this identity. Recording/edition restrictions
          // still apply; an unfamiliar credit alone is not proof of a mismatch.
          const raw=decodeTitle(String(item.title)),parsed=await parseRelease(raw);
          parsedTitles.set(raw,parsed);
          matched=matchesAlbum(item,metadata,target.artist,parsed);
        }
        if(!matched){reject('Different artist, album or recording variant');continue}
        if(viable(item,fallback)||parserRejections(item)||needsQualityRepair(item)||Boolean(item.direct))filtered.push(item);
      }
      const candidates=filtered.map(item=>{
        const source=String(item.indexer??'unknown'),sourceScore=scores.find(s=>s.name===source.replace(/ \(Prowlarr\)$/i,''))?.score??.5;
        return {item,source,score:releaseScore({seeders:Number(item.seeders),size:Number(item.size),trackCount:10,quality:releaseQuality(item),sourceScore,importRate:sourceScore})};
      }).sort((a,b)=>b.score-a.score);
      for(const {item,source,score} of candidates) {
        if(failedSources.has(source))continue;
        const hash=releaseInfoHash(item);
        if(hash&&db().prepare("SELECT 1 FROM source_outcomes WHERE event IN ('replacement','unavailable','submission_failure') AND lower(json_extract(detail_json,'$.hash'))=? AND created_at>=datetime('now','-1 day') LIMIT 1").get(hash)){
          evidence['Recently failed torrent hash']=(evidence['Recently failed torrent hash']??0)+1;continue;
        }
        if(db().prepare("SELECT 1 FROM source_outcomes WHERE event IN ('replacement','submission_failure') AND json_extract(detail_json,'$.guid')=? AND created_at>=datetime('now','-1 day') LIMIT 1").get(String(item.guid))){evidence['Recently failed source release']=(evidence['Recently failed source release']??0)+1;continue}
        if(await releaseIsBlocked(item)){evidence['Previously blocklisted release']=(evidence['Previously blocklisted release']??0)+1;continue}
        if(tried>=3)return false;
        // Artist search results may be approved for a different album (including
        // an unmonitored EP). Validate every original title before using its
        // cached grab handle; never rename a positively identified other album.
        const original=parsedTitles.get(decodeTitle(String(item.title)))??await parseRelease(decodeTitle(String(item.title)));
        const exact=(parsed:typeof original)=>parsed.artist?.id===metadata.artistId&&parsed.albums?.length===1&&parsed.albums[0].id===metadata.id;
        if((original.artist&&original.artist.id!==metadata.artistId)||(original.albums?.length&&!exact(original))){
          evidence['Original title resolves to a different album']=(evidence['Original title resolves to a different album']??0)+1;continue;
        }
        const repair=Boolean(item.direct)||parserRejections(item)||needsQualityRepair(item)||!exact(original),title=repair?repairedTitle(item,metadata,target.artist):decodeTitle(String(item.title));
        if(repair){
          catalog??=await albumCatalog(metadata.artistId);
          if(conflictingAlbum(item,metadata,catalog,target.artist)){evidence['Title names another catalogue album']=(evidence['Title names another catalogue album']??0)+1;continue}
          const parsed=await parseRelease(title);if(parsed.artist?.id!==metadata.artistId||parsed.albums?.length!==1||parsed.albums[0].id!==metadata.id){evidence['Ambiguous normalized album identity']=(evidence['Ambiguous normalized album identity']??0)+1;continue}
        }
        tried++;
        const capacity=await qbitCapacity(),size=Number(item.size)||0;
        if(size<=0){evidence['Unknown release size']=(evidence['Unknown release size']??0)+1;continue}
        db().transaction(()=>{
          const pending=db().prepare("SELECT count(*) n,coalesce(sum(json_extract(detail_json,'$.size')),0) bytes FROM acquisition_submissions WHERE status IN ('submitting','accepted')").get() as {n:number;bytes:number};
          const required=capacity.bytesLeft+pending.bytes+size;
          if(capacity.incomplete+pending.n>=96||required>100*1024**3||!Number.isFinite(capacity.freeBytes)||capacity.freeBytes<required+20*1024**3)
            throw new SearchDeferred(new Date(Date.now()+60_000).toISOString(),'Waiting for download or storage capacity');
          db().prepare("INSERT INTO acquisition_submissions(target_id,guid,status,detail_json) VALUES(?,?,'submitting',?) ON CONFLICT(target_id) DO UPDATE SET guid=excluded.guid,status='submitting',detail_json=excluded.detail_json,created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").run(target.id,String(item.guid),JSON.stringify({rawTitle:item.title,title,source,repair,size,hash}));
        }).immediate();
        try{
          // Always re-evaluate the verified title. Cached manual grabs reuse a
          // RemoteAlbum which may resolve differently from the current parse.
          const result=await pushRelease({...item,title,albumId:metadata.id,artistId:metadata.artistId,...(hash?{infoHash:hash}:{}),...(item.direct?{indexerId:0}:{})});
          if(!result.approved||result.rejected){
            for(const reason of (result.rejections as string[]|undefined)??['Release push was not approved'])evidence[reason]=(evidence[reason]??0)+1;
            db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);continue;
          }
        }catch(error){
          if(error instanceof SearchDeferred){db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);throw error}
          if(/Lidarr \/release\/push failed \(400\)/.test(String(error))&&/JSON value could not be converted|One or more validation errors occurred/i.test(String(error))){
            db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
            db().prepare("INSERT INTO source_outcomes(indexer_name,event,detail_json) VALUES(?,'submission_invalid',?)").run(source,JSON.stringify({albumId:metadata.id,reason:String(error).slice(0,1200)}));
            throw error;
          }
          if(!confirmedCandidateFailure(error))throw error; // Ambiguous submissions remain persisted for reconciliation.
          db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
          failedSources.add(source);
          db().prepare("INSERT INTO source_outcomes(indexer_name,event,detail_json) VALUES(?,'grab_failure',?)").run(source,JSON.stringify({albumId:metadata.id,guid:item.guid,reason:String(error).slice(0,1200)}));continue;
        }
        db().prepare("UPDATE acquisition_submissions SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE target_id=?").run(target.id);
        updateTarget(target.id,{status:'queued',source_name:source,last_release_guid:String(item.guid),attempts_today:attempts,attempts_day:day,last_search_at:new Date().toISOString(),next_retry_at:null,quality_phase:fallback?'hybrid':'lossless',detail_json:JSON.stringify({reason:'Accepted by Lidarr; awaiting transfer confirmation',rawTitle:item.title,title,score,strategyVersion:3})});
        return true;
      }
      return false;
    };
    const sameArtist=(db().prepare("SELECT count(*) n FROM acquisition_targets WHERE lidarr_artist_id=? AND status IN ('pending','staged')").get(target.lidarr_artist_id) as {n:number}).n;
    if(cachedArtistOnly){return {grabbed:Boolean(target.lidarr_artist_id&&await submit(await discover('cached artist',()=>cachedArtistCandidates(target.lidarr_artist_id!))))}}
    const artistFirst=Boolean(target.lidarr_artist_id)&&(sameArtist>1||Boolean(metadata.disambiguation));
    // Provider-scoped discovery is independent of Lidarr's all-indexer fanout.
    // Share broad artist results with siblings before spending album queries.
    if(artistFirst&&await submit(await discover('direct artist',()=>directArtist(target.lidarr_artist_id!,target.artist))))return {grabbed:true};
    if(tried<3&&await submit(await discover('alternate sources',()=>directCandidates(target.artist,metadata.title))))return {grabbed:true};
    if(tried<3&&await submit(await discover('remaining sources',()=>directCandidates(target.artist,metadata.title,true))))return {grabbed:true};
    if(artistFirst&&await submit(await discover('artist',()=>nativeArtist(target.lidarr_artist_id!))))return {grabbed:true};
    if(await submit(await discover('album',()=>nativeAlbum(metadata.id))))return {grabbed:true};
    if(!artistFirst&&target.lidarr_artist_id&&await submit(await discover('artist',()=>nativeArtist(target.lidarr_artist_id!))))return {grabbed:true};
    const reason=discoveryErrors.length?'Some search sources unavailable; alternatives checked':Object.keys(evidence).length?'Search results rejected; see rejection reasons':'No matching results in completed searches';
    // Completed searches back off to let other albums use the budget. When all
    // providers defer, retry when the first independent route can recover.
    const deferredTimes=discoveryErrors.map(e=>Date.parse(e.retryAt??'')).filter(t=>Number.isFinite(t)&&t>Date.now());
    const retryAt=completed?Date.now()+(discoveryErrors.length?6:24)*3600_000:Math.max(Date.now()+5*60_000,deferredTimes.length?Math.min(...deferredTimes):0);
    updateTarget(target.id,{status:'staged',attempts_today:completed?attempts:(target.attempts_day===day?target.attempts_today:0),attempts_day:day,last_search_at:completed?new Date().toISOString():target.last_search_at,next_retry_at:new Date(retryAt).toISOString(),quality_phase:fallback?'hybrid':'lossless',detail_json:JSON.stringify({reason,rejections:evidence,...(discoveryErrors.length?{sourceErrors:discoveryErrors}:{}),strategyVersion:3})});
    return {grabbed:false,reason};
  };
  try{const result=fallback&&target.lidarr_artist_id?await withHybrid(target.lidarr_artist_id,work):await work();return {...result,searchCompleted:completed>0}}
  catch(error){if(error instanceof SearchDeferred){updateTarget(target.id,{status:'staged',next_retry_at:error.retryAt,detail_json:JSON.stringify({reason:error.message,strategyVersion:3})});return{grabbed:false,reason:error.message}}throw error}
}
