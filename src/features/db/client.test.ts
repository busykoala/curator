import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("web and multiple workers can migrate the same database at startup",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"curator-startup-")),path=join(directory,"test.sqlite");
  const code="import {db} from './src/features/db/client.ts';const database=db();console.log(JSON.stringify({versions:database.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),columns:database.prepare('PRAGMA table_info(playlist_feedback)').all().map(x=>x.name)}));database.close();";
  try{
    const outputs=await Promise.all(Array.from({length:4},()=>promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,CURATOR_DB_PATH:path}})));
    for(const output of outputs){const parsed=JSON.parse(output.stdout);assert.ok(parsed.versions.some((x:{version:number})=>x.version===9));assert.ok(parsed.columns.includes('owner_user_id'));assert.deepEqual(parsed,JSON.parse(outputs[0].stdout));}
  }finally{rmSync(directory,{recursive:true,force:true})}
});
