import test from 'node:test';
import assert from 'node:assert/strict';
import {errorDecision,isAbandonedPartial} from './policy';
import {yieldDecision,yieldPriority} from './prowlarr';

const hour=3_600_000,day=24*hour,now=Date.UTC(2026,10,22);

test('zero-yield indexers are parked only with enough evidence and enough remaining sources',()=>{
  const fresh={baseQueries:0,baseGrabs:0};
  assert.equal(yieldDecision({queries:66_195,grabs:0},fresh,true,8,now),'disable');
  assert.equal(yieldDecision({queries:1_999,grabs:0},fresh,true,8,now),'keep','needs 2k queries');
  assert.equal(yieldDecision({queries:46_977,grabs:4_380},fresh,true,8,now),'keep','productive');
  assert.equal(yieldDecision({queries:66_195,grabs:0},fresh,true,3,now),'keep','keeps at least three sources');
  assert.equal(yieldDecision({queries:67_000,grabs:0},{baseQueries:66_195,baseGrabs:0},true,8,now),'keep','counts only queries since the last probe');
});

test('parked indexers are re-probed weekly; operator-disabled ones are left alone',()=>{
  assert.equal(yieldDecision({queries:1,grabs:0},{baseQueries:0,baseGrabs:0,disabledAt:now-8*day},false,5,now),'reprobe');
  assert.equal(yieldDecision({queries:1,grabs:0},{baseQueries:0,baseGrabs:0,disabledAt:now-2*day},false,5,now),'keep');
  assert.equal(yieldDecision({queries:1,grabs:0},{baseQueries:0,baseGrabs:0},false,5,now),'keep');
});

test('search priority follows grab rate once history exists',()=>{
  assert.equal(yieldPriority({queries:46_977,grabs:4_380}),10);
  assert.equal(yieldPriority({queries:73_953,grabs:1_036}),10);
  assert.equal(yieldPriority({queries:31_634,grabs:19}),40);
  assert.equal(yieldPriority({queries:10_000,grabs:20}),25);
  assert.equal(yieldPriority({queries:100,grabs:0}),undefined);
});

test('client errors get one recheck, then replacement after an hour',()=>{
  assert.equal(errorDecision('error',undefined,now),'recheck');
  assert.equal(errorDecision('missingFiles',undefined,now),'recheck');
  assert.equal(errorDecision('error',now-30*60_000,now),null);
  assert.equal(errorDecision('error',now-2*hour,now),'replace');
  assert.equal(errorDecision('stalledDL',undefined,now),null);
});

test('only untracked partial downloads are abandoned',()=>{
  const item=(ageHours:number,extra:Partial<{progress:number;dlspeed:number;category:string}>={})=>({progress:0.2,dlspeed:0,category:'music',added_on:(now-ageHours*hour)/1000,...extra});
  assert.equal(isAbandonedPartial(item(7),false,true,'music',now),true,'replaced by Curator, 6 h grace');
  assert.equal(isAbandonedPartial(item(5),false,true,'music',now),false);
  assert.equal(isAbandonedPartial(item(73),false,false,'music',now),true,'abandoned after three days');
  assert.equal(isAbandonedPartial(item(73),true,false,'music',now),false,'tracked downloads are never touched');
  assert.equal(isAbandonedPartial(item(73,{progress:1}),false,false,'music',now),false,'complete payloads are seeding');
  assert.equal(isAbandonedPartial(item(73,{dlspeed:10}),false,false,'music',now),false,'still downloading');
  assert.equal(isAbandonedPartial(item(73,{category:'other'}),false,false,'music',now),false,'other categories are not ours');
});
