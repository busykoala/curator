import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {discoverySeedArtists} from './discovery-providers';
import {defaultConfig,type PlaylistDefinition} from './types';
test('specific discovery styles cannot be satisfied by a stray broad genre and artists use their best matching track',()=>{
  const directory=mkdtempSync(join(tmpdir(),'curator-discovery-seeds-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
  try{
    const artists=['Pop Artist','Relevant Artist','Relevant Artist'],ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222'];
    for(let i=0;i<3;i++){
      database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,?,?,'Album','flac',?,1,1,1,?,'{}','{}','written')").run(i+1,'/music/'+i,'album'+i,artists[i],i,JSON.stringify({title:['Song '+i],musicbrainzArtistId:[ids[i]]}));
      database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(?,?,'complete',?,'fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(i+1,'album'+i,JSON.stringify({genre:['electronic'],style:[i===2?'melodic_techno':'pop_rock']}));
    }
    const playlist={id:1,ownerUserId:1,config:{...defaultConfig('discovery'),tasteLanes:['melodic_techno','techno'],genres:['electronic']}} as PlaylistDefinition;
    const seeds=discoverySeedArtists(playlist);
    assert.equal(seeds.length,1);assert.equal(seeds[0].artist,'Relevant Artist');assert.ok(seeds[0].styles.includes('melodic techno'));
    database.prepare('INSERT INTO track_profile_overrides(file_id,patch_json) VALUES(1,?)').run(JSON.stringify({style:['melodic_techno']}));
    database.prepare("UPDATE track_profiles SET profile_json=? WHERE file_id IN (2,3)").run(JSON.stringify({genre:['rock'],style:['pop_rock'],scenes:['detroit_techno_scene']}));
    const overridden=discoverySeedArtists(playlist);assert.equal(overridden.length,1);assert.equal(overridden[0].artist,'Pop Artist','User overrides win; scene association alone cannot qualify the former seed');
  }finally{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})}
});
