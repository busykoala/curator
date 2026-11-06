import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {cachedSourceResults,rememberSourceResults} from './source-cache';
const dir=mkdtempSync(join(tmpdir(),'curator-source-cache-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});

test('positive results expire after six hours and retain their actual observation time',()=>{
 const now=Date.now(),reports=[{title:'Artist - Album FLAC',infoHash:'a'.repeat(40)}];
 rememberSourceResults(1,'Artist Album',reports,now);
 assert.deepEqual(cachedSourceResults(1,'Artist Album',now+3600_000),{reports,observedAt:new Date(now).toISOString()});
 assert.equal(cachedSourceResults(1,'Artist Album',now+6*3600_000),undefined);
 assert.equal(cachedSourceResults(2,'Artist Album',now),undefined);
});
test('empty results avoid repeated queries for a day without hiding newly added albums by that artist',()=>{
 const now=Date.now();rememberSourceResults(1,'Artist',[],now);
 assert.deepEqual(cachedSourceResults(1,'Artist',now+23*3600_000)?.reports,[]);
 assert.equal(cachedSourceResults(1,'Artist New Album',now),undefined);
 assert.equal(cachedSourceResults(1,'Artist',now+24*3600_000),undefined);
});
test('malformed provider responses are failures, never cached as empty successes; corrupted cache is discarded',()=>{
 assert.throws(()=>rememberSourceResults(3,'Bad',{} as never),/Invalid provider/);
 assert.equal(cachedSourceResults(3,'Bad'),undefined);
 rememberSourceResults(3,'Corrupt',[]);
 db().prepare("UPDATE acquisition_source_cache SET payload_json='{}' WHERE indexer_id=3").run();
 assert.equal(cachedSourceResults(3,'Corrupt'),undefined);
});
