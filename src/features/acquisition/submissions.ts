import {db} from '@/features/db/client';
import {grabsSince,type QueueItem} from './lidarr';
import {decodeTitle} from './matching';
import {qbitTorrents} from './qbittorrent';
import {updateTarget} from './repository';
const key=(s:string)=>decodeTitle(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Approval is not a grab acknowledgement: Lidarr can swallow client errors. */
export async function reconcileSubmissions(queue:QueueItem[]){
  const pending=db().prepare("SELECT * FROM acquisition_submissions WHERE status IN ('accepted','submitting') AND created_at<=datetime('now','-15 minutes') ORDER BY created_at LIMIT 10").all() as Array<{target_id:number;guid:string;created_at:string;detail_json:string}>;
  if(!pending.length)return;
  // Both services must answer successfully before absence can authorize retry.
  const since=new Date(Date.parse(pending[0].created_at.replace(' ','T')+'Z')-60_000).toISOString();
  const [torrents,history]=await Promise.all([qbitTorrents(true),grabsSince(since)]);
  for(const submission of pending){
    const detail=JSON.parse(submission.detail_json),names=[detail.title,detail.rawTitle].filter(Boolean).map(key);
    const ids=new Set<string>([detail.hash,...history.filter(h=>names.includes(key(h.sourceTitle))).map(h=>h.downloadId||h.data?.torrentInfoHash)].filter(Boolean).map(h=>String(h).toLowerCase()));
    const created=Date.parse(submission.created_at.replace(' ','T')+'Z');
    const item=torrents.find(t=>ids.has(t.hash.toLowerCase())||names.includes(key(t.name)));
    const possibleUnknown=!ids.size&&torrents.some(t=>t.progress<1&&t.added_on*1000>=created-60_000&&t.added_on*1000<=created+5*60_000);
    if(queue.some(q=>q.downloadId&&ids.has(q.downloadId.toLowerCase()))||(item&&item.progress<1)||possibleUnknown){
      updateTarget(submission.target_id,{detail_json:JSON.stringify({reason:'Download exists; awaiting Lidarr tracking',strategyVersion:2})});continue;
    }
    // No in-flight transfer exists. Completed payloads are retained and the
    // next search still checks actual library files before choosing anything.
    db().transaction(()=>{
      db().prepare('DELETE FROM acquisition_submissions WHERE target_id=?').run(submission.target_id);
      db().prepare("INSERT INTO source_outcomes(indexer_name,event,detail_json) VALUES(?,'submission_failure',?)").run(detail.source??'unknown',JSON.stringify({guid:submission.guid,hash:detail.hash,reason:item?'Completed transfer is absent from Lidarr queue':'No download exists after confirmation grace'}));
      updateTarget(submission.target_id,{status:'pending',download_hash:null,next_retry_at:null,detail_json:JSON.stringify({reason:item?'Completed payload retained; requested album still missing':'Lidarr approved the release but no transfer was created; trying another source',strategyVersion:2})});
    })();
  }
}
