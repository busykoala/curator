import {mkdirSync,writeFileSync} from 'node:fs';
import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {jellyfinCall} from '../src/features/auth/navidrome';
import {listenerMusicSnapshot} from '../src/features/playlists/listening-snapshot';
async function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||config.DATABASE_PATH!==target)throw Error('Only the isolated evaluation copy is permitted');
  const database=db(),owners=database.prepare('SELECT DISTINCT u.id,u.username,u.navidrome_user_id FROM curator_users u JOIN smart_playlists p ON p.owner_user_id=u.id WHERE p.enabled=1').all() as Array<{id:number;username:string;navidrome_user_id:string}>;
  const report:{at:string;scope:string;owners:Array<Record<string,unknown>>}={at:new Date().toISOString(),scope:'Native owner-context preflight; no playlist or acquisition changes. Only counts are reported; complete snapshots remain in the isolated copy.',owners:[]};
  try{for(const owner of owners){
    const started=Date.now();try{
      const snapshot=await listenerMusicSnapshot(owner.id),query=new URLSearchParams({IncludeItemTypes:'Audio',Recursive:'true',Filters:'IsFavorite',StartIndex:'0',Limit:'1',Fields:'UserData'});
      const implicit=await jellyfinCall<{TotalRecordCount?:number}>(owner.id,'Items?'+query);query.set('UserId',owner.navidrome_user_id);
      const explicit=await jellyfinCall<{TotalRecordCount?:number}>(owner.id,'Items?'+query);
      report.owners.push({ownerId:owner.id,username:owner.username,complete:snapshot.complete,stale:snapshot.stale,capturedAt:snapshot.capturedAt,songs:snapshot.songs.length,played:snapshot.songs.filter(song=>song.hasPlayed||song.playCount).length,favourites:snapshot.songs.filter(song=>song.favourite).length,
        nativeFavouriteCount:implicit.TotalRecordCount,nativeFavouriteCountExplicitOwner:explicit.TotalRecordCount,error:snapshot.error,durationMs:Date.now()-started});
    }catch(error){report.owners.push({ownerId:owner.id,username:owner.username,error:String(error),durationMs:Date.now()-started})}
  }
    const output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/listeners';mkdirSync(output,{recursive:true});writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{database.close()}
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
