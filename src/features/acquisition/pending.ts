import {type QueueItem,retainMismatchedQueue} from './lidarr';
import {targetByAlbum,updateTarget,intervene} from './repository';
import type {AcquisitionTarget} from './types';

export function blockedNativePending(item:QueueItem,target:AcquisitionTarget,now=Date.now()) {
  if(item.downloadId||item.status!=='delay'||!item.added||!['pending','staged'].includes(target.status))return false;
  const added=Date.parse(item.added);
  if(!Number.isFinite(added)||now-added<30*60_000)return false;
  try {
    const detail=JSON.parse(target.detail_json??'{}');
    return Object.keys(detail.rejections??{}).some(reason=>/^Indexer .+ is blocked till .+ due to failures, cannot grab release\.$/i.test(reason));
  }catch{return false}
}

/** A rejected native HTTP route must not suppress independent source discovery. */
export async function retryBlockedPending(items:QueueItem[],wanted:Set<number>,apply:boolean){
  if(!apply)return items;
  const removed=new Set<number>();
  for(const item of items){
    if(removed.size>=3)break;
    if(!item.albumId||!wanted.has(item.albumId))continue;
    const target=targetByAlbum(item.albumId);
    if(!target||!blockedNativePending(item,target))continue;
    // Remove only the pending decision. Never remove client data, blocklist
    // the torrent, or mark the album imported. Real downloads have an ID and
    // cannot enter this path; a racing native grab keeps its client payload.
    try{
      await retainMismatchedQueue(item);
      updateTarget(target.id,{status:'pending',next_retry_at:null,detail_json:JSON.stringify({reason:'Native HTTP route blocked; retrying independent sources',recoveryRetry:true,strategyVersion:3})});
      intervene({targetId:target.id,action:'retry-pending',status:'applied',evidence:{queueId:item.id,title:item.title,reason:'Native indexer cooldown prevented a transfer; pending decision cleared without deleting or blocklisting data'}});
      removed.add(item.id);
    }catch(error){console.warn(JSON.stringify({event:'acquisition_pending_retry_deferred',queueId:item.id,error:String(error)}))}
  }
  return items.filter(item=>!removed.has(item.id));
}
