import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from 'better-sqlite3';

test("web and multiple workers can migrate the same database at startup",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"curator-startup-")),path=join(directory,"test.sqlite");
  const code="import {db} from './src/features/db/client.ts';const database=db();console.log(JSON.stringify({versions:database.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),columns:database.prepare('PRAGMA table_info(playlist_feedback)').all().map(x=>x.name),evidencePlan:database.prepare(\"EXPLAIN QUERY PLAN SELECT payload_json FROM evidence WHERE entity_key=? AND provider=? ORDER BY fetched_at DESC LIMIT 8\").all('album','musicbrainz')}));database.close();";
  try{
    const outputs=await Promise.all(Array.from({length:4},()=>promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,CURATOR_DB_PATH:path}})));
    for(const output of outputs){const parsed=JSON.parse(output.stdout);assert.ok(parsed.versions.some((x:{version:number})=>x.version===21));assert.ok(parsed.columns.includes('owner_user_id'));assert.ok(parsed.evidencePlan.some((row:{detail:string})=>row.detail.includes('evidence_playlist_lookup (entity_key=? AND provider=?)')));assert.ok(!parsed.evidencePlan.some((row:{detail:string})=>row.detail.includes('TEMP B-TREE')));assert.deepEqual(parsed,JSON.parse(outputs[0].stdout));}
  }finally{rmSync(directory,{recursive:true,force:true})}
});
test('legacy shared discovery evidence migrates only to a unique playlist and ambiguous recommendation context is retained privately for review',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'curator-evidence-migration-')),path=join(directory,'test.sqlite');
  const run=(code:string)=>promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,CURATOR_DB_PATH:path}});
  try{
    await run("import {db} from './src/features/db/client.ts';db().close()");
    const database=new Database(path),evidence=JSON.stringify([{provider:'listenbrainz',claims:{seedArtist:'private-listener-context'}},{provider:'musicbrainz',claims:{album:'Album'}}]);
    database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One'),(2,'two','two','Two');INSERT INTO smart_playlists(id,name,category,owner_user_id) VALUES(1,'One','discovery',1),(2,'Two','discovery',2)");
    for(const id of ['unique','shared'])database.prepare("INSERT INTO playlist_discovery_releases(id,artist_id,artist,album,evidence_json) VALUES(?,'artist','Artist','Album',?)").run(id,evidence);
    database.exec("INSERT INTO playlist_discovery_recommendations(playlist_id,owner_user_id,release_id) VALUES(1,1,'unique'),(1,1,'shared'),(2,2,'shared');DELETE FROM schema_migrations WHERE version=23");database.close();
    await run("import {db} from './src/features/db/client.ts';db().close()");
    const migrated=new Database(path,{readonly:true});
    try{
      const unique=migrated.prepare("SELECT evidence_json FROM playlist_discovery_recommendations WHERE release_id='unique'").get() as {evidence_json:string};assert.match(unique.evidence_json,/private-listener-context/);
      const shared=migrated.prepare("SELECT evidence_json FROM playlist_discovery_recommendations WHERE release_id='shared'").all() as Array<{evidence_json:string}>;assert.ok(shared.every(row=>row.evidence_json==='[]'));
      const canonical=migrated.prepare('SELECT evidence_json FROM playlist_discovery_releases').all() as Array<{evidence_json:string}>;assert.ok(canonical.every(row=>!row.evidence_json.includes('private-listener-context')&&row.evidence_json.includes('musicbrainz')));
      assert.match((migrated.prepare("SELECT evidence_json FROM playlist_discovery_evidence_review WHERE release_id='shared'").get() as {evidence_json:string}).evidence_json,/private-listener-context/);
    }finally{migrated.close()}
  }finally{rmSync(directory,{recursive:true,force:true})}
});
