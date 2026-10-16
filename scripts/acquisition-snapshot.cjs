// Read-only production evidence. Run in the Curator container with Node and an
// ISO timestamp argument; no API keys, download URLs or authentication leave it.
(async () => {
  const since = process.argv[2] || new Date(Date.now() - 86400_000).toISOString();
  if (!Number.isFinite(Date.parse(since))) throw Error('Expected an ISO timestamp');
  const db = new (require('better-sqlite3'))(process.env.CURATOR_DB_PATH || '/app/data/curator.sqlite', { readonly: true });
  const report = { checkedAt: new Date().toISOString(), since };
  const lidarr = async path => {
    const response = await fetch(process.env.LIDARR_URL + '/api/v1' + path, {
      headers: { 'X-Api-Key': process.env.LIDARR_API_KEY }, signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error('Lidarr HTTP ' + response.status);
    return response.json();
  };
  report.state = db.prepare("SELECT key,value,updated_at FROM state WHERE key IN ('paused','last_error','scheduler_phase','acquisition_phase','acquisition_running','acquisition_paused','acquisition_last_error','acquisition_heartbeat','acquisition_summary','acquisition_search_status','acquisition_probe') OR key LIKE 'acquisition_source_error:%'").all();
  report.targetCounts = db.prepare('SELECT status,count(*) n FROM acquisition_targets GROUP BY status').all();
  report.searches = db.prepare("SELECT status,count(*) n,count(distinct target_id) targets FROM download_interventions WHERE action='search' AND datetime(created_at)>=datetime(?) GROUP BY status").all(since);
  report.sourceRequests = db.prepare("SELECT indexer_id,indexer_name,event,count(*) n,sum(coalesce(json_extract(detail_json,'$.results'),0)) results,round(avg(latency_ms)) latencyMs FROM source_outcomes WHERE event IN ('search','search_failure') AND datetime(created_at)>=datetime(?) GROUP BY indexer_id,indexer_name,event").all(since);
  report.requestsByHour = db.prepare("SELECT strftime('%Y-%m-%d %H',created_at) hour,indexer_name,event,count(*) n,sum(coalesce(json_extract(detail_json,'$.results'),0)) results FROM source_outcomes WHERE event IN ('search','search_failure') AND datetime(created_at)>=datetime(?) GROUP BY hour,indexer_name,event").all(since);
  report.sourceOutcomes = db.prepare("SELECT indexer_id,indexer_name,event,count(*) n FROM source_outcomes WHERE event NOT IN ('search','search_failure') AND datetime(created_at)>=datetime(?) GROUP BY indexer_id,indexer_name,event").all(since);
  report.quotas = db.prepare("SELECT indexer_id,count(*) daily,sum(created_at>=datetime('now','-1 hour')) hourly FROM acquisition_requests WHERE created_at>=datetime('now','-1 day') GROUP BY indexer_id").all();
  report.recentTargets = db.prepare("SELECT lidarr_album_id,artist,title,status,last_search_at,next_retry_at,detail_json FROM acquisition_targets ORDER BY last_search_at DESC LIMIT 12").all();
  report.submissions = db.prepare("SELECT status,count(*) n,min(created_at) oldest FROM acquisition_submissions GROUP BY status").all();
  report.interventions = db.prepare("SELECT a.artist,a.title,i.action,i.status,i.evidence_json,i.created_at FROM download_interventions i LEFT JOIN acquisition_targets a ON a.id=i.target_id WHERE datetime(i.created_at)>=datetime(?) AND i.action NOT IN ('search','reannounce') ORDER BY i.id DESC LIMIT 50").all(since);
  report.identityRecovery = db.prepare("SELECT key,value,updated_at FROM state WHERE key LIKE 'acquisition_identity_pending:%'").all();
  const [missing, queue, health, history] = await Promise.all([
    lidarr('/wanted/missing?pageSize=1&monitored=true'), lidarr('/queue?pageSize=1000&includeUnknownArtistItems=true'),
    lidarr('/health'), lidarr('/history/since?' + new URLSearchParams({ date: since, eventType: '3' })),
  ]);
  report.missing = missing.totalRecords;
  report.health = health.map(x => ({ type: x.type, message: x.message }));
  report.queue = queue.records.map(x => ({ albumId: x.albumId, title: x.title, state: x.trackedDownloadState, left: x.sizeleft, messages: x.statusMessages }));
  report.importedTargets = db.prepare("SELECT lidarr_album_id,artist,title,imported_at FROM acquisition_targets WHERE datetime(imported_at)>=datetime(?)").all(since);
  report.importedTracks = history.length;
  report.importAlbums = [];
  const ids = [...new Set([...history.map(x => x.albumId), ...report.importedTargets.map(x => x.lidarr_album_id)].filter(Boolean))];
  for (const id of ids) {
    const a = await lidarr('/album/' + id);
    report.importAlbums.push({ id, artist: a.artist?.artistName, title: a.title, monitored: a.monitored, statistics: a.statistics });
  }
  report.completeAlbums = report.importAlbums.filter(a => a.statistics?.percentOfTracks >= 100 && a.statistics?.trackFileCount > 0).length;
  const base = process.env.QBITTORRENT_URL;
  const auth = await fetch(base + '/api/v2/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Referer: base + '/' },
    body: new URLSearchParams({ username: process.env.QBITTORRENT_USERNAME, password: process.env.QBITTORRENT_PASSWORD }),
  });
  const cookie = auth.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw Error('qBittorrent login failed');
  const qbit = async path => {
    const r = await fetch(base + '/api/v2' + path, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error('qBittorrent HTTP ' + r.status);
    return r.json();
  };
  const [torrents, transfer, main] = await Promise.all([qbit('/torrents/info'), qbit('/transfer/info'), qbit('/sync/maindata')]);
  report.transfer = { connected: transfer.connection_status, dhtNodes: transfer.dht_nodes, speed: transfer.dl_info_speed, downloadedBytes: transfer.dl_info_data, freeBytes: main.server_state?.free_space_on_disk };
  report.torrents = torrents.filter(t => t.category === 'music' && (t.progress < 1 || t.added_on >= Date.parse(since) / 1000)).map(t => ({
    hash: t.hash, name: t.name, state: t.state, progress: t.progress, downloaded: t.downloaded, left: t.amount_left,
    speed: t.dlspeed, seeds: t.num_seeds, reportedSeeds: t.num_complete, availability: t.availability,
    addedAt: new Date(t.added_on * 1000).toISOString(), completedAt: t.completion_on > 0 ? new Date(t.completion_on * 1000).toISOString() : null,
  }));
  console.log(JSON.stringify(report, null, 2).replace(/([?&]apikey=)[^&\s"\\]+/gi, '$1REDACTED'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
