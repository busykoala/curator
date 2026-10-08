import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "@/config";
import { db } from "../db/client";
import { schemaSql } from "../db/schema";
import { acquireChatLease, chatState, releaseChatLease, storeChatResult } from "./chat-state";
import { createPlaylist, getPlaylist } from "./repository";
import { defaultConfig } from "./types";
import { generatePlaylist } from "./generate";
const directory=mkdtempSync(join(tmpdir(),"curator-chat-test-"));
config.DATABASE_PATH=join(directory,"test.sqlite");
const old=new Database(config.DATABASE_PATH);old.exec(schemaSql);
old.prepare("INSERT INTO smart_playlists(name,category) VALUES ('Legacy favorites','rediscovery')").run();old.close();
const database=db();
database.prepare("INSERT INTO curator_users(id,navidrome_user_id,username,display_name,token_status) VALUES (1,'test','test','Test listener','missing')").run();
const create=(category:"chat"|"rediscovery"|"depth",name:string)=>createPlaylist({name,category,ownerUserId:1,config:defaultConfig(category)});

test("legacy rediscovery mixes remain available as ordinary playlists",()=>{
  assert.equal(getPlaylist(1)?.name,"Legacy favorites");
  assert.equal((database.prepare("SELECT automatic FROM smart_playlists WHERE id=1").get() as {automatic:number}).automatic,0);
  const personal=create("rediscovery","My Jazz Favorites"),depth=create("depth","My Deep Dive");
  assert.ok(getPlaylist(personal.id));assert.ok(getPlaylist(depth.id));
});
test("chat revisions persist, concurrent writers are blocked and stale leases cannot commit",()=>{
  const playlist=create("chat","A Conversation"),lease=acquireChatLease(playlist.id);
  assert.throws(()=>acquireChatLease(playlist.id),/already being updated/);
  const result={name:"A Conversation",reply:"Ready",guidance:"Jazz",items:[],detail:{tracks:0,pending:1,durationMs:1,usage:{input_tokens:1,output_tokens:1,total_tokens:2},tools:[]}};
  storeChatResult(playlist.id,lease,[{role:"user",content:"Jazz"}],result);
  assert.equal(chatState(playlist.id).revision,1);assert.equal(chatState(playlist.id).messages[0].content,"Jazz");
  releaseChatLease(playlist.id,lease);
  const next=acquireChatLease(playlist.id);
  assert.throws(()=>storeChatResult(playlist.id,lease,[],result),/changed while/);
  releaseChatLease(playlist.id,lease);assert.throws(()=>acquireChatLease(playlist.id));releaseChatLease(playlist.id,next);
});
test("chat preview returns the saved order and rejects unavailable songs instead of regenerating",async()=>{
  const playlist=create("chat","Exact Mix"),lease=acquireChatLease(playlist.id);
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (1,'/music/song.flac','test','Artist','Album','flac',1,1,1,1,'{}','{}','{}','written')").run();
  const item={fileId:1,title:"Song",artist:"Artist",album:"Album",year:1994,profile:{},score:0,reason:"Fits your request",origin:"catalog" as const,retained:false};
  storeChatResult(playlist.id,lease,[],{name:"Exact Mix",reply:"Ready",guidance:"",items:[item],detail:{tracks:1,pending:29,durationMs:1,usage:{input_tokens:0,output_tokens:0,total_tokens:0},tools:[]}});releaseChatLease(playlist.id,lease);
  assert.deepEqual((await generatePlaylist(playlist.id,true)).items,[item]);
  database.prepare("UPDATE files SET status='analyzed' WHERE id=1").run();
  await assert.rejects(generatePlaylist(playlist.id,true),/unavailable or excluded/);
});
test.after(()=>{database.close();delete (globalThis as {curatorDb?:Database.Database}).curatorDb;rmSync(directory,{recursive:true,force:true})});
