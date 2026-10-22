// Production-safe: opens SQLite read-only, never imports application startup or
// migrations. --fixture exports reproducible, credential-free evaluation input.
const Database = require('better-sqlite3');
const { createHash } = require('node:crypto');

const parse = (raw, fallback = {}) => { try { return JSON.parse(raw); } catch { return fallback; } };
const norm = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function summarizeRuns(runs, items, since) {
  const published = runs.filter(r => r.status === 'complete' && !r.preview).slice().sort((a,b) => a.id-b.id);
  const byRun = new Map(published.map(r => [r.id, items.filter(i => i.run_id === r.id)]));
  const transitions = published.slice(1).map((run, index) => {
    const prior = new Set((byRun.get(published[index].id) ?? []).map(i => i.file_id));
    const current = byRun.get(run.id) ?? [];
    return { runId: run.id, at: run.finished_at, songs: current.length, added: current.filter(i => !prior.has(i.file_id)).length,
      retained: current.filter(i => prior.has(i.file_id)).length };
  });
  const latest = byRun.get(published.at(-1)?.id) ?? [];
  const identities = latest.map(i => `${norm(i.artist_name)}|${norm(i.title)}`);
  const recent=new Set(published.filter(r=>!since||r.started_at>=since).map(r=>r.id));
  return { successfulPublications: recent.size, latestPublication: published.at(-1)?.finished_at ?? null,
    latestSongs: latest.length, uniqueSongs: new Set(items.filter(i => recent.has(i.run_id)).map(i=>i.file_id)).size,
    latestArtists: new Set(latest.map(i=>norm(i.artist_name))).size,
    latestAlbums: new Set(latest.map(i=>`${norm(i.artist_name)}|${norm(i.album_name)}`)).size,
    unresolvedPublishedItems: latest.filter(i=>!i.navidrome_song_id).length,
    possibleDuplicateRecordings: identities.length-new Set(identities).size, transitions };
}

function fixedMetadataSample(tracks, count = 120) {
  const buckets = [
    ['vocal_instrumental', t=>/instrumental|vocals|spoken/.test(JSON.stringify(t.profile.vocalProfile))],
    ['quiet_rock', t=>t.profile.genre?.includes('rock') && /low/.test(t.profile.energy)],
    ['energetic_jazz', t=>t.profile.genre?.includes('jazz') && /high/.test(t.profile.energy)],
    ['live', t=>/live/.test(JSON.stringify(t.profile.recordingTypes))],
    ['compilation', t=>/various|compilation/i.test(t.artist+' '+t.album)],
    ['non_latin', t=>/[^\u0000-\u024f]/.test(t.artist+t.title)],
  ];
  const ranked = tracks.slice().sort((a,b)=>digest(a.fileId).localeCompare(digest(b.fileId)));
  const selected = new Map();
  for(const [stratum, predicate] of buckets) {
    for(const track of ranked.filter(predicate).slice(0,20)) {
      const prior=selected.get(track.fileId);
      if(prior) prior.strata.push(stratum); else selected.set(track.fileId,{...track,strata:[stratum]});
    }
  }
  for(const track of ranked) {
    if(selected.size>=count) break;
    if(!selected.has(track.fileId)) selected.set(track.fileId,{...track,strata:['coverage']});
  }
  return [...selected.values()].slice(0,count);
}

