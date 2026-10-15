import {timingSafeEqual} from 'node:crypto';
import {dirname} from 'node:path';
import {config} from '@/config';
import {validateHelperImport} from '@/features/acquisition/import-guard';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
function authorized(request:Request){const supplied=Buffer.from(request.headers.get('x-api-key')??''),expected=Buffer.from(config.LIDARR_API_KEY);return expected.length>0&&supplied.length===expected.length&&timingSafeEqual(supplied,expected)}
async function upstream(path:string,init:RequestInit={}){return fetch(config.LIDARR_URL+'/api/v1/'+path,{...init,headers:{'X-Api-Key':config.LIDARR_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(30_000)})}
export async function GET(request:Request,context:Context){
  if(!authorized(request))return new Response('Forbidden',{status:403});
  const {path}=await context.params,endpoint=path.join('/').replace(/^api\/v1\//,'');
  if(!/^(system\/status|queue|manualimport|command\/\d+)$/.test(endpoint))return new Response('Unsupported helper endpoint',{status:404});
  const query=new URL(request.url).searchParams;
  if(endpoint==='manualimport'){
    const folder=query.get('folder');
    if(folder&&(!folder.startsWith('/data/downloads/')||folder.split('/').includes('..')))return new Response('Invalid import path',{status:400});
    query.set('filterExistingFiles','true');
  }
  const response=await upstream(endpoint+'?'+query);
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
  const folder=typeof item?.outputPath==='string'?item.outputPath:dirname(first.path);
  if(!folder.startsWith('/data/downloads/')||folder.split('/').includes('..'))return new Response('Invalid download folder',{status:422});
  if(body.files.some((f:{path?:string})=>typeof f.path!=='string'||!f.path.startsWith(folder.replace(/\/$/,'')+'/')))return new Response('Files do not belong to download folder',{status:422});
  const r=await upstream('manualimport?'+new URLSearchParams({folder,artistId:String(item?.artistId??''),downloadId:String(first.downloadId??''),filterExistingFiles:'true'}));
  if(!r.ok)return new Response('Import validation unavailable',{status:503});
  if(!validateHelperImport(body,items,await r.json()))return new Response('Import mapping is rejected or ambiguous',{status:422});
  const response=await upstream('command',{method:'POST',body:JSON.stringify({...body,replaceExistingFiles:false,importMode:'copy'})});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});
}
