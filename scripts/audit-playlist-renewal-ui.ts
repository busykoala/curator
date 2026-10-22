import {mkdtempSync,rmSync,mkdirSync,writeFileSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {config} from '../src/config';import {db,stateSet} from '../src/features/db/client';
import {createPlaylist,setNavidromeId} from '../src/features/playlists/repository';
import {playlistRevisionHash} from '../src/features/playlists/refresh-policy';

// Isolated fixtures, local web server, no workers and no real credentials.
async function main(){
  const directory=mkdtempSync(join(tmpdir(),'curator-renewal-ui-')),output='delivery/playlist-renewal/ui';mkdirSync(output,{recursive:true});
  config.DATABASE_PATH=join(directory,'db.sqlite');const database=db();stateSet('playlist_refresh_mode','enabled');
  database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name,token_status) VALUES(1,'fixture-one','fixture-one','Fixture One','active'),(2,'fixture-two','fixture-two','Fixture Two','active')");
  const token=randomBytes(32).toString('base64url');database.prepare("INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,1,datetime('now','+1 hour'))").run(createHash('sha256').update(token).digest('hex'));
  const mood=createPlaylist({name:'Evening reading',category:'mood',ownerUserId:1,enabled:true,config:{targetTracks:6,moods:['warm']}});
  const discovery=createPlaylist({name:'Unfamiliar jazz',category:'discovery',ownerUserId:1,enabled:true,config:{targetTracks:6}});
  const chat=createPlaylist({name:'Train conversation',category:'chat',ownerUserId:1,enabled:false,config:{targetTracks:6}});
  const foreign=createPlaylist({name:'Other listener private mix',category:'mood',ownerUserId:2,enabled:true,config:{targetTracks:6}});
  const items=[];
  const profile={genre:['jazz'],style:['modal_jazz'],mood:['warm'],vocalProfile:['instrumental'],instrumentation:['piano'],energy:'low'};
  const run=database.prepare("INSERT INTO playlist_runs(playlist_id,owner_user_id,status,preview,config_hash,detail_json,finished_at) VALUES(?,1,'complete',0,?,'{\"tracks\":6,\"evaluation\":{\"changed\":2}}',CURRENT_TIMESTAMP) RETURNING id").get(mood.id,playlistRevisionHash(mood)) as {id:number};
  for(let id=1;id<=6;id++){
    database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,?,'Fixture artist','Fixture album','flac',?,1,1,1,?,'{}','{}','written')").run(id,join(directory,'song'+id),String(id),id,JSON.stringify({title:['Fixture song '+id]}));
    database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,provenance_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(?,?,'complete',?,'{\"model\":\"fixture\"}','fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(id,String(id),JSON.stringify(profile));
    database.prepare("INSERT INTO playlist_items(run_id,playlist_id,file_id,position,score,reason) VALUES(?,?,?,?,1,'Warm piano jazz for reading')").run(run.id,mood.id,id,id-1);
    items.push({fileId:id,title:'Fixture song '+id,artist:'Fixture artist',album:'Fixture album',year:0,profile,score:1,reason:'Warm piano jazz for reading',origin:'catalog',retained:false});
  }
  setNavidromeId(mood.id,'fixture-native');
  const release=randomUUID();database.prepare("INSERT INTO playlist_discovery_releases(id,artist_id,artist,album,identity_verified_at) VALUES(?,?,'Fixture artist','Researched fixture album',CURRENT_TIMESTAMP)").run(release,randomUUID());
  const rec=database.prepare("INSERT INTO playlist_discovery_recommendations(playlist_id,owner_user_id,release_id,status,rationale,origin) VALUES(?,1,?,'queued','Fixture recommendation','fixture') RETURNING id").get(discovery.id,release) as {id:number};
  database.prepare("INSERT INTO playlist_chat_state(playlist_id,revision,conversation_json,result_json) VALUES(?,1,?,?)").run(chat.id,JSON.stringify([{role:'user',content:'Warm music for a train journey'},{role:'assistant',content:'Here is your mix.'}]),JSON.stringify({name:chat.name,reply:'Here is your mix.',guidance:'Warm train music',items,detail:{pending:0,durationMs:10,usage:{input_tokens:1,output_tokens:1,total_tokens:2},tools:[]}}));
  const port=4559,base=`http://127.0.0.1:${port}`,log=createWriteStream(join(directory,'server.log'));
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,CURATOR_DB_PATH:config.DATABASE_PATH,CURATOR_AUTOSTART:'false'},stdio:['ignore','pipe','pipe']});server.stdout.pipe(log);server.stderr.pipe(log);
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    let ready=false;for(let attempt=0;attempt<100;attempt++){try{if((await fetch(base+'/login')).ok){ready=true;break}}catch{}await delay(100)}
    assert.ok(ready,'Local UI server must start');browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'curator_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/playlists/'+mood.id);await page.getByText('2 songs refreshed',{exact:true}).waitFor();
    await page.locator('.song-reason summary').first().click();await page.getByText(/Instruments: piano/).first().waitFor();
    assert.ok(await page.getByText(/inferred/).count());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile detail must not overflow');await page.screenshot({path:output+'/mobile-detail.png',fullPage:true});
    await page.getByRole('button',{name:'Playlist options',exact:true}).click();await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.getByText('Refresh queued. You can leave this page.',{exact:true}).waitFor();
    assert.equal((database.prepare('SELECT count(*) n FROM playlist_refresh_jobs WHERE playlist_id=?').get(mood.id) as {n:number}).n,1);
    assert.equal((await context.request.get(base+'/api/playlists/'+foreign.id)).status(),404);
    assert.equal((await context.request.post(base+'/api/playlists/'+foreign.id+'/refresh',{headers:{origin:base},data:{requestId:randomUUID()}})).status(),404);
    await page.goto(base+'/playlists/'+discovery.id);await page.getByText('Researched albums (1)',{exact:true}).click();await page.getByRole('button',{name:'Dismiss',exact:true}).click();
    await page.getByText('Researched albums (1)',{exact:true}).waitFor({state:'hidden'});assert.equal((database.prepare('SELECT status FROM playlist_discovery_recommendations WHERE id=?').get(rec.id) as {status:string}).status,'dismissed');
    await page.goto(base+'/playlists/'+chat.id);await page.getByRole('link',{name:'Refresh settings'}).click();await page.getByText('Fine-tune the mix',{exact:false}).click();
    assert.equal(await page.getByRole('combobox',{name:'Mood filters'}).count(),0);await page.getByRole('slider',{name:'Refresh variation'}).waitFor();await page.screenshot({path:output+'/mobile-chat-settings.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile settings must not overflow');
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/playlists');await page.getByRole('heading',{name:'Playlists',exact:true}).waitFor();assert.equal(await page.getByText(foreign.name).count(),0);await page.screenshot({path:output+'/desktop-list.png',fullPage:true});
    assert.deepEqual(errors,[]);writeFileSync(output+'/report.json',JSON.stringify({at:new Date().toISOString(),scope:'Local isolated UI fixtures; no workers or production writes',checks:{mobileDetail:true,evidenceExpanded:true,backgroundRefreshQueued:true,ownerIsolation:true,discoveryDismissal:true,chatSettings:true,noOverflow:true,noPageErrors:true}},null,2));
    console.log('Playlist renewal UI audit passed: '+output+'/report.json');
  }finally{
    await browser?.close();server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(3000)]);log.close();database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true});
  }
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
