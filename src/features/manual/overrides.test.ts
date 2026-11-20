import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {getManualOverride,saveManualOverride,verifiedSourceUrl} from './overrides';
import {reconcileIssues} from '@/features/analysis/reconcile';
test('a verified https release page confirms identity without a MusicBrainz ID',()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-source-override-'));config.DATABASE_PATH=join(dir,'test.sqlite');
  try{
    db().prepare("INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json) VALUES('/music/Trio/Album/01.flac','independent','Trio','Album','flac',1,1,1,1,'{}','{}','[]')").run();
    db().prepare("INSERT INTO issues(album_key,code,severity,message) VALUES('independent','identity_unresolved','warning','no catalogue match')").run();
    saveManualOverride({album_key:'independent',artist_name:'Trio',album_name:'Album',release_date:'2026-11-20',artist_mbid:null,release_group_mbid:null,source_url:'https://trio.bandcamp.com/album/album#buy'});
    const saved=getManualOverride('independent');
    assert.equal(saved?.confirmed,1);assert.equal(saved?.source_url,'https://trio.bandcamp.com/album/album');
    reconcileIssues();
    assert.equal((db().prepare("SELECT status FROM issues WHERE code='identity_unresolved'").get() as {status:string}).status,'resolved');
    saveManualOverride({album_key:'other',artist_name:'A',album_name:'B',release_date:null,artist_mbid:null,release_group_mbid:null});
    assert.equal(getManualOverride('other')?.confirmed,0);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('unsafe source URLs are rejected',()=>{
  assert.throws(()=>verifiedSourceUrl('http://trio.bandcamp.com/album/album'));
  assert.throws(()=>verifiedSourceUrl('https://user:pw@example.com/'));
  assert.throws(()=>verifiedSourceUrl('not a url'));
  assert.equal(verifiedSourceUrl('  '),null);
});
test('confirmed overrides never inherit searched MusicBrainz IDs they do not state',async()=>{
  const {applyManualIdentity}=await import('./overrides');
  const searched=()=>({artistId:'searched-artist',releaseGroupId:'searched-group'});
  const sourceOnly=searched();applyManualIdentity(sourceOnly,{artist_mbid:null,release_group_mbid:null,confirmed:1});
  assert.deepEqual(sourceOnly,{artistId:undefined,releaseGroupId:undefined});
  const sameGroup=searched();applyManualIdentity(sameGroup,{artist_mbid:null,release_group_mbid:'searched-group',confirmed:1});
  assert.deepEqual(sameGroup,{artistId:'searched-artist',releaseGroupId:'searched-group'});
  const otherGroup=searched();applyManualIdentity(otherGroup,{artist_mbid:null,release_group_mbid:'manual-group',confirmed:1});
  assert.deepEqual(otherGroup,{artistId:undefined,releaseGroupId:'manual-group'});
  const unconfirmed=searched();applyManualIdentity(unconfirmed,{artist_mbid:'manual-artist',release_group_mbid:null,confirmed:0});
  assert.deepEqual(unconfirmed,{artistId:'manual-artist',releaseGroupId:'searched-group'});
});
