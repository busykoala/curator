import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateGet} from '@/features/db/client';
import {AUDIO_MODEL_VERSION,audioModelResults,decodeEmbedding,startAudioModelBackfill} from './client';

test('embeddings round-trip through base64 and blobs',()=>{
  const vector=new Float32Array([0.5,-1,2]);
  const encoded=Buffer.from(vector.buffer).toString('base64');
  assert.deepEqual([...decodeEmbedding(encoded)!],[0.5,-1,2]);
  assert.deepEqual([...decodeEmbedding(Buffer.from(vector.buffer))!],[0.5,-1,2]);
  assert.equal(decodeEmbedding(Buffer.from([1,2,3])),null);
});

test('backfill stores analyzer results and backs off unreadable files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-audio-model-'));config.DATABASE_PATH=join(dir,'t.sqlite');config.CURATOR_AUDIO_ANALYZER_URL='http://analyzer.test';
  const original=globalThis.fetch;
  globalThis.fetch=(async(_url:string,init?:RequestInit)=>{
    const {path}=JSON.parse(String(init?.body));
    if(path.endsWith('bad.flac'))return Response.json({error:'recording is shorter than three seconds'},{status:422});
    return Response.json({modelVersion:AUDIO_MODEL_VERSION,analyzedSeconds:200,styles:[{label:'Rock---Folk Rock',p:0.7}],voice:0.9,danceable:0.2,moods:{relaxed:0.6},instruments:[{label:'acousticguitar',p:0.8}],embedding:Buffer.from(new Float32Array([1,0]).buffer).toString('base64'),dimensions:2});
  }) as typeof fetch;
  try{
    const insert=db().prepare("INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,'a','A','B','flac',?,1,1,1,'{}','{}','[]','written')");
    insert.run('/music/A/B/good.flac',1);insert.run('/music/A/B/bad.flac',2);
    const ids=(db().prepare('SELECT id FROM files ORDER BY id').all() as {id:number}[]).map(row=>row.id);
    for(const id of ids)db().prepare("INSERT INTO audio_features(file_id,audio_fingerprint,analyzer_version,features_json) VALUES (?,?,3,'{}')").run(id,'fp'+id);
    startAudioModelBackfill();
    for(let i=0;i<50&&!stateGet('audio_model_progress');i++)await new Promise(resolve=>setTimeout(resolve,20));
    const results=audioModelResults(ids);
    assert.equal(results.size,1);
    const good=results.get(ids[0])!;
    assert.equal(good.voice,0.9);assert.equal(good.styles[0].label,'Rock---Folk Rock');assert.deepEqual([...good.embedding!],[1,0]);
    const bad=db().prepare('SELECT error,attempts,next_attempt_at>datetime(\'now\',\'+6 days\') later FROM audio_model_results WHERE file_id=?').get(ids[1]) as {error:string;attempts:number;later:number};
    assert.match(bad.error,/shorter/);assert.equal(bad.attempts,1);assert.equal(bad.later,1);
  }finally{globalThis.fetch=original;config.CURATOR_AUDIO_ANALYZER_URL=undefined;rmSync(dir,{recursive:true,force:true})}
});
