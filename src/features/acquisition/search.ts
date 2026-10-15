import { config } from "@/config";
import { db } from "@/features/db/client";
import type { AcquisitionTarget } from "./types";
import { album, grabRelease, parseRelease, pushRelease, releaseIsBlocked, SearchDeferred } from "./lidarr";
import { nativeAlbum, nativeArtist, directCandidates } from "./discovery";
import { allowedQuality, matchesAlbum, parserRejections, releaseQuality, repairedTitle, type Release } from "./matching";
import { releaseScore } from "./policy";
import { sourceScores, withHybrid } from "./quality";
import { qbitCapacity, qbitTorrent, releaseInfoHash, removeTorrent } from "./qbittorrent";
import { destructiveAllowed, intervene, updateTarget } from "./repository";

export function viable(item:Release,fallback:boolean){return allowedQuality(item,fallback)&&String(item.protocol??"torrent")==="torrent"&&Number(item.seeders??0)>=2&&!(item.rejections as unknown[]|undefined)?.length&&!item.rejected}
export function confirmedGrabConflict(error:unknown){const message=String(error);return/Lidarr \/release failed \(409\)/.test(message)||(/Lidarr \/release failed \(500\)/.test(message)&&/409:Conflict/.test(message)&&/qbittorrent|torrents\/add/i.test(message))}
export function confirmedCandidateFailure(error:unknown){
  const message=String(error);
  if(/Lidarr \/release\/push failed \((?:400|409)\)/.test(message))return true;
  return confirmedGrabConflict(error)||(
    /Lidarr \/release failed \((?:429|5\d\d)\)/.test(message)&&
    /Downloading torrent failed|Download failed|ReleaseDownloadException|prowlarr.*\/download|\/download\?/i.test(message)
  );
}