function audit(database, now = new Date(), fixture = false) {
  const all = (sql,...args)=>database.prepare(sql).all(...args);
  const since = new Date(now.getTime()-7*86400_000).toISOString().slice(0,19).replace('T',' ');
  // A single read transaction makes all baseline components consistent while
  // production workers keep writing in WAL mode.
  return database.transaction(()=>{
    const definitions=all('SELECT id,name,category,enabled,owner_user_id,intent,config_json,navidrome_playlist_id,last_run_at,next_run_at FROM smart_playlists ORDER BY id');
    const window="started_at>=? OR id IN (SELECT max(id) FROM playlist_runs WHERE status='complete' AND preview=0 GROUP BY playlist_id)";
    const runs=all(`SELECT id,playlist_id,status,preview,started_at,finished_at,error,detail_json FROM playlist_runs WHERE ${window} ORDER BY id`,since);
    const runIds=runs.map(r=>r.id);
    const items=runIds.length?all(`SELECT i.*,f.artist_name,f.album_name,coalesce(json_extract(f.tags_json,'$.title[0]'),json_extract(f.tags_json,'$.title'),'') title FROM playlist_items i JOIN files f ON f.id=i.file_id WHERE i.run_id IN (${runIds.map(()=>'?').join(',')})`,...runIds):[];
    const columns=all('PRAGMA table_info(discovery_candidates)').map(c=>c.name);
    const tables=new Set(all("SELECT name FROM sqlite_master WHERE type='table'").map(t=>t.name));
    const discovery=tables.has('playlist_discovery_recommendations')?all('SELECT d.*,p.name lane,r.artist,r.album,r.evidence_json sources_json FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id JOIN smart_playlists p ON p.id=d.playlist_id AND p.owner_user_id=d.owner_user_id ORDER BY d.id'):
      all(`SELECT id,lane,artist,album,status,sources_json,rationale,created_at,updated_at${columns.includes('playlist_id')?',playlist_id,owner_user_id':''} FROM discovery_candidates ORDER BY id`);
    const report={version:1,checkedAt:now.toISOString(),since,scope:{databaseReadOnly:true,remotePlaylistsVerified:false,
      constraintValidation:'Not evaluated by the baseline audit; use the fixed intent/rubric evaluations.',
      publicationEvidence:'Completed non-preview database runs; independently verify Navidrome on rollout.'},
      files:all('SELECT status,count(*) tracks FROM files GROUP BY status'),profiles:all('SELECT status,count(*) tracks FROM track_profiles GROUP BY status'),
      playlists:definitions.map(p=>({id:p.id,name:p.name,category:p.category,ownerUserId:p.owner_user_id,enabled:Boolean(p.enabled),
        target:parse(p.config_json).targetTracks??30,lastRunAt:p.last_run_at,nextRunAt:p.next_run_at,
        ...summarizeRuns(runs.filter(r=>r.playlist_id===p.id),items.filter(i=>i.playlist_id===p.id),since),
        attempts:runs.filter(r=>r.playlist_id===p.id).map(r=>({id:r.id,status:r.status,preview:Boolean(r.preview),at:r.started_at,error:r.error,detail:parse(r.detail_json)})),
        discovery:discovery.filter(d=>columns.includes('playlist_id')?d.playlist_id===p.id:d.lane===p.name).map(d=>({id:d.id,artist:d.artist,album:d.album,status:d.status,sourceCount:parse(d.sources_json,[]).length,createdAt:d.created_at,updatedAt:d.updated_at}))})),
      usage:all('SELECT purpose,model,count(*) calls,sum(input_tokens) inputTokens,sum(output_tokens) outputTokens,sum(total_tokens) totalTokens FROM ai_usage WHERE created_at>=? GROUP BY purpose,model',since),
      latencyEvidence:'Existing runs expose duration only where recorded in detail_json; missing measurements remain unknown.',
      unassignedLegacyDiscoveries:columns.includes('playlist_id')?all('SELECT id,lane,artist,album,status FROM discovery_candidates WHERE playlist_id IS NULL'):[],
      refreshJobs:tables.has('playlist_refresh_jobs')?all('SELECT playlist_id,status,mode,phase,error,result_json,created_at,updated_at FROM playlist_refresh_jobs ORDER BY created_at DESC LIMIT 100'):[],
      sourceUsage:tables.has('playlist_source_requests')?all('SELECT provider,kind,status,count(*) requests FROM playlist_source_requests WHERE created_at>=? GROUP BY provider,kind,status',now.getTime()-86400_000):[]};
    if(fixture){
      const tracks=all("SELECT f.id fileId,f.artist_name artist,f.album_name album,f.tags_json,p.profile_json,p.provenance_json,p.status profileStatus FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id WHERE f.status='written' ORDER BY f.id").map(row=>{
        const raw=parse(row.tags_json),keys=['title','genre','style','date','year','musicbrainz_trackid','musicbrainz_recordingid','musicbrainz_albumid','musicbrainz_releasegroupid','albumArtist','discNumber','trackNumber','rating','RATING'];
        const tags=Object.fromEntries(keys.filter(k=>raw[k]!=null).map(k=>[k,raw[k]]));
        return{fileId:row.fileId,title:Array.isArray(raw.title)?raw.title[0]:raw.title??'Untitled',artist:row.artist,album:row.album,
          year:Number(String(Array.isArray(raw.date)?raw.date[0]:raw.date??raw.year??0).slice(0,4))||0,tags,
          profile:parse(row.profile_json),profileStatus:row.profileStatus,provenance:parse(row.provenance_json)};
      });
      report.fixture={version:1,tracks,definitions:definitions.map(p=>({...p,config:parse(p.config_json)})),runs,items,
        chats:all('SELECT playlist_id,revision,result_json FROM playlist_chat_state WHERE revision>0'),
        feedback:all('SELECT playlist_id,owner_user_id,file_id,artist,action,expires_at FROM playlist_feedback'),metadataSample:fixedMetadataSample(tracks)};
      report.fixtureHash=digest(report.fixture);
    }
    return report;
  })();
}
module.exports={audit,summarizeRuns,fixedMetadataSample};
if(require.main===module || process.argv[1]==='-'){
  const database=new Database(process.env.CURATOR_DB_PATH||process.env.DATABASE_PATH||'/app/data/curator.sqlite',{readonly:true,fileMustExist:true});
  try{console.log(JSON.stringify(audit(database,new Date(),process.argv.includes('--fixture')),null,2));}finally{database.close();}
}
