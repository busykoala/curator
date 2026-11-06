import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumReportedSeeders,viable} from './search';
import type {Release} from './matching';
const item=(seeders:number)=>(({seeders,protocol:'torrent',quality:{quality:{name:'FLAC'}},rejections:[]}) as Release);
test('old migration targets can use one-seed results only after an unsuccessful search',()=>{
 const old=new Date(Date.now()-90*86400_000).toISOString();
 assert.equal(minimumReportedSeeders({origin:'migration',created_at:old,attempts_today:1}),1);
 assert.equal(minimumReportedSeeders({origin:'migration',created_at:old,attempts_today:0}),2);
 assert.equal(minimumReportedSeeders({origin:'user',created_at:old,attempts_today:3}),2);
 assert.equal(minimumReportedSeeders({origin:'migration',created_at:new Date().toISOString(),attempts_today:1}),2);
});
test('multi-seed releases remain preferred and the default minimum is unchanged',()=>{
 assert.equal(viable(item(1),true),false);
 assert.equal(viable(item(2),true),true);
 assert.equal(viable(item(1),true,1),true);
 assert.equal(viable(item(0),true,1),false);
});