export async function findRelease(target:AcquisitionTarget,fallback:boolean,cachedArtistOnly=false) {
  const unresolved=db().prepare("SELECT status FROM acquisition_submissions WHERE target_id=?").get(target.id) as {status:string}|undefined;
  if(unresolved?.status==='submitting'||unresolved?.status==='accepted') {
    updateTarget(target.id,{status:'queued',detail_json:JSON.stringify({reason:'Awaiting confirmed download outcome',strategyVersion:2})});
    return {grabbed:false,reason:'Awaiting confirmed download outcome'};
  }
  const metadata=await album(target.lidarr_album_id);
  if(!metadata.monitored||Number(metadata.statistics?.percentOfTracks??0)>=100) {
    updateTarget(target.id,{status:metadata.monitored?'imported':'inactive',next_retry_at:null,detail_json:JSON.stringify({reason:metadata.monitored?'Verified album files in Lidarr':'Album is not monitored',strategyVersion:2})});
    return {grabbed:false,reason:'Album is no longer missing'};
  }
  const day=new Date().toISOString().slice(0,10),attempts=target.attempts_day===day?target.attempts_today+1:1;
  const evidence:Record<string,number>={};
  const work=async()=>{
    const scores=sourceScores(),seen=new Set<string>(),failedSources=new Set<string>();let tried=0;
    const submit=async(items:Release[])=>{
      const candidates=items.filter(item=>{
        const id=`${item.indexer}:${item.guid}`;
        if(seen.has(id))return false;seen.add(id);
        for(const reason of (item.rejections as string[]|undefined)??[])evidence[reason]=(evidence[reason]??0)+1;
        return allowedQuality(item,fallback)&&Number(item.seeders??0)>=2&&String(item.protocol??'torrent')==='torrent'&&matchesAlbum(item,metadata,target.artist)&&
          (viable(item,fallback)||parserRejections(item)||Boolean(item.direct));
      }).map(item=>{
        const source=String(item.indexer??'unknown'),sourceScore=scores.find(s=>s.name===source.replace(/ \(Prowlarr\)$/i,''))?.score??.5;
        return {item,source,score:releaseScore({seeders:Number(item.seeders),size:Number(item.size),trackCount:10,quality:releaseQuality(item),sourceScore,importRate:sourceScore})};
      }).sort((a,b)=>b.score-a.score);
      for(const {item,source,score} of candidates) {
        if(failedSources.has(source))continue;
        const hash=releaseInfoHash(item);
        if(hash&&db().prepare("SELECT 1 FROM source_outcomes WHERE event IN ('replacement','unavailable') AND lower(json_extract(detail_json,'$.hash'))=? AND created_at>=datetime('now','-1 day') LIMIT 1").get(hash)){
          evidence['Recently failed torrent hash']=(evidence['Recently failed torrent hash']??0)+1;continue;
        }
        if(await releaseIsBlocked(item)){evidence['Previously blocklisted release']=(evidence['Previously blocklisted release']??0)+1;continue}
        if(tried>=3)return false;
        const repair=Boolean(item.direct)||parserRejections(item),title=repair?repairedTitle(item,metadata,target.artist):String(item.title);
        if(repair){const parsed=await parseRelease(title);if(parsed.artist?.id!==metadata.artistId||parsed.albums?.length!==1||parsed.albums[0].id!==metadata.id){evidence['Ambiguous normalized album identity']=(evidence['Ambiguous normalized album identity']??0)+1;continue}}
        tried++;
        const capacity=await qbitCapacity(),size=Number(item.size)||0;
        if(size<=0){evidence['Unknown release size']=(evidence['Unknown release size']??0)+1;continue}
        db().transaction(()=>{
          const pending=db().prepare("SELECT count(*) n,coalesce(sum(json_extract(detail_json,'$.size')),0) bytes FROM acquisition_submissions WHERE status IN ('submitting','accepted')").get() as {n:number;bytes:number};
          const required=capacity.bytesLeft+pending.bytes+size;
          if(capacity.incomplete+pending.n>=96||required>100*1024**3||!Number.isFinite(capacity.freeBytes)||capacity.freeBytes<required+20*1024**3)
            throw new SearchDeferred(new Date(Date.now()+60_000).toISOString(),'Waiting for download or storage capacity');
          db().prepare("INSERT INTO acquisition_submissions(target_id,guid,status,detail_json) VALUES(?,?,'submitting',?) ON CONFLICT(target_id) DO UPDATE SET guid=excluded.guid,status='submitting',detail_json=excluded.detail_json,created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").run(target.id,String(item.guid),JSON.stringify({rawTitle:item.title,title,source,repair,size}));
        }).immediate();
        try{
          if(repair){
            // Re-run all Lidarr decision specifications; manual cached grabs
            // would bypass size, quality, monitoring and blocklist checks.
            const result=await pushRelease({...item,title,albumId:metadata.id,artistId:metadata.artistId,...(item.direct?{indexerId:0}:{})});
            if(!result.approved||result.rejected){
              for(const reason of (result.rejections as string[]|undefined)??['Release push was not approved'])evidence[reason]=(evidence[reason]??0)+1;
              db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);continue;
            }
          }else{
            try{await grabRelease(item)}catch(error){
              if(!confirmedGrabConflict(error))throw error;
              const hash=releaseInfoHash(item),torrent=hash?await qbitTorrent(hash):undefined;
              if(!torrent||torrent.category!==config.QBITTORRENT_CATEGORY||torrent.progress<1||!destructiveAllowed())throw error;
              await removeTorrent(hash,false);
              intervene({targetId:target.id,hash,action:'cleanup',status:'applied',evidence:{reason:'Completed duplicate record removed; payload preserved'}});
              await new Promise(r=>setTimeout(r,1000));await grabRelease(item);
            }
          }
        }catch(error){
          if(error instanceof SearchDeferred){db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);throw error}
          if(!confirmedCandidateFailure(error))throw error; // Ambiguous submissions remain persisted for reconciliation.
          db().prepare("DELETE FROM acquisition_submissions WHERE target_id=?").run(target.id);
          failedSources.add(source);
          db().prepare("INSERT INTO source_outcomes(indexer_name,event,detail_json) VALUES(?,'grab_failure',?)").run(source,JSON.stringify({albumId:metadata.id,guid:item.guid}));continue;
        }
        db().prepare("UPDATE acquisition_submissions SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE target_id=?").run(target.id);
        updateTarget(target.id,{status:'queued',source_name:source,last_release_guid:String(item.guid),attempts_today:attempts,attempts_day:day,last_search_at:new Date().toISOString(),next_retry_at:null,quality_phase:fallback?'hybrid':'lossless',detail_json:JSON.stringify({reason:'Accepted by Lidarr; awaiting transfer confirmation',rawTitle:item.title,title,score,strategyVersion:2})});
        return true;
      }
      return false;
    };
    const sameArtist=(db().prepare("SELECT count(*) n FROM acquisition_targets WHERE lidarr_artist_id=? AND status IN ('pending','staged')").get(target.lidarr_artist_id) as {n:number}).n;
    if(cachedArtistOnly){return {grabbed:Boolean(target.lidarr_artist_id&&await submit(await nativeArtist(target.lidarr_artist_id)))}}
    const artistFirst=Boolean(target.lidarr_artist_id)&&(sameArtist>1||Boolean(metadata.disambiguation));
    if(artistFirst&&await submit(await nativeArtist(target.lidarr_artist_id!)))return {grabbed:true};
    if(await submit(await nativeAlbum(metadata.id)))return {grabbed:true};
    if(!artistFirst&&target.lidarr_artist_id&&await submit(await nativeArtist(target.lidarr_artist_id)))return {grabbed:true};
    if(tried<3&&await submit(await directCandidates(target.artist,metadata.title)))return {grabbed:true};
    const reason=Object.keys(evidence).length?'Search results rejected; see rejection reasons':'No matching results in completed searches';
    updateTarget(target.id,{status:'staged',attempts_today:attempts,attempts_day:day,last_search_at:new Date().toISOString(),next_retry_at:new Date(Date.now()+24*3600_000).toISOString(),quality_phase:fallback?'hybrid':'lossless',detail_json:JSON.stringify({reason,rejections:evidence,strategyVersion:2})});
    return {grabbed:false,reason};
  };
  try{return fallback&&target.lidarr_artist_id?await withHybrid(target.lidarr_artist_id,work):await work()}
  catch(error){if(error instanceof SearchDeferred){updateTarget(target.id,{status:'staged',next_retry_at:error.retryAt,detail_json:JSON.stringify({reason:error.message,strategyVersion:2})});return{grabbed:false,reason:error.message}}throw error}
}
