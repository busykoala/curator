import {createHash} from 'node:crypto';
import {db} from '@/features/db/client';
import type {Release} from './matching';

// Older misses were saved before checking Prowlarr's out-of-band failures.
const cacheKey=(id:number,query:string)=>createHash('sha256').update(`health-v1:${id}:${query}`).digest('hex');

// Only provider results are reusable. Native release handles expire and must
// never enter this cache. Every cached candidate still passes normal identity,
// quality, blocklist, capacity and native approval checks before submission.
export function cachedSourceResults(id:number,query:string,now=Date.now()):{reports:Release[];observedAt:string}|undefined {
  const key=cacheKey(id,query),row=db().prepare('SELECT payload_json,fetched_at FROM acquisition_source_cache WHERE cache_key=? AND expires_at>?').get(key,now) as {payload_json:string;fetched_at:number}|undefined;
  if(!row)return;
  try{
    const reports:unknown=JSON.parse(row.payload_json);
    if(!Array.isArray(reports)||reports.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Invalid cached releases');
    return {reports,observedAt:new Date(row.fetched_at).toISOString()};
  }catch{db().prepare('DELETE FROM acquisition_source_cache WHERE cache_key=?').run(key);return;}
}

export function rememberSourceResults(id:number,query:string,reports:Release[],now=Date.now()) {
  if(!Array.isArray(reports)||reports.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Invalid provider search response');
  const payload=JSON.stringify(reports.slice(0,100));
  if(Buffer.byteLength(payload)>256*1024)return;
  // Empty searches repeat while another source is quota-limited. Retain those
  // misses for a day; positive results refresh every six hours. New album
  // queries get distinct keys, including when an artist search was empty.
  const expires=now+(reports.length?6:24)*3600_000;
  db().transaction(()=>{
    db().prepare('DELETE FROM acquisition_source_cache WHERE expires_at<=?').run(now);
    db().prepare(`INSERT INTO acquisition_source_cache(cache_key,indexer_id,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`)
      .run(cacheKey(id,query),id,payload,now,expires);
    db().prepare(`DELETE FROM acquisition_source_cache WHERE cache_key IN
      (SELECT cache_key FROM (SELECT cache_key,
        row_number() OVER (ORDER BY fetched_at DESC,cache_key) n,
        sum(length(CAST(payload_json AS BLOB))) OVER (ORDER BY fetched_at DESC,cache_key) bytes
        FROM acquisition_source_cache) WHERE n>20000 OR bytes>67108864)`).run();
  })();
}
