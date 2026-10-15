import {timingSafeEqual} from 'node:crypto';
import {dirname} from 'node:path';
import {config} from '@/config';
import {helperFolders,validateHelperImport,unmatchedTrackSubset,manualImportUpdates} from '@/features/acquisition/import-guard';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
function authorized(request:Request){const supplied=Buffer.from(request.headers.get('x-api-key')??''),expected=Buffer.from(config.LIDARR_API_KEY);return expected.length>0&&supplied.length===expected.length&&timingSafeEqual(supplied,expected)}
async function upstream(path:string,init:RequestInit={}){return fetch(config.LIDARR_URL+'/api/v1/'+path,{...init,headers:{'X-Api-Key':config.LIDARR_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(30_000)})}
export async function GET(request:Request,context:Context){
  if(!authorized(request))return new Response('Forbidden',{status:403});
  const {path}=await context.params,endpoint=path.join('/').replace(/^api\/v1\//,'');
  if(!/^(system\/status|queue|manualimport|command\/\d+)$/.test(endpoint))return new Response('Unsupported helper endpoint',{status:404});
  const query=new URL(request.url).searchParams;
  let helperDownloadId:string|undefined;
  if(endpoint==='manualimport'){
    const folder=query.get('folder');
    if(folder&&(!folder.startsWith('/data/downloads/')||folder.split('/').includes('..')))return new Response('Invalid import path',{status:400});
    query.set('filterExistingFiles','true');
    if(folder){
      // Unpackerr supplies a folder without artist context. Preserve the
      // authoritative queued identity when scanning extracted siblings.
      const queued=await upstream('queue?pageSize=1000&includeUnknownArtistItems=true');
      if(!queued.ok)return new Response('Import validation unavailable',{status:503});
      const items=(await queued.json()).records;
      const item=items.find((q:{outputPath?:string;status?:string;sizeleft?:number})=>q.status==='completed'&&Number(q.sizeleft)===0&&helperFolders(q.outputPath??'').includes(folder));
      if(item?.artistId){query.set('artistId',String(item.artistId));helperDownloadId=String(item.downloadId)}
      // Lidarr gives downloadId precedence over folder, so it would scan the
      // original archive directory again even when we pass the extracted alias.
      query.delete('downloadId');
    }
  }
  const response=await upstream(endpoint+'?'+query);
  if(endpoint==='manualimport'&&response.ok){
    const rows=await response.json();
    if(!rows.length){
      const folders=helperFolders(query.get('folder')??'');
      if(folders.length>1){
        // Some torrent directories themselves end in .7z. Unpackerr strips
        // that suffix when extracting, while Lidarr retains the original path.
        query.set('folder',folders[1]);
        const alternate=await upstream(endpoint+'?'+query);
        if(alternate.ok){const extracted=await alternate.json();return Response.json(extracted.map((r:Record<string,unknown>)=>({...r,...(helperDownloadId?{downloadId:helperDownloadId}:{})})))}
      }
    }
    return Response.json(rows.map((r:Record<string,unknown>)=>({...r,...(helperDownloadId?{downloadId:helperDownloadId}:{})})));
  }
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});
}
export async function POST(request:Request,context:Context){
  if(!authorized(request))return new Response('Forbidden',{status:403});
  const {path}=await context.params;
  if(path.join('/').replace(/^api\/v1\//,'')!=='command')return new Response('Unsupported helper endpoint',{status:404});
  const body=await request.json();
  if(body.name!=='ManualImport'||!Array.isArray(body.files)||!body.files.length)return new Response('Unsupported helper command',{status:400});
  const first=body.files[0];
  if(typeof first.path!=='string'||!first.path.startsWith('/data/downloads/')||first.path.split('/').includes('..'))return new Response('Invalid import path',{status:400});
  const q=await upstream('queue?pageSize=1000&includeUnknownArtistItems=true');
  if(!q.ok)return new Response('Import validation unavailable',{status:503});
  const items=(await q.json()).records;
  const item=items.find((q:{downloadId?:string})=>String(q.downloadId??'').toLowerCase()===String(first.downloadId??'').toLowerCase());
  const folders=helperFolders(typeof item?.outputPath==='string'?item.outputPath:dirname(first.path));
  const folder=folders.find(root=>body.files.every((f:{path?:string})=>typeof f.path==='string'&&f.path.startsWith(root+'/')));
  if(!folder)return new Response('Files do not belong to download folder',{status:422});
  const r=await upstream('manualimport?'+new URLSearchParams({folder,artistId:String(item?.artistId??''),filterExistingFiles:'true'}));
  if(!r.ok)return new Response('Import validation unavailable',{status:503});
  let rows=await r.json();
  const subset=unmatchedTrackSubset(rows,item??{});
  if(subset){const checked=await upstream('manualimport',{method:'POST',body:JSON.stringify(manualImportUpdates(subset))});if(!checked.ok)return new Response('Import validation unavailable',{status:503});rows=await checked.json()}
  if(!validateHelperImport(body,items,rows))return new Response('Import mapping is rejected or ambiguous',{status:422});
  const response=await upstream('command',{method:'POST',body:JSON.stringify({...body,replaceExistingFiles:false,importMode:'copy'})});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});
}
