import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {maintainGenreTags} from './rewrite';
import {derivedTagProperties} from './derive';

test('genres are derived from stored evidence; nothing is rewritten before the fingerprint migration',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-genre-rewrite-'));config.DATABASE_PATH=join(dir,'t.sqlite');config.CURATOR_AUDIO_ANALYZER_URL=undefined;
  try{
    db().prepare("INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES ('/music/A/B/1.flac','album','A','B','flac',1,1,1,1,?,'{}','[]','written')").run(JSON.stringify({genre:['Folk Acoustic']}));
    const id=(db().prepare('SELECT id FROM files').get() as {id:number}).id;
    db().prepare("INSERT INTO track_profiles(file_id,album_key,audio_fingerprint,source_fingerprint,profile_json,status,schema_version,classifier_version,source_updated_at) VALUES (?,'album','a','v2:x',?,'complete',2,7,CURRENT_TIMESTAMP)").run(id,JSON.stringify({genre:['folk_acoustic'],style:['folk_rock','singer_songwriter']}));
    const first=await maintainGenreTags();
    assert.equal(first.derived,1);assert.equal(first.written,0,'waits for the fingerprint migration');
    assert.deepEqual(derivedTagProperties(id),{GENRE:['Folk','Singer-Songwriter'],STYLE:['Folk Rock']});
    const again=await maintainGenreTags();
    assert.equal(again.derived,0,'fresh derivations are not recomputed');
    stateSet('source_fingerprint_v2','done');stateSet('genre_rewrite_paused','true');
    assert.equal((await maintainGenreTags()).written,0,'operator pause is respected');
  }finally{rmSync(dir,{recursive:true,force:true})}
});
