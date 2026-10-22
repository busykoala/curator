import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {playlistTrackEvidence} from './evidence-repository';
import {reviewIdentity,reviewIdentityHash} from './metadata-review';
import {recordReviewedTrackFacts,type ReviewedTrackSource} from './reviewed-track-facts';
const directory=mkdtempSync(join(tmpdir(),'curator-reviewed-track-facts-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
const tags=JSON.stringify({title:['Song'],artist:['Artist'],instrumentation:['electric_guitar']}),profile=JSON.stringify({instrumentation:['electric_guitar']});
database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(1,'/song','album','Artist','Album','flac',1,1,1,1,?,'{\"durationMs\":57773}','{}','written')").run(tags);
database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,provenance_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(1,'album','complete',?,'{\"model\":\"curator\"}','fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(profile);
const identity=()=>reviewIdentityHash(reviewIdentity(database.prepare('SELECT id,artist_name,tags_json,properties_json FROM files WHERE id=1').get() as Parameters<typeof reviewIdentity>[0]));
const source:ReviewedTrackSource={url:'https://example.com/review',retrievedAt:new Date().toISOString(),artist:'Artist',title:'Song',album:'Album',quote:'Song is a cappella',text:'Artist — Album. Song is a cappella.',facts:[{field:'instrumentation',value:['voice'],scope:'recording',url:'https://example.com/review'}]};
test('a URL or a quote about another recording cannot become track evidence',()=>{
  assert.throws(()=>recordReviewedTrackFacts(1,identity(),{...source,text:'An unrelated review mentions Song.'}),/does not support/);
  assert.throws(()=>recordReviewedTrackFacts(1,identity(),{...source,quote:'Different piece is a cappella'}),/does not support/);
  assert.equal((database.prepare("SELECT count(*) n FROM evidence WHERE provider='playlist-track-facts'").get() as {n:number}).n,0);
});
test('a bound source corrects artist-setup inference without rewriting tags/profiles and is idempotent',()=>{
  assert.equal(playlistTrackEvidence(1)!.fields.instrumentation.source,'model_inference');
  assert.equal(recordReviewedTrackFacts(1,identity(),source),true);assert.equal(recordReviewedTrackFacts(1,identity(),source),false);
  const field=playlistTrackEvidence(1)!.fields.instrumentation;assert.equal(field.source,'external');assert.deepEqual(field.value,['voice']);assert.deepEqual(field.references,[source.url]);
  assert.deepEqual(database.prepare('SELECT tags_json FROM files WHERE id=1').get(),{tags_json:tags});assert.deepEqual(database.prepare('SELECT profile_json FROM track_profiles WHERE file_id=1').get(),{profile_json:profile});
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_metadata_review_attempts').get() as {n:number}).n,1);
});
test('changed recording identity ignores stale reviewed facts; explicit overrides retain precedence',()=>{
  const old=identity();database.exec("UPDATE files SET properties_json='{\"durationMs\":90000}' WHERE id=1");
  assert.throws(()=>recordReviewedTrackFacts(1,old,source),/identity changed/);assert.equal(playlistTrackEvidence(1)!.fields.instrumentation.source,'model_inference');
  database.exec("UPDATE files SET properties_json='{\"durationMs\":57773}' WHERE id=1;INSERT INTO track_profile_overrides(file_id,patch_json) VALUES(1,'{\"instrumentation\":[\"piano\"]}')");
  const field=playlistTrackEvidence(1)!.fields.instrumentation;assert.equal(field.source,'user_override');assert.deepEqual(field.value,['piano']);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
