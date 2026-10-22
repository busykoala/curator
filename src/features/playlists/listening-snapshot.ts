import {randomUUID} from 'node:crypto';
import {db} from '@/features/db/client';
import {jellyfinCall} from '@/features/auth/navidrome';

export type ListenerSong={id:string;title:string;artist:string;artists?:string[];album:string;path?:string;trackNumber?:number;discNumber?:number;playCount:number;hasPlayed:boolean;lastPlayed:string|null;favourite:boolean;rating:number|null;providerIds:Record<string,string>};
export type ListenerSnapshot={songs:ListenerSong[];complete:boolean;stale:boolean;capturedAt:string|null;error:string;available:boolean};
type NativeSong={Id:string;Name?:string;Artists?:string[];Album?:string;Path?:string;IndexNumber?:number;ParentIndexNumber?:number;ProviderIds?:Record<string,string>;UserData?:{PlayCount?:number;Played?:boolean;LastPlayedDate?:string;IsFavorite?:boolean;Rating?:number}};
type Page={Items?:NativeSong[];TotalRecordCount?:number};
type SnapshotRow={songs_json:string;complete:number;identity_version:number;captured_at:number;last_attempt_at:number;next_retry_at:number;error:string;lease_token:string|null;lease_until:number};
const hour=3600_000;
export async function listenerMusicSnapshot(ownerId:number,options:{force?:boolean;load?:(path:string,signal:AbortSignal)=>Promise<Page>;now?:number}={}):Promise<ListenerSnapshot>{
  const now=options.now??Date.now(),read=()=>db().prepare('SELECT * FROM listener_music_snapshots WHERE owner_user_id=?').get(ownerId) as SnapshotRow|undefined;
  const view=(row:SnapshotRow|undefined,stale:boolean,error=''):ListenerSnapshot=>({songs:JSON.parse(row?.songs_json??'[]'),complete:Boolean(row?.complete),stale,capturedAt:row?.captured_at?new Date(row.captured_at).toISOString():null,error:error||row?.error||'',available:Boolean(row?.complete)});
  const previous=read();
  if(!options.force&&previous?.complete&&previous.identity_version===2&&previous.captured_at>now-hour&&!previous.error)return view(previous,false);
  if(previous&&previous.next_retry_at>now)return view(previous,true);
  const token=randomUUID();
  const acquired=db().transaction(()=>{
    db().prepare('INSERT OR IGNORE INTO listener_music_snapshots(owner_user_id) VALUES(?)').run(ownerId);
    return db().prepare('UPDATE listener_music_snapshots SET lease_token=?,lease_until=?,last_attempt_at=? WHERE owner_user_id=? AND lease_until<=?').run(token,now+120000,now,ownerId,now).changes;
  }).immediate();
  if(!acquired){if(previous?.complete)return view(previous,true,'Listening snapshot is refreshing');throw Error('Listening snapshot is refreshing; retry shortly')}
  const signal=AbortSignal.timeout(90_000),load=options.load??((path,signal)=>jellyfinCall<Page>(ownerId,path,{signal}));
  try{
    const songs:ListenerSong[]=[],seen=new Set<string>();let total=Infinity;
    for(let offset=0;offset<total;offset+=500){
      if(offset>=100000)throw Error('Listening snapshot exceeds the pagination safety limit');
      const query=new URLSearchParams({IncludeItemTypes:'Audio',Recursive:'true',SortBy:'SortName',SortOrder:'Ascending',StartIndex:String(offset),Limit:'500',Fields:'UserData,ProviderIds,Path'});
      const page=await load('Items?'+query,signal),items=page.Items??[];
      if(!Number.isInteger(page.TotalRecordCount)||Number(page.TotalRecordCount)<0)throw Error('Listening snapshot has no trustworthy total count');
      if(offset&&page.TotalRecordCount!==total)throw Error('Library changed during listening pagination; retaining the prior snapshot');
      total=page.TotalRecordCount!;
      if(items.length>500||!items.length&&offset<total)throw Error('Listening snapshot pagination is incomplete');
      for(const song of items){
        if(!song.Id||seen.has(song.Id))throw Error('Listening snapshot pagination repeated a song');
        seen.add(song.Id);const data=song.UserData??{};
        songs.push({id:song.Id,title:song.Name??'',artist:song.Artists?.[0]??'',artists:song.Artists??[],album:song.Album??'',path:song.Path,trackNumber:song.IndexNumber,discNumber:song.ParentIndexNumber,playCount:Math.max(0,Number(data.PlayCount??0)||0),hasPlayed:Boolean(data.Played||data.PlayCount||data.LastPlayedDate),lastPlayed:data.LastPlayedDate??null,favourite:Boolean(data.IsFavorite),rating:Number.isFinite(data.Rating)?Number(data.Rating):null,providerIds:song.ProviderIds??{}});
      }
    }
    if(songs.length!==total)throw Error('Listening snapshot does not reconcile with the native song count');
    const changed=db().prepare("UPDATE listener_music_snapshots SET songs_json=?,complete=1,identity_version=2,captured_at=?,next_retry_at=0,error='',lease_token=NULL,lease_until=0 WHERE owner_user_id=? AND lease_token=? AND lease_until>?").run(JSON.stringify(songs),now,ownerId,token,options.now??Date.now()).changes;
    if(!changed)throw Error('Listening snapshot lease expired');
    return view(read(),false);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    db().prepare('UPDATE listener_music_snapshots SET error=?,next_retry_at=?,lease_token=NULL,lease_until=0 WHERE owner_user_id=? AND lease_token=?').run(message,now+5*60_000,ownerId,token);
    return view(previous,true,message);
  }
}
