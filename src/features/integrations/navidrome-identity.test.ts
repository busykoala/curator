import test from "node:test";
import assert from "node:assert/strict";
import {identityName,trackAlbumMatches,trackArtistMatches} from "./navidrome-identity";

test("Navidrome recordings match exact collaborative file credits, including split and reordered featured artists",()=>{
  assert.equal(trackArtistMatches(["Tom Misch,Yussef Dayes"],"Tom Misch","Tom Misch,Yussef Dayes"),true);
  assert.equal(trackArtistMatches(["Charlie Byrd","Stan Getz"],"Stan Getz/Charlie Byrd","Charlie Byrd feat. Stan Getz"),true);
  assert.equal(trackArtistMatches(["Charlie Byrd","Stan Getz"],"Catalog Artist",["Charlie Byrd","Stan Getz"]),true);
  assert.equal(trackArtistMatches(["Tom Misch,Someone Else"],"Tom Misch","Tom Misch,Yussef Dayes"),false);
  assert.equal(trackArtistMatches(["Tom Misch Jr"],"Tom Misch","Tom Misch,Yussef Dayes"),false);
  assert.equal(trackArtistMatches(["Charlie Byrd"],"Stan Getz/Charlie Byrd","Charlie Byrd feat. Stan Getz"),false);
});
test("album matching accepts the exact file tag while preserving distinctions between other editions",()=>{
  assert.equal(trackAlbumMatches("Jazz Samba","Jazz Samba [Bonus Track]","Jazz Samba"),true);
  assert.equal(trackAlbumMatches("Jazz Samba (Live)","Jazz Samba [Bonus Track]","Jazz Samba"),false);
  assert.equal(trackAlbumMatches("Another Album","Jazz Samba [Bonus Track]","Jazz Samba"),false);
});
test("identity matching preserves distinct non-Latin names",()=>{
  assert.notEqual(identityName("春の歌"),identityName("冬の歌"));
  assert.equal(trackArtistMatches(["東京事変"],"宇多田ヒカル",undefined),false);
  assert.equal(trackAlbumMatches("春の歌","冬の歌",undefined),false);
  assert.equal(trackArtistMatches([""],"",undefined),false);
});
