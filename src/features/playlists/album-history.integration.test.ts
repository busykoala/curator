import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {createPlaylist} from './repository';
import {configuredIntent} from './intent-schema';
import {loadEvidencedCandidates} from './selection-repository';
import {assessCandidate} from './selection-policy';
import type {ListenerSnapshot} from './listening-snapshot';
const directory=mkdtempSync(join(tmpdir(),'curator-album-history-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One'),(2,'two','two','Two')");
const one=createPlaylist({name:'No recent albums',category:'rediscovery',ownerUserId:1,config:{targetTracks:1}}),two=createPlaylist({name:'No recent albums',category:'rediscovery',ownerUserId:2,config:{targetTracks:1}});
const now=Date.parse('2026-10-23T03:00:00Z');
for(const id of [1,2]){
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,?,?,'Compilation','flac',?,1,1,1,?,'{}','{}','written')").run(id,'/music/'+id+'.flac','edition-'+id,'Artist '+id,id,JSON.stringify({title:['Song '+id],artist:['Artist '+id],album:['Compilation']}));
  database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(?,?,'complete','{\"genre\":[\"electronic\"]}','fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(id,'edition-'+id);
}
function snapshot(recent:boolean):ListenerSnapshot{return{complete:true,stale:false,capturedAt:'2026-10-23T02:00:00Z',error:'',available:true,songs:[1,2].map(id=>({id:'native-'+id,title:'Song '+id,artist:'Artist '+id,album:'Compilation',albumId:'native-compilation',albumArtist:'Various Artists',playCount:4,hasPlayed:true,lastPlayed:id===1&&recent?'2026-10-22T12:00:00Z':'2026-08-01T00:00:00Z',favourite:false,rating:null,providerIds:{}}))}}
function candidate(definition:typeof one,history:ListenerSnapshot){const intent=configuredIntent(definition,'test');intent.hard.excludeRecentlyPlayedAlbums=true;const song=loadEvidencedCandidates(definition,history).find(track=>track.fileId===2)!;return{song,result:assessCandidate(song,definition,intent,history,now)}}
test('a recent compilation play blocks another artist’s old recording only for that listener',()=>{
  const first=candidate(one,snapshot(true));assert.match(first.song.albumLastPlayed!,/2026-10-22/);assert.equal(first.result.eligible,false);
  const other=candidate(two,snapshot(false));assert.equal(other.result.eligible,true);assert.match(other.song.albumLastPlayed!,/2026-08-01/);
});
test('different native albums with the same displayed name do not share recency',()=>{
  const history=snapshot(true);history.songs[1].albumId='different-native-album';assert.equal(candidate(one,history).result.eligible,true);
});
test('an undated observed play cannot establish an album as long-unplayed',()=>{
  const history=snapshot(false);history.songs[0].lastPlayed=null;const value=candidate(one,history);
  assert.equal(value.song.albumHistoryUncertain,true);assert.equal(value.result.eligible,false);assert.ok(value.result.violations.some(message=>message.includes('without a trustworthy')));
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
