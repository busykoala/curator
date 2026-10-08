import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "@/config";
import { db } from "../db/client";
import { ownedPlaylist, requestedUserMatches, ownerInputMatches } from "./access";
import { createPlaylist, listPlaylists, feedback, removeFeedback } from "./repository";
import { chatLibrary } from "./chat";

const directory = mkdtempSync(join(tmpdir(), "curator-access-"));config.DATABASE_PATH=join(directory,"test.sqlite");
const database=db();
for(const id of [1,2])database.prepare("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES (?,?,?,?)").run(id,String(id),String(id),String(id));
const one=createPlaylist({name:"Private one",category:"chat",ownerUserId:1,config:{targetTracks:1}}),two=createPlaylist({name:"Private two",category:"chat",ownerUserId:2,config:{targetTracks:1}});
test("playlist IDs, owner overrides, and user query parameters cannot select another listener",()=>{
  assert.equal(ownedPlaylist(one.id,1)?.id,one.id);assert.equal(ownedPlaylist(one.id,2),undefined);assert.equal(ownedPlaylist(two.id,1),undefined);
  assert.deepEqual(listPlaylists(1).map(p=>p.id),[one.id]);assert.deepEqual(listPlaylists(2).map(p=>p.id),[two.id]);
  assert.equal(requestedUserMatches(new Request("https://example.test/api/playlists?userId=2"),1),false);
  assert.equal(requestedUserMatches(new Request("https://example.test/api/playlists?userId=oops"),1),false);
  assert.equal(requestedUserMatches(new Request("https://example.test/api/playlists"),1),true);
  assert.equal(ownerInputMatches({ownerUserId:2},1),false);assert.equal(ownerInputMatches({ownerUserId:1},1),true);assert.equal(ownerInputMatches({},1),true);
});
test("global snooze and undo stay within the listener's own library preferences",()=>{
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (1,'/music/song.flac','one','Artist','Album','flac',1,1,1,1,'{\"title\":[\"Song\"]}','{}','{}','written')").run();
  feedback(one.id,1,"Artist","snooze");assert.equal(chatLibrary(one.id).length,0);assert.equal(chatLibrary(two.id).length,1);
  removeFeedback(two.id,1,"snooze");assert.equal(chatLibrary(one.id).length,0);
  removeFeedback(one.id,1,"snooze");assert.equal(chatLibrary(one.id).length,1);
});
test.after(()=>{database.close();delete (globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true});});
