import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {withoutCuratorTags} from './curator-tags';
import {albumEvidence,legacySourceFingerprint,loadAlbumFiles,sourceFingerprint,upgradeSourceFingerprints} from './context';

test('Curator-written tags are not evidence',()=>{
  const tags={title:'Song',genre:['Rock'],STYLE:['Folk Rock'],language:'en',extraProperties:{MOOD:['Calm'],MUSICBRAINZ_RELEASEGROUPID:['x']}};
  assert.deepEqual(withoutCuratorTags(tags),{title:'Song',language:'en',extraProperties:{MUSICBRAINZ_RELEASEGROUPID:['x']}});
});

test('fingerprints ignore tag rewrites and stored values migrate without reclassification',()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-fingerprint-'));config.DATABASE_PATH=join(dir,'t.sqlite');
  try{
    const insert=db().prepare("INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,?,?,?,'flac',?,1,1,1,?,'{}','[]','written')");
    insert.run('/music/A/B/1.flac','album','A','B',1,JSON.stringify({title:'One',genre:['Rock']}));
    insert.run('/music/A/B/2.flac','album','A','B',2,JSON.stringify({title:'Two',genre:['Rock']}));
    const [one,two]=loadAlbumFiles('album'),evidence=albumEvidence('album');
    assert.equal(sourceFingerprint(one,evidence),sourceFingerprint({...one,tags:{...one.tags,genre:['Electronic']}},evidence),'genre rewrite is not a source change');
    assert.notEqual(sourceFingerprint(one,evidence),sourceFingerprint({...one,tags:{...one.tags,title:'Other'}},evidence));
    const profile=db().prepare("INSERT INTO track_profiles(file_id,album_key,audio_fingerprint,source_fingerprint,profile_json,status,schema_version,classifier_version,source_updated_at) VALUES (?,'album','a',?,'{}','complete',2,7,CURRENT_TIMESTAMP)");
    profile.run(one.id,legacySourceFingerprint(one,evidence));
    profile.run(two.id,'outdated-legacy-value');
    assert.equal(upgradeSourceFingerprints(),0);
    const stored=(id:number)=>(db().prepare('SELECT source_fingerprint f FROM track_profiles WHERE file_id=?').get(id) as {f:string}).f;
    assert.equal(stored(one.id),sourceFingerprint(one,evidence),'current profile keeps its classification');
    assert.equal(stored(two.id),sourceFingerprint(two,evidence),'tag-only drift is adopted, not reclassified');
    db().prepare("INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES ('/music/A/B/3.flac','album','A','B','flac',3,1,1,1,'{}','{}','[]','error')").run();
    const three=(db().prepare("SELECT id FROM files WHERE path='/music/A/B/3.flac'").get() as {id:number}).id;profile.run(three,'legacy');
    assert.equal(upgradeSourceFingerprints(),0);assert.equal(stored(three),'v2:stale','unloadable files are classified when they return');
  }finally{rmSync(dir,{recursive:true,force:true})}
});
