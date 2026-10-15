import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseIsBlocked} from './lidarr';
test('blocklists survive title repairs, different indexers, and hash casing',async()=>{
  const original=globalThis.fetch,hash='abcdef0123456789abcdef0123456789abcdef01';
  globalThis.fetch=async()=>Response.json({totalRecords:1,records:[{sourceTitle:'Artist - Repaired title [FLAC]',torrentInfoHash:hash.toUpperCase()}]});
  try{
    assert.equal(await releaseIsBlocked({title:'An entirely different indexer title',magnetUrl:'magnet:?xt=urn:btih:'+hash}),true);
    assert.equal(await releaseIsBlocked({title:'Artist - Repaired title [FLAC]'}),true);
    assert.equal(await releaseIsBlocked({title:'Artist - Album [FLAC]',infoHash:'1111111111111111111111111111111111111111'}),false);
  }finally{globalThis.fetch=original}
});
